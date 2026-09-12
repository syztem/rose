import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const GOLDEN = 137.508 * (Math.PI / 180);

/** Tiny deterministic PRNG (mulberry32). seed int → [0,1). */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * F01 loft + F02 per-petal unique geo:
 * lofted thick petal shell (jewel volume), not ExtrudeGeometry + displace.
 * Grid: 32 width × 16 length segments. Dual surface + rim wall.
 * Shell half-thickness varies ~0.002–0.006 → path length through glass ~0.004–0.012.
 * Indexed BufferGeometry; F03: mergeVertices weld + computeVertexNormals on every loft geo.
 *
 * F02: each petal gets its own BufferGeometry via seeded parametric bias
 * (thickness, edge wear, tip curl, mild belly). Sepals stay one shared blueprint.
 *
 * Tri estimate (32 unique petal geos + 1 sepal geo, same SEG):
 *   outer 32×16×2 = 1024, inner 1024, rim ~192 → ~2240 tris/geo
 *   drawn petals ≈ 32×2240 ≈ 72k (+sepals ≈ 11k) → ~83k in plan 80k–200k band.
 *   GPU buffer cost: 32 petal + 1 sepal loft buffers (not shared) — still fine;
 *   no cap needed at 32×16. Raising past ~48×24 would push drawn tris toward IGP melt.
 *
 * @param {object} [opts]
 * @param {number} [opts.seed=0] integer seed for mild unique variation (0 = blueprint)
 * @param {boolean} [opts.vary=true] when false, pure blueprint (sepals)
 */
