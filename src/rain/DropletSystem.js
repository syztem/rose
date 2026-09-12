import * as THREE from 'three/webgpu';
import { createWaterMaterial } from '../rose/GlassMaterials.js';

/**
 * Hero water beads on petals — separate transmissive instances (IOR 1.333).
 * Cap ≤160. Single shared material.
 */
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
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = this.max;

    this.drops = [];
    this._dummy = new THREE.Object3D();
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._force = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._look = new THREE.Vector3();
    this._spawn();
  }

  setCount(n) {
    this.mesh.count = Math.min(this.max, Math.max(0, n | 0));
  }

  _samplePetal(mesh) {
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
    // prefer upper-facing samples for adhesion
    if (this._n.y < 0.15) {
      this._n.y = Math.abs(this._n.y) + 0.35;
      this._n.normalize();
    }
    return { point: this._p.clone(), normal: this._n.clone(), mesh };
  }

  _spawn() {
    this.drops.length = 0;
    if (!this.petals.length) return;
    for (let i = 0; i < this.max; i++) {
      const petal = this.petals[i % this.petals.length];
      const s = this._samplePetal(petal);
      const mass = 0.4 + Math.random() * 1.2;
      this.drops.push({
        mesh: s.mesh,
        pos: s.point,
        n: s.normal,
        mass,
        r: 0.004 * Math.cbrt(mass),
        v: new THREE.Vector3(),
        age: Math.random() * 5
      });
    }
    this._writeInstances();
  }

  _writeInstances() {
    const dummy = this._dummy;
    const count = this.mesh.count;
    for (let i = 0; i < this.max; i++) {
      const d = this.drops[i];
      if (!d || i >= count) {
        dummy.scale.set(0, 0, 0);
        dummy.position.set(0, -10, 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const r = d.r;
      dummy.position.copy(d.pos).addScaledVector(d.n, r * 0.55);
      dummy.scale.set(r * 1.05, r * 0.62, r * 1.15);
      this._look.copy(dummy.position).add(d.n);
      dummy.lookAt(this._look);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, gravity = 9.8) {
    if (!this.drops.length) return;
    const g = this._tmp.set(0, -gravity, 0);
    for (let i = 0; i < this.drops.length; i++) {
      const d = this.drops[i];
      d.age += dt;

      const gn = g.dot(d.n);
      this._force.copy(g).addScaledVector(d.n, -gn);
      this._force.y -= 0.4;
      d.v.addScaledVector(this._force, dt * 0.15);
      d.v.multiplyScalar(0.96);
      if (d.v.lengthSq() > 0.1225) d.v.setLength(0.35);

      d.pos.addScaledVector(d.v, dt);

      if (d.age > 2.5 + (i % 5) * 0.7) {
        if (d.mass > 1.3 && Math.random() > 0.7) {
          d.mass = 0.35 + Math.random() * 0.4;
          d.r = 0.004 * Math.cbrt(d.mass);
          const s2 = this._samplePetal(this.petals[(Math.random() * this.petals.length) | 0]);
          d.mesh = s2.mesh;
          d.pos.copy(s2.point);
          d.n.copy(s2.normal);
        } else {
          const s = this._samplePetal(d.mesh);
          d.pos.lerp(s.point, 0.35);
          d.n.lerp(s.normal, 0.35).normalize();
        }
        d.age = Math.random() * 0.5;
        d.v.set(0, 0, 0);
      }

      // cheap coalesce
      if (i > 0 && i % 7 === 0) {
        const o = this.drops[i - 1];
        if (o.mesh === d.mesh && d.pos.distanceToSquared(o.pos) < 0.00014) {
          d.mass += o.mass * 0.5;
          d.r = 0.004 * Math.cbrt(d.mass);
          o.mass *= 0.4;
          o.r = 0.004 * Math.cbrt(o.mass);
          const s = this._samplePetal(o.mesh);
          o.pos.copy(s.point);
        }
      }
    }
    this._writeInstances();
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
