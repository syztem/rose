import * as THREE from 'three/webgpu';
import { createWaterMaterial } from '../rose/GlassMaterials.js';

/**
 * Hero water beads on petals — separate transmissive instances (IOR 1.333).
 * Cap ≤160. Single shared material.
 * setCount gates CPU sim + instance writes (not only mesh.count draw).
 *
 * F04: surface constraint via UV/grid param slide on loft (method B).
 * Petal loft UV is (v, u) with regular SEG_V×SEG_U grid; beads integrate in
 * (u,pv), position = bilinear surface sample + normal * radius.
 *
 * Drop state UV fields (F06): u = base→tip, pv = width (loft v).
 * World freestyle velocity is vel (Vector3) — never reuse key v/pv.
 */

/** Loft defaults from proceduralRose makePetalGeometry (F01). */
const LOFT_SEG_U = 16; // length base→tip (uv.y)
const LOFT_SEG_V = 32; // width (uv.x)

export class DropletSystem {
  constructor(petalMeshes, { max = 120 } = {}) {
    this.max = Math.min(160, Math.max(1, max));
    this.petals = petalMeshes || [];
    this.mat = createWaterMaterial();
    this.geo = new THREE.SphereGeometry(1, 12, 10);
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, this.max);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'WaterBeads';
    // F10: beads after rose glass petals (petals 10..10+n-1; n≈32 → RO 10..41) so transmission sort is stable
    this.mesh.renderOrder = 50;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = this.max;
    /** @type {number} active beads — CPU sim + writes gated here */
    this.activeCount = this.max;

    this.drops = [];
    /** @type {WeakMap<THREE.BufferGeometry, object>} local UV grid caches */
    this._caches = new WeakMap();