function makePetalGeometry(opts = {}) {
  const seed = opts.seed ?? 0;
  const vary = opts.vary !== false;
  const rng = mulberry32((seed * 2654435761) ^ 0x9e3779b9);

  // Mild per-petal parametric bias (hero close-up readable, not chaos)
  const thickBias = vary ? 0.82 + rng() * 0.36 : 1; // ~0.82–1.18× half-thickness
  const edgeWear = vary ? 0.7 + rng() * 0.7 : 1; // margin thin strength
  const tipCurlBias = vary ? 0.65 + rng() * 0.75 : 1; // tip curl amp
  const bellyBias = vary ? 0.92 + rng() * 0.16 : 1; // half-width belly
  const cupBias = vary ? 0.88 + rng() * 0.24 : 1;
  const veinBias = vary ? 0.85 + rng() * 0.3 : 1;
  // slight asymmetric tip lean in V (wear / growth)
  const tipLean = vary ? (rng() - 0.5) * 0.022 : 0;

  const SEG_V = 32; // width (circumferential / across petal)
  const SEG_U = 16; // length (base → tip)
  const LEN = 0.78;
  const T_HALF_MIN = 0.002; // full path ≥ 0.004
  const T_HALF_MAX = 0.006; // full path ≤ 0.012

  const cu = SEG_U + 1;
  const cv = SEG_V + 1;
  const nSurface = cu * cv;

  function halfWidth(u) {
    // Base narrow-ish, mid belly, tip acuminate (rose-like silhouette).
    const base = 0.045;
    const belly = 0.235 * bellyBias;
    const tip = 0.012;
    if (u < 0.42) {
      const t = u / 0.42;
      const s = t * t * (3 - 2 * t);
      return base + (belly - base) * s;
    }
    const t = (u - 0.42) / 0.58;
    const s = t * t * (3 - 2 * t);
    return belly + (tip - belly) * s;
  }

  function centerPos(u, v, out) {
    const w = halfWidth(u);
    let x = (v - 0.5) * 2 * w;
    // mild tip lean (asymmetric wear) ramps with u^3
    x += tipLean * u * u * u;
    const y = u * LEN;
    const edge = Math.abs(v - 0.5) * 2; // 0 at midrib, 1 at margin
    const mid = Math.exp(-(edge * 3.2) * (edge * 3.2));
    // Cup bend (prior Extrude displace was dead after rotateX — bake into loft)
    const cup = u * u * 0.12 * cupBias;
    const edgeRoll = edge * edge * u * 0.09;
    const vein = mid * 0.014 * Math.sin(u * Math.PI) * veinBias;
    const veinRipple = 0.0045 * Math.sin(u * 14) * mid * veinBias;
    const tipCurl = u * u * u * 0.028 * tipCurlBias;
    const z = cup + edgeRoll - vein + veinRipple + tipCurl;
    return out.set(x, y, z);
  }

  function halfThickness(u, v) {
    // Thick midrib/base; thin margins and tip (gem edge read).
    // edgeWear > 1 → thinner margins (more worn); thickBias scales overall shell.
    const edge = Math.abs(v - 0.5) * 2;
    const tip = THREE.MathUtils.smoothstep(0.55, 1.0, u);
    const edgeThin = edge * edge;
    const midBoost = Math.exp(-(edge * 2.4) * (edge * 2.4));
    const f =
      (1 - 0.55 * tip) *
      (1 - 0.48 * edgeThin * edgeWear) *
      (0.72 + 0.28 * midBoost);
    const h = THREE.MathUtils.lerp(T_HALF_MIN, T_HALF_MAX, THREE.MathUtils.clamp(f, 0, 1));
    // Keep half-thickness inside gem path band after bias
    return THREE.MathUtils.clamp(h * thickBias, T_HALF_MIN * 0.85, T_HALF_MAX * 1.15);
  }

  const center = new Array(nSurface);
  const halfT = new Float32Array(nSurface);
  for (let i = 0; i <= SEG_U; i++) {
    const u = i / SEG_U;
    for (let j = 0; j <= SEG_V; j++) {
      const v = j / SEG_V;
      const idx = i * cv + j;
      center[idx] = centerPos(u, v, new THREE.Vector3());
      halfT[idx] = halfThickness(u, v);
    }
  }

  // Analytic-ish normals from surface tangents (finite difference).
  const nor = new Array(nSurface);
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  for (let i = 0; i <= SEG_U; i++) {
    for (let j = 0; j <= SEG_V; j++) {
      const idx = i * cv + j;
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(SEG_U, i + 1);
      const j0 = Math.max(0, j - 1);
      const j1 = Math.min(SEG_V, j + 1);
      du.subVectors(center[i1 * cv + j], center[i0 * cv + j]);
      dv.subVectors(center[i * cv + j1], center[i * cv + j0]);
      // du ~ +Y, dv ~ +X → cross(dv, du) = +Z-ish (front of petal)
      nor[idx] = new THREE.Vector3().crossVectors(dv, du).normalize();
    }
  }

  // Outer + inner shells (F03 normals come from computeVertexNormals after weld)
  const pos = new Float32Array(nSurface * 2 * 3);
  const uvs = new Float32Array(nSurface * 2 * 2);
  // Optional scalar thickness (full path) for later thicknessMap bake — cheap attr
  const thickAttr = new Float32Array(nSurface * 2);

  for (let i = 0; i <= SEG_U; i++) {
    const u = i / SEG_U;
    for (let j = 0; j <= SEG_V; j++) {
      const v = j / SEG_V;
      const idx = i * cv + j;
      const c = center[idx];
      const n = nor[idx];
      const h = halfT[idx];
      const fullT = h * 2;

      const o = idx * 3;
      pos[o] = c.x + n.x * h;
      pos[o + 1] = c.y + n.y * h;
      pos[o + 2] = c.z + n.z * h;
      uvs[idx * 2] = v;
      uvs[idx * 2 + 1] = u;
      thickAttr[idx] = fullT;

      const ii = nSurface + idx;
      const io = ii * 3;
      pos[io] = c.x - n.x * h;
      pos[io + 1] = c.y - n.y * h;
      pos[io + 2] = c.z - n.z * h;
      uvs[ii * 2] = v;
      uvs[ii * 2 + 1] = u;
      thickAttr[ii] = fullT;
    }
  }

  const indices = [];

  // Outer quads (CCW from +normal / front)
  for (let i = 0; i < SEG_U; i++) {
    for (let j = 0; j < SEG_V; j++) {
      const a = i * cv + j;
      const b = i * cv + (j + 1);
      const c = (i + 1) * cv + (j + 1);
      const d = (i + 1) * cv + j;
      indices.push(a, b, c, a, c, d);
    }
  }

  // Inner quads (reversed winding, index offset)
  const off = nSurface;
  for (let i = 0; i < SEG_U; i++) {
    for (let j = 0; j < SEG_V; j++) {
      const a = off + i * cv + j;
      const b = off + i * cv + (j + 1);
      const c = off + (i + 1) * cv + (j + 1);
      const d = off + (i + 1) * cv + j;
      indices.push(a, c, b, a, d, c);
    }
  }

  // Rim wall along UV-domain boundary (outward normals for FrontSide glass)
  function addRim(outerA, outerB) {
    const innerA = outerA + off;
    const innerB = outerB + off;
    // reverse prior inward winding: outerA → innerB → outerB / outerA → innerA → innerB
    indices.push(outerA, innerB, outerB, outerA, innerA, innerB);
  }

  // u=0 base, j: 0 → nv
  for (let j = 0; j < SEG_V; j++) addRim(0 * cv + j, 0 * cv + (j + 1));
  // v=1 right, i: 0 → nu
  for (let i = 0; i < SEG_U; i++) addRim(i * cv + SEG_V, (i + 1) * cv + SEG_V);
  // u=1 tip, j: nv → 0
  for (let j = SEG_V; j > 0; j--) addRim(SEG_U * cv + j, SEG_U * cv + (j - 1));
  // v=0 left, i: nu → 0
  for (let i = SEG_U; i > 0; i--) addRim(i * cv + 0, (i - 1) * cv + 0);

  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // Analytic nrm used only as loft offset guide above; do not hash into weld
  // (mergeVertices keys on ALL attrs — differing face normals would block position welds).
  raw.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  raw.setAttribute('thickness', new THREE.BufferAttribute(thickAttr, 1));
  raw.setIndex(indices);

  // F03: weld coincident verts (shell-rim joins / any near-dup grid verts).
  // Small epsilon << min shell half-thickness (~0.0017) so outer/inner never collapse.
  // uv + thickness preserved; rim index winding left intact.
  const beforeVerts = raw.getAttribute('position').count;
  const geo = mergeVertices(raw, 1e-4);
  raw.dispose();
  const afterVerts = geo.getAttribute('position').count;
  geo.userData.weldBeforeVerts = beforeVerts;
  geo.userData.weldAfterVerts = afterVerts;

  // Smooth normals on welded topology; rim stays outward-wound from addRim indices
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  geo.userData.petalSeed = seed;
  geo.userData.thickBias = thickBias;
  geo.userData.edgeWear = edgeWear;
  return geo;
}

