/**
 * Rose v2 GLB exporter — loft thick petals + bake maps.
 * Tool: Node + three@0.186 GLTFExporter + pngjs.
 * Quality: same 32×16 dual-shell loft as proceduralRose (F01/F02); no Blender sculpt.
 * Limits: parametric loft only (not hand-authored hero sculpt); 512 bake maps; undraco GLB.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Node has Blob; three GLTFExporter still needs FileReader for binary packing.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
    }
    readAsArrayBuffer(blob) {
      Promise.resolve(blob.arrayBuffer())
        .then((buf) => {
          this.result = buf;
          this.onloadend?.({ target: this });
        })
        .catch((e) => this.onerror?.(e));
    }
    readAsDataURL(blob) {
      Promise.resolve(blob.arrayBuffer())
        .then((buf) => {
          this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
          this.onloadend?.({ target: this });
        })
        .catch((e) => this.onerror?.(e));
    }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../out');
const GOLDEN = 137.508 * (Math.PI / 180);

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makePetalGeometry(opts = {}) {
  const seed = opts.seed ?? 0;
  const vary = opts.vary !== false;
  const rng = mulberry32((seed * 2654435761) ^ 0x9e3779b9);

  const thickBias = vary ? 0.82 + rng() * 0.36 : 1;
  const edgeWear = vary ? 0.7 + rng() * 0.7 : 1;
  const tipCurlBias = vary ? 0.65 + rng() * 0.75 : 1;
  const bellyBias = vary ? 0.92 + rng() * 0.16 : 1;
  const cupBias = vary ? 0.88 + rng() * 0.24 : 1;
  const veinBias = vary ? 0.85 + rng() * 0.3 : 1;
  const tipLean = vary ? (rng() - 0.5) * 0.022 : 0;

  const SEG_V = 32;
  const SEG_U = 16;
  const LEN = 0.78;
  const T_HALF_MIN = 0.002;
  const T_HALF_MAX = 0.006;

  const cu = SEG_U + 1;
  const cv = SEG_V + 1;
  const nSurface = cu * cv;

  function halfWidth(u) {
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
    x += tipLean * u * u * u;
    const y = u * LEN;
    const edge = Math.abs(v - 0.5) * 2;
    const mid = Math.exp(-(edge * 3.2) * (edge * 3.2));
    const cup = u * u * 0.12 * cupBias;
    const edgeRoll = edge * edge * u * 0.09;
    const vein = mid * 0.014 * Math.sin(u * Math.PI) * veinBias;
    const veinRipple = 0.0045 * Math.sin(u * 14) * mid * veinBias;
    const tipCurl = u * u * u * 0.028 * tipCurlBias;
    const z = cup + edgeRoll - vein + veinRipple + tipCurl;
    return out.set(x, y, z);
  }

  function halfThickness(u, v) {
    const edge = Math.abs(v - 0.5) * 2;
    const tip = THREE.MathUtils.smoothstep(0.55, 1.0, u);
    const edgeThin = edge * edge;
    const midBoost = Math.exp(-(edge * 2.4) * (edge * 2.4));
    const f =
      (1 - 0.55 * tip) *
      (1 - 0.48 * edgeThin * edgeWear) *
      (0.72 + 0.28 * midBoost);
    const h = THREE.MathUtils.lerp(T_HALF_MIN, T_HALF_MAX, THREE.MathUtils.clamp(f, 0, 1));
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
      nor[idx] = new THREE.Vector3().crossVectors(dv, du).normalize();
    }
  }

  const pos = new Float32Array(nSurface * 2 * 3);
  const uvs = new Float32Array(nSurface * 2 * 2);
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

  for (let i = 0; i < SEG_U; i++) {
    for (let j = 0; j < SEG_V; j++) {
      const a = i * cv + j;
      const b = i * cv + (j + 1);
      const c = (i + 1) * cv + (j + 1);
      const d = (i + 1) * cv + j;
      indices.push(a, b, c, a, c, d);
    }
  }

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

  function addRim(outerA, outerB) {
    const innerA = outerA + off;
    const innerB = outerB + off;
    indices.push(outerA, innerB, outerB, outerA, innerA, innerB);
  }

  for (let j = 0; j < SEG_V; j++) addRim(0 * cv + j, 0 * cv + (j + 1));
  for (let i = 0; i < SEG_U; i++) addRim(i * cv + SEG_V, (i + 1) * cv + SEG_V);
  for (let j = SEG_V; j > 0; j--) addRim(SEG_U * cv + j, SEG_U * cv + (j - 1));
  for (let i = SEG_U; i > 0; i--) addRim(i * cv + 0, (i - 1) * cv + 0);

  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  raw.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  raw.setAttribute('thickness', new THREE.BufferAttribute(thickAttr, 1));
  raw.setIndex(indices);

  const geo = mergeVertices(raw, 1e-4);
  raw.dispose();
  geo.computeVertexNormals();
  if (typeof geo.normalizeNormals === 'function') geo.normalizeNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  geo.userData.petalSeed = seed;
  return geo;
}

function buildRose() {
  const root = new THREE.Group();
  root.name = 'RoseRig';

  const petals = new THREE.Group();
  petals.name = 'Petals';
  const count = 32;
  for (let i = 0; i < count; i++) {
    const petalGeo = makePetalGeometry({ seed: i + 1, vary: true });
    const mesh = new THREE.Mesh(
      petalGeo,
      new THREE.MeshStandardMaterial({ color: 0x8b0010, name: 'PetalPlaceholder' })
    );
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    petals.add(mesh);
  }
  root.add(petals);

  const receptacle = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0x1a3a22, name: 'StemPlaceholder' })
  );
  receptacle.position.y = 0.2;
  receptacle.scale.set(1, 0.75, 1);
  receptacle.name = 'Receptacle';
  receptacle.castShadow = true;
  root.add(receptacle);

  const sepalGeo = makePetalGeometry({ seed: 0, vary: false });
  const sepals = new THREE.Group();
  sepals.name = 'Sepals';
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(
      sepalGeo,
      new THREE.MeshStandardMaterial({ color: 0x1a3a22, name: 'StemPlaceholder' })
    );
    m.name = `Sepal_${i}`;
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

  const stemAssembly = new THREE.Group();
  stemAssembly.name = 'StemAssembly';
  stemAssembly.position.set(0.015, -0.4, 0);
  stemAssembly.rotation.z = 0.07;

  const stemPts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    stemPts.push(new THREE.Vector2(THREE.MathUtils.lerp(0.018, 0.01, t), t * 0.55));
  }
  const stem = new THREE.Mesh(
    new THREE.LatheGeometry(stemPts, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a3a22, name: 'StemPlaceholder' })
  );
  stem.name = 'Stem';
  stem.castShadow = true;
  stem.receiveShadow = true;
  stemAssembly.add(stem);

  const thornGeo = new THREE.ConeGeometry(0.01, 0.035, 6);
  for (let i = 0; i < 5; i++) {
    const th = new THREE.Mesh(
      thornGeo,
      new THREE.MeshStandardMaterial({ color: 0x1a3a22, name: 'StemPlaceholder' })
    );
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

  root.updateMatrixWorld(true);
  return root;
}

/** Shared UV-domain bake: u = tip axis, v = width (matches loft uv = (v,u)). */
function bakeMaps(size = 512) {
  const thickness = new PNG({ width: size, height: size, colorType: 6 });
  const roughness = new PNG({ width: size, height: size, colorType: 6 });
  const veins = new PNG({ width: size, height: size, colorType: 6 });

  const T_MIN = 0.0034;
  const T_MAX = 0.0138;

  for (let y = 0; y < size; y++) {
    // PNG row 0 is top; loft u increases base→tip. With flipY textures, canvas y = (1-u)*size.
    // Bake with u at bottom so default flipY maps correctly: y=0 → u=1 (tip).
    const u = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const v = (x + 0.5) / size;
      const edge = Math.abs(v - 0.5) * 2;
      const mid = Math.exp(-(edge * 3.2) * (edge * 3.2));
      const tip = THREE.MathUtils.smoothstep(0.55, 1.0, u);
      const edgeThin = edge * edge;
      const midBoost = Math.exp(-(edge * 2.4) * (edge * 2.4));
      const f =
        (1 - 0.55 * tip) * (1 - 0.48 * edgeThin) * (0.72 + 0.28 * midBoost);
      const fullT = THREE.MathUtils.lerp(T_MIN, T_MAX, THREE.MathUtils.clamp(f, 0, 1));
      const tNorm = THREE.MathUtils.clamp((fullT - T_MIN) / (T_MAX - T_MIN), 0, 1);

      // roughness: base glass ~0.08; edges/tip wear higher
      const rough =
        0.06 +
        0.22 * edgeThin * (0.55 + 0.45 * tip) +
        0.08 * tip +
        0.04 * (1 - mid) * Math.sin(u * 18) * Math.sin(u * 18);

      // veins: midrib + lateral secondary (grayscale height for bump)
      const primary = mid * (0.55 + 0.45 * Math.sin(u * Math.PI));
      const lateral =
        0.35 *
        Math.exp(-Math.pow((edge - 0.35) * 5, 2)) *
        Math.abs(Math.sin(u * 9 + edge * 2));
      const tipVeins = tip * 0.2 * Math.abs(Math.sin(v * Math.PI * 6));
      const vein = THREE.MathUtils.clamp(primary * 0.75 + lateral * 0.55 + tipVeins, 0, 1);

      const i = (size * y + x) << 2;
      const tByte = Math.round(tNorm * 255);
      thickness.data[i] = tByte;
      thickness.data[i + 1] = tByte;
      thickness.data[i + 2] = tByte;
      thickness.data[i + 3] = 255;

      const rByte = Math.round(THREE.MathUtils.clamp(rough, 0, 1) * 255);
      roughness.data[i] = rByte;
      roughness.data[i + 1] = rByte;
      roughness.data[i + 2] = rByte;
      roughness.data[i + 3] = 255;

      const vByte = Math.round(vein * 255);
      veins.data[i] = vByte;
      veins.data[i + 1] = vByte;
      veins.data[i + 2] = vByte;
      veins.data[i + 3] = 255;
    }
  }

  return { thickness, roughness, veins };
}