    this._dummy = new THREE.Object3D();
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._tmp3 = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._Pu = new THREE.Vector3();
    this._Pv = new THREE.Vector3();
    this._gt = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._look = new THREE.Vector3();
    this._nmat = new THREE.Matrix3();
    this._spawn();
  }

  /**
   * Cap active beads. Cuts CPU sim cost and instance writes, not only GPU draw count.
   * When shrinking, clear hidden instance matrices once so stale draws never linger.
   */
  setCount(n) {
    const next = Math.min(this.max, Math.max(0, n | 0));
    const prev = this.activeCount;
    if (next === prev) {
      this.mesh.count = next;
      return;
    }
    if (next < prev) {
      this._clearHiddenInstances(next, prev);
    }
    this.activeCount = next;
    this.mesh.count = next;
  }

  /** Zero-scale + park matrices for slots [from, to) once after a shrink. */
  _clearHiddenInstances(from, to) {
    const dummy = this._dummy;
    const end = Math.min(to, this.max);
    for (let i = from; i < end; i++) {
      dummy.scale.set(0, 0, 0);
      dummy.position.set(0, -10, 0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    if (from < end) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Build local-space outer-surface grid from welded loft geo.
   * UV convention (F01): uv.x = v (width 0..1), uv.y = u (base→tip 0..1).
   * Outer vs inner: prefer higher local normal.z (loft front is +Z-ish).
   */
  _buildGridCache(geo) {
    const posAttr = geo.attributes.position;
    const norAttr = geo.attributes.normal;
    const uvAttr = geo.attributes.uv;
    if (!posAttr || !uvAttr || !norAttr || posAttr.count < 4) return null;

    // Prefer detected unique UV steps; fall back to loft defaults.
    let segU = LOFT_SEG_U;
    let segV = LOFT_SEG_V;
    const uQuant = new Map();
    const vQuant = new Map();
    for (let i = 0; i < uvAttr.count; i++) {
      const uq = Math.round(uvAttr.getY(i) * 64) / 64;
      const vq = Math.round(uvAttr.getX(i) * 64) / 64;
      uQuant.set(uq, (uQuant.get(uq) || 0) + 1);
      vQuant.set(vq, (vQuant.get(vq) || 0) + 1);
    }
    // Unique values near a regular 0..1 lattice
    const uKeys = [...uQuant.keys()].filter((k) => k >= -0.01 && k <= 1.01).sort((a, b) => a - b);
    const vKeys = [...vQuant.keys()].filter((k) => k >= -0.01 && k <= 1.01).sort((a, b) => a - b);
    if (uKeys.length >= 8 && uKeys.length <= 65) segU = uKeys.length - 1;
    if (vKeys.length >= 8 && vKeys.length <= 65) segV = vKeys.length - 1;

    const cu = segU + 1;
    const cv = segV + 1;
    const nCell = cu * cv;
    const bestScore = new Float32Array(nCell);
    bestScore.fill(-Infinity);
    const lpos = new Float32Array(nCell * 3);
    const lnor = new Float32Array(nCell * 3);
    const filled = new Uint8Array(nCell);

    for (let i = 0; i < posAttr.count; i++) {
      const u = uvAttr.getY(i);
      const v = uvAttr.getX(i);
      if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) continue;
      const iu = Math.round(THREE.MathUtils.clamp(u, 0, 1) * segU);
      const iv = Math.round(THREE.MathUtils.clamp(v, 0, 1) * segV);
      const nx = norAttr.getX(i);
      const ny = norAttr.getY(i);
      const nz = norAttr.getZ(i);
      // Outer front shell: loft analytic n is +Z-ish; inner is opposite.
      const score = nz * 2 + ny * 0.15;
      const idx = iu * cv + iv;
      if (score > bestScore[idx]) {
        bestScore[idx] = score;
        const o = idx * 3;
        lpos[o] = posAttr.getX(i);
        lpos[o + 1] = posAttr.getY(i);
        lpos[o + 2] = posAttr.getZ(i);
        lnor[o] = nx;
        lnor[o + 1] = ny;
        lnor[o + 2] = nz;
        filled[idx] = 1;
      }
    }

    let fillCount = 0;
    for (let i = 0; i < nCell; i++) if (filled[i]) fillCount++;
    // Need a usable fraction of the grid (dual shell + rim still leave outer populated).
    if (fillCount < nCell * 0.45) return null;

    // Fill holes from nearest filled neighbor (rare after weld).
    if (fillCount < nCell) {
      for (let iu = 0; iu < cu; iu++) {
        for (let iv = 0; iv < cv; iv++) {
          const idx = iu * cv + iv;
          if (filled[idx]) continue;
          let found = false;
          for (let r = 1; r <= 4 && !found; r++) {
            for (let di = -r; di <= r && !found; di++) {
              for (let dj = -r; dj <= r && !found; dj++) {
                const a = iu + di;
                const b = iv + dj;
                if (a < 0 || a >= cu || b < 0 || b >= cv) continue;
                const j = a * cv + b;
                if (!filled[j]) continue;
                const o = idx * 3;
                const s = j * 3;
                lpos[o] = lpos[s];
                lpos[o + 1] = lpos[s + 1];
                lpos[o + 2] = lpos[s + 2];
                lnor[o] = lnor[s];
                lnor[o + 1] = lnor[s + 1];
                lnor[o + 2] = lnor[s + 2];
                filled[idx] = 1;
                found = true;
              }
            }
          }
        }
      }
    }

    return { segU, segV, cu, cv, lpos, lnor };
  }

  _getCache(mesh) {
    const geo = mesh && mesh.geometry;
    if (!geo) return null;
    let c = this._caches.get(geo);
    if (c === undefined) {
      c = this._buildGridCache(geo);
      this._caches.set(geo, c); // may be null → avoid rebuild spam
    }
    return c;
  }

  /** Bilinear sample local pos/normal at param (u,v); u tip, v width. */
  _sampleLocal(cache, u, v, outP, outN) {
    const { segU, segV, cv, lpos, lnor } = cache;
    u = THREE.MathUtils.clamp(u, 0, 1);
    v = THREE.MathUtils.clamp(v, 0, 1);
    const fu = u * segU;
    const fv = v * segV;
    const i0 = fu | 0;
    const j0 = fv | 0;
    const i1 = i0 < segU ? i0 + 1 : i0;
    const j1 = j0 < segV ? j0 + 1 : j0;
    const tu = fu - i0;
    const tv = fv - j0;
    const a = (1 - tu) * (1 - tv);
    const b = (1 - tu) * tv;
    const c = tu * (1 - tv);
    const d = tu * tv;
    const i00 = (i0 * cv + j0) * 3;
    const i01 = (i0 * cv + j1) * 3;
    const i10 = (i1 * cv + j0) * 3;
    const i11 = (i1 * cv + j1) * 3;
    outP.set(
      lpos[i00] * a + lpos[i01] * b + lpos[i10] * c + lpos[i11] * d,
      lpos[i00 + 1] * a + lpos[i01 + 1] * b + lpos[i10 + 1] * c + lpos[i11 + 1] * d,
      lpos[i00 + 2] * a + lpos[i01 + 2] * b + lpos[i10 + 2] * c + lpos[i11 + 2] * d
    );
    outN.set(
      lnor[i00] * a + lnor[i01] * b + lnor[i10] * c + lnor[i11] * d,
      lnor[i00 + 1] * a + lnor[i01 + 1] * b + lnor[i10 + 1] * c + lnor[i11 + 1] * d,
      lnor[i00 + 2] * a + lnor[i01 + 2] * b + lnor[i10 + 2] * c + lnor[i11 + 2] * d
    );
    if (outN.lengthSq() < 1e-10) outN.set(0, 0, 1);
    else outN.normalize();
  }

  /** World-space surface point + normal at (u,v) on mesh. */
  _sampleWorld(mesh, cache, u, v, outP, outN) {
    this._sampleLocal(cache, u, v, outP, outN);
    outP.applyMatrix4(mesh.matrixWorld);
    this._nmat.getNormalMatrix(mesh.matrixWorld);
    outN.applyMatrix3(this._nmat).normalize();
  }

  /**
   * World tangent basis ∂P/∂u, ∂P/∂v via finite differences on the grid.
   * Uses small param epsilon so metric stays stable near edges.
   */
  _tangentsWorld(mesh, cache, u, v, outPu, outPv) {
    const eu = 1 / cache.segU;
    const ev = 1 / cache.segV;
    const u0 = THREE.MathUtils.clamp(u - eu * 0.5, 0, 1);
    const u1 = THREE.MathUtils.clamp(u + eu * 0.5, 0, 1);
    const v0 = THREE.MathUtils.clamp(v - ev * 0.5, 0, 1);
    const v1 = THREE.MathUtils.clamp(v + ev * 0.5, 0, 1);
    this._sampleLocal(cache, u0, v, this._tmp, this._n);
    this._tmp.applyMatrix4(mesh.matrixWorld);
    this._sampleLocal(cache, u1, v, this._tmp2, this._n);
    this._tmp2.applyMatrix4(mesh.matrixWorld);
    outPu.subVectors(this._tmp2, this._tmp).multiplyScalar(1 / Math.max(1e-6, u1 - u0));
    this._sampleLocal(cache, u, v0, this._tmp, this._n);
    this._tmp.applyMatrix4(mesh.matrixWorld);
    this._sampleLocal(cache, u, v1, this._tmp2, this._n);
    this._tmp2.applyMatrix4(mesh.matrixWorld);
    outPv.subVectors(this._tmp2, this._tmp).multiplyScalar(1 / Math.max(1e-6, v1 - v0));
  }

  /**
   * Pick a spawn (u,v) on petal preferring upper-facing outer surface.
   * Returns false if no UV cache (non-loft geo).
   */
  _samplePetalUV(mesh) {
    const cache = this._getCache(mesh);
    if (!cache) return null;

    let bestU = 0.35 + Math.random() * 0.35;
    let bestV = 0.2 + Math.random() * 0.6;
    let bestNy = -2;
    // A few tries for adhesion-friendly upward normals
    for (let t = 0; t < 6; t++) {
      const u = 0.12 + Math.random() * 0.7;
      const v = 0.08 + Math.random() * 0.84;
      this._sampleWorld(mesh, cache, u, v, this._p, this._n);
      if (this._n.y > bestNy) {
        bestNy = this._n.y;
        bestU = u;
        bestV = v;
      }
      if (bestNy > 0.25) break;
    }
    this._sampleWorld(mesh, cache, bestU, bestV, this._p, this._n);
    // Prefer upper-facing for adhesion (match prior freestyle bias)
    if (this._n.y < 0.12) {
      this._n.y = Math.abs(this._n.y) + 0.3;
      this._n.normalize();
    }
    return {
      mesh,
      cache,
      u: bestU,
      pv: bestV,
      point: this._p.clone(),
      normal: this._n.clone()
    };
  }

  /** Legacy vertex sample — only if UV grid unavailable (e.g. odd GLB). */
  _samplePetalVert(mesh) {
    const pos = mesh.geometry.attributes.position;
    const nor = mesh.geometry.attributes.normal;
    const idx = (Math.random() * pos.count) | 0;
    this._p.fromBufferAttribute(pos, idx);
    mesh.localToWorld(this._p);
    mesh.getWorldQuaternion(this._q);
    if (nor) {
      this._n.fromBufferAttribute(nor, idx).applyQuaternion(this._q).normalize();
    } else {
      this._n.set(0, 1, 0).applyQuaternion(this._q).normalize();
    }
    if (this._n.y < 0.15) {
      this._n.y = Math.abs(this._n.y) + 0.35;
      this._n.normalize();
    }
    return { mesh, cache: null, u: 0.5, pv: 0.5, point: this._p.clone(), normal: this._n.clone() };
  }

  _samplePetal(mesh) {
    return this._samplePetalUV(mesh) || this._samplePetalVert(mesh);
  }

  _makeDrop(s) {
    const mass = 0.4 + Math.random() * 1.2;
    return {
      mesh: s.mesh,
      u: s.u, // base→tip
      pv: s.pv, // width (loft v) — must not collide with vel
      pos: s.point,
      n: s.normal,
      mass,
      r: 0.004 * Math.cbrt(mass),
      vu: 0,
      vv: 0,
      vel: new THREE.Vector3(), // freestyle world vel only
      age: Math.random() * 5,
      constrained: !!s.cache
    };
  }

  _respawnDrop(d, preferOtherPetal) {
    const petals = this.petals;
    if (!petals.length) return;
    let mesh = d.mesh;
    if (preferOtherPetal && petals.length > 1) {
      mesh = petals[(Math.random() * petals.length) | 0];
    }
    const s = this._samplePetal(mesh);
    d.mesh = s.mesh;
    d.u = s.u;
    d.pv = s.pv;
    d.pos.copy(s.point);
    d.n.copy(s.normal);
    d.vu = 0;
    d.vv = 0;
    d.vel.set(0, 0, 0);
    d.constrained = !!s.cache;
    d.age = Math.random() * 0.5;
  }

  _spawn() {
    this.drops.length = 0;
    if (!this.petals.length) return;
    for (let i = 0; i < this.max; i++) {
      const petal = this.petals[i % this.petals.length];
      const s = this._samplePetal(petal);
      this.drops.push(this._makeDrop(s));
    }
    this._writeInstances();
  }

  /** Write instance matrices for active range only (hidden slots cleared in setCount). */
  _writeInstances() {
    const dummy = this._dummy;
    const count = this.activeCount;
    if (count === 0) return;
    for (let i = 0; i < count; i++) {
      const d = this.drops[i];
      if (!d) {
        dummy.scale.set(0, 0, 0);
        dummy.position.set(0, -10, 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const r = d.r;
      // F04: offset full radius along normal so sphere sits on surface (not sunk)
      dummy.position.copy(d.pos).addScaledVector(d.n, r);
      dummy.scale.set(r * 1.05, r * 0.62, r * 1.15);
      this._look.copy(dummy.position).add(d.n);
      dummy.lookAt(this._look);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Integrate one bead on UV surface (method B).
   * Gravity → tangent plane → (u,v) accel via first-fundamental-form solve.
   */
  _integrateConstrained(d, dt, gravity) {
    const mesh = d.mesh;
    const cache = this._getCache(mesh);
    if (!cache) {
      d.constrained = false;
      return false;
    }

    // Ensure world matrix current (rose.update already ran this frame)
    this._tangentsWorld(mesh, cache, d.u, d.pv, this._Pu, this._Pv);
    this._sampleWorld(mesh, cache, d.u, d.pv, d.pos, d.n);

    // Prefer geometric normal from tangents when stable
    this._tmp.crossVectors(this._Pu, this._Pv);
    if (this._tmp.lengthSq() > 1e-12) {
      this._tmp.normalize();
      // Keep same hemisphere as sampled shell normal
      if (this._tmp.dot(d.n) < 0) this._tmp.negate();
      d.n.copy(this._tmp);
    }

    const g = this._tmp2.set(0, -gravity, 0);
    const gn = g.dot(d.n);
    this._gt.copy(g).addScaledVector(d.n, -gn);
    // Mild tip-ward drainage + slight midrib attraction in v
    this._gt.addScaledVector(this._Pu, 0.35);
    const vMid = 0.5 - d.pv;
    this._gt.addScaledVector(this._Pv, vMid * 0.15);
    // Extra settle so beads don't levitate feeling
    this._gt.y -= 0.25;

    // Metric solve: au*Pu + av*Pv ≈ gt
    const guu = this._Pu.dot(this._Pu);
    const guv = this._Pu.dot(this._Pv);
    const gvv = this._Pv.dot(this._Pv);
    const bu = this._gt.dot(this._Pu);
    const bv = this._gt.dot(this._Pv);
    const det = guu * gvv - guv * guv;
    let au = 0;
    let av = 0;
    if (Math.abs(det) > 1e-14) {
      au = (bu * gvv - bv * guv) / det;
      av = (bv * guu - bu * guv) / det;
    }

    const k = 0.12; // matches prior world force scale feel
    d.vu += au * dt * k;
    d.vv += av * dt * k;
    d.vu *= 0.96;
    d.vv *= 0.96;

    // Clamp param-speed so world speed stays ≤ ~0.35
    this._tmp.copy(this._Pu).multiplyScalar(d.vu).addScaledVector(this._Pv, d.vv);
    const spd = this._tmp.length();
    if (spd > 0.35) {
      const s = 0.35 / spd;
      d.vu *= s;
      d.vv *= s;
    }

    d.u += d.vu * dt;
    d.pv += d.vv * dt;

    // Edge / tip leave → respawn on another petal sample
    const tipExit = d.u > 0.93 && d.vu > 0.02;
    const baseExit = d.u < 0.02 && d.vu < -0.01;
    const sideExit = (d.pv < 0.02 && d.vv < -0.015) || (d.pv > 0.98 && d.vv > 0.015);
    if (tipExit || baseExit || sideExit || d.u < 0 || d.u > 1.02 || d.pv < -0.02 || d.pv > 1.02) {
      this._respawnDrop(d, true);
      return true;
    }

    d.u = THREE.MathUtils.clamp(d.u, 0.02, 0.98);
    d.pv = THREE.MathUtils.clamp(d.pv, 0.03, 0.97);

    // Re-snap to surface every frame (true-enough constraint)
    this._sampleWorld(mesh, cache, d.u, d.pv, d.pos, d.n);
    return true;
  }

  /** Freestyle fallback when no UV grid (should be rare with F01 loft). */
  _integrateFree(d, dt, gravity) {
    const g = this._tmp.set(0, -gravity, 0);
    const gn = g.dot(d.n);
    this._force.copy(g).addScaledVector(d.n, -gn);
    this._force.y -= 0.4;
    d.vel.addScaledVector(this._force, dt * 0.15);
    d.vel.multiplyScalar(0.96);
    if (d.vel.lengthSq() > 0.1225) d.vel.setLength(0.35);
    d.pos.addScaledVector(d.vel, dt);
  }

  update(dt, gravity = 9.8) {
    const count = this.activeCount;
    // Early-out: no sim, no instance writes when capped to zero
    if (count === 0) return;
    if (!this.drops.length) return;

    for (let i = 0; i < count; i++) {
      const d = this.drops[i];
      if (!d) continue;
      d.age += dt;

      if (d.constrained) {
        this._integrateConstrained(d, dt, gravity);
      } else {
        this._integrateFree(d, dt, gravity);
      }

      // Age recycle / drip: tip-fall already respawns; this covers dwell timeout
      if (d.age > 2.5 + (i % 5) * 0.7) {
        if (d.mass > 1.3 && Math.random() > 0.7) {
          d.mass = 0.35 + Math.random() * 0.4;
          d.r = 0.004 * Math.cbrt(d.mass);
          this._respawnDrop(d, true);
        } else if (d.constrained) {
          // Soft re-nucleate nearby on same petal
          const s = this._samplePetal(d.mesh);
          d.u = THREE.MathUtils.lerp(d.u, s.u, 0.35);
          d.pv = THREE.MathUtils.lerp(d.pv, s.pv, 0.35);
          d.vu *= 0.3;
          d.vv *= 0.3;
          const cache = this._getCache(d.mesh);
          if (cache) this._sampleWorld(d.mesh, cache, d.u, d.pv, d.pos, d.n);
          d.age = Math.random() * 0.5;
        } else {
          const s = this._samplePetal(d.mesh);
          d.pos.lerp(s.point, 0.35);
          d.n.lerp(s.normal, 0.35).normalize();
          d.age = Math.random() * 0.5;
          d.vel.set(0, 0, 0);
        }
      }

      // coalesce only within active range (UV-near on same petal)
      if (i > 0 && i % 7 === 0) {
        const o = this.drops[i - 1];
        if (o && o.mesh === d.mesh) {
          let near = false;
          if (d.constrained && o.constrained) {
            const du = d.u - o.u;
            const dv = d.pv - o.pv;
            near = du * du + dv * dv < 0.0025;
          } else {
            near = d.pos.distanceToSquared(o.pos) < 0.00014;
          }
          if (near) {
            d.mass += o.mass * 0.5;
            d.r = 0.004 * Math.cbrt(d.mass);
            o.mass *= 0.4;
            o.r = 0.004 * Math.cbrt(o.mass);
            this._respawnDrop(o, false);
          }
        }
      }
    }
    this._writeInstances();
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this._caches = new WeakMap();
  }
}