/**
 * Phyllotaxis rose ~1 world unit tall.
 * userData: petalMeshes, sepalMeshes, stem, receptacle, bloomCenter, geometries
 *
 * F02: 32 unique petal BufferGeometries (seeded loft variation).
 * Sepals share one blueprint geo. Materials stay shared at RoseRig (one ruby mat).
 *
 * F18: userData.stem is StemAssembly (THREE.Group) — Stem mesh + Thorn meshes as
 * siblings under the group (not nested under the lathe mesh). RoseRig._assign
 * traverses it for shared stemGlass. Optical same; cleaner GLB hierarchy match.
 */
export function buildProceduralRose() {
  const root = new THREE.Group();
  root.name = 'RoseRig';

  const geometries = [];
  const petals = new THREE.Group();
  petals.name = 'Petals';

  const count = 32;
  for (let i = 0; i < count; i++) {
    // Unique loft per petal — thickness/wear/tip differ (F02)
    const petalGeo = makePetalGeometry({ seed: i + 1, vary: true });
    geometries.push(petalGeo);

    const mesh = new THREE.Mesh(petalGeo);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `Petal_${i}`;
    mesh.userData.geoSeed = i + 1;

    const t = i / (count - 1);
    const yaw = i * GOLDEN;
    const radius = 0.012 + 0.145 * Math.sqrt(t);
    const open = 1 / (1 + Math.exp(-(t - 0.32) * 9));
    const pitch = THREE.MathUtils.lerp(0.22, 1.18, open);
    const lift = 0.14 + t * 0.52 + (1 - open) * 0.1;

    mesh.position.set(Math.cos(yaw) * radius, lift, Math.sin(yaw) * radius);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = yaw;
    mesh.rotation.x = pitch;
    mesh.rotation.z = (t - 0.5) * 0.12;
    mesh.userData.baseRotZ = mesh.rotation.z;
    const s = THREE.MathUtils.lerp(0.48, 1.02, open);
    mesh.scale.setScalar(s * THREE.MathUtils.lerp(0.9, 1.15, Math.sin(t * Math.PI)));
    petals.add(mesh);
  }
  root.add(petals);

  const receptacleGeo = new THREE.SphereGeometry(0.055, 20, 14);
  geometries.push(receptacleGeo);
  const receptacle = new THREE.Mesh(receptacleGeo);
  receptacle.position.y = 0.2;
  receptacle.scale.set(1, 0.75, 1);
  receptacle.name = 'Receptacle';
  receptacle.castShadow = true;
  root.add(receptacle);

  // Sepals: one shared loft blueprint (no per-sepal unique needed)
  const sepalGeo = makePetalGeometry({ seed: 0, vary: false });
  geometries.push(sepalGeo);
  const sepals = new THREE.Group();
  sepals.name = 'Sepals';
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(sepalGeo);
    const yaw = (i / 5) * Math.PI * 2;
    m.position.set(Math.cos(yaw) * 0.035, 0.15, Math.sin(yaw) * 0.035);
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.rotation.x = 1.4;
    m.scale.set(0.35, 0.45, 0.35);
    m.castShadow = true;
    m.userData.baseRotZ = 0;
    sepals.add(m);
  }
  root.add(sepals);

  // F18: StemAssembly group — lathed stem + thorns as sibling meshes (GLB-friendly)
  const stemAssembly = new THREE.Group();
  stemAssembly.name = 'StemAssembly';
  stemAssembly.position.set(0.015, -0.4, 0);
  stemAssembly.rotation.z = 0.07;

  const stemPts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    stemPts.push(new THREE.Vector2(THREE.MathUtils.lerp(0.018, 0.01, t), t * 0.55));
  }
  const stemGeo = new THREE.LatheGeometry(stemPts, 16);
  geometries.push(stemGeo);
  const stem = new THREE.Mesh(stemGeo);
  stem.name = 'Stem';
  stem.castShadow = true;
  stem.receiveShadow = true;
  stemAssembly.add(stem);

  const thornGeo = new THREE.ConeGeometry(0.01, 0.035, 6);
  geometries.push(thornGeo);
  for (let i = 0; i < 5; i++) {
    const th = new THREE.Mesh(thornGeo);
    th.name = `Thorn_${i}`;
    th.position.set(
      0.02 + Math.cos(i * 2.2) * 0.015,
      0.08 + i * 0.08,
      Math.sin(i * 2.2) * 0.012
    );
    th.rotation.z = Math.PI / 2 + (i % 2 ? 0.35 : -0.35);
    th.castShadow = true;
    stemAssembly.add(th);
  }
  root.add(stemAssembly);

  root.userData.bloomCenter = new THREE.Vector3(0, 0.42, 0);
  root.userData.petalMeshes = petals.children.slice();
  // F18: stem = StemAssembly Group (Stem + Thorn_* siblings); traverse for materials
  root.userData.stem = stemAssembly;
  root.userData.sepalMeshes = sepals.children.slice();
  root.userData.receptacle = receptacle;
  // All unique petal geos + sepal + stem parts — RoseRig wraps in Set (dispose once each)
  root.userData.geometries = geometries;

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return root;
}