function writePng(png, filePath) {
  const buf = PNG.sync.write(png);
  fs.writeFileSync(filePath, buf);
  return buf.length;
}

async function exportGlb(root) {
  const exporter = new GLTFExporter();
  const arrayBuffer = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: true,
    truncateDrawRange: true,
    embedImages: false,
    animations: [],
    // preserve userData.baseRotZ as node extras
  });
  return Buffer.from(arrayBuffer);
}

function countMeshes(root) {
  let n = 0;
  let tris = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    n++;
    const idx = o.geometry.index;
    const pos = o.geometry.getAttribute('position');
    tris += idx ? idx.count / 3 : pos.count / 3;
  });
  return { meshes: n, tris: Math.round(tris) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'textures'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });

  const root = buildRose();
  const stats = countMeshes(root);

  // Validate UV + thickness attrs on first petal
  const firstPetal = root.getObjectByName('Petal_0');
  if (!firstPetal?.geometry?.getAttribute('uv')) {
    throw new Error('Petal_0 missing UVs');
  }
  if (!firstPetal.geometry.getAttribute('thickness')) {
    throw new Error('Petal_0 missing thickness attr');
  }
  if (typeof firstPetal.userData.baseRotZ !== 'number') {
    throw new Error('Petal_0 missing baseRotZ');
  }

  const glb = await exportGlb(root);
  // magic glTF
  const magic = glb.toString('utf8', 0, 4);
  if (magic !== 'glTF') {
    throw new Error(`Not a GLB (magic=${JSON.stringify(magic)})`);
  }

  const glbPath = path.join(OUT, 'models', 'rose.glb');
  fs.writeFileSync(glbPath, glb);

  const maps = bakeMaps(512);
  const tLen = writePng(maps.thickness, path.join(OUT, 'textures', 'rose_thickness.png'));
  const rLen = writePng(maps.roughness, path.join(OUT, 'textures', 'rose_roughness.png'));
  const vLen = writePng(maps.veins, path.join(OUT, 'textures', 'rose_veins.png'));

  const manifest = {
    tool: 'node + three@0.186.0 GLTFExporter + pngjs',
    quality:
      'parametric 32×16 dual-shell loft (same F01/F02 as procedural); not hand-sculpted Blender hero',
    limits: [
      'no micro-displacement sculpt / no photogrammetry',
      '512² bake maps (shared UV domain)',
      'undraco binary GLB',
      'placeholder file materials (runtime ruby-glass + stem factories win)',
    ],
    meshes: stats.meshes,
    approxTris: stats.tris,
    glbBytes: glb.length,
    glbMagic: magic,
    baseRotZ: 'node extras userData.baseRotZ on Petal_* / Sepal_*',
    maps: {
      rose_thickness_png: tLen,
      rose_roughness_png: rLen,
      rose_veins_png: vLen,
    },
    naming: 'Petal_*, Sepal_*, Stem, Thorn_*, Receptacle, StemAssembly',
  };
  fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
  console.log('wrote', glbPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
