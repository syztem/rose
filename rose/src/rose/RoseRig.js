import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { buildProceduralRose } from './proceduralRose.js';
import { createRubyGlass, createStemGlass } from './GlassMaterials.js';

/**
 * Rose group + shared glass materials.
 * Default: procedural. Optional: await loadGLB('models/rose.glb') when asset lands.
 */
export class RoseRig {
  constructor() {
    this.group = buildProceduralRose();
    this.glass = createRubyGlass();
    this.stemGlass = createStemGlass();
    this._geometries = new Set(this.group.userData.geometries || []);
    this._assign();
    this._source = 'procedural';
  }

  _assign() {
    const petals = this.group.userData.petalMeshes || [];
    for (const m of petals) m.material = this.glass;
    for (const m of this.group.userData.sepalMeshes || []) m.material = this.stemGlass;
    if (this.group.userData.receptacle) this.group.userData.receptacle.material = this.stemGlass;
    if (this.group.userData.stem) {
      this.group.userData.stem.traverse((o) => {
        if (o.isMesh) o.material = this.stemGlass;
      });
    }
  }

  get bloomCenter() {
    return this.group.userData.bloomCenter.clone();
  }

  get petalMeshes() {
    return this.group.userData.petalMeshes || [];
  }

  /**
   * Replace procedural body with authored GLB when present.
   * Expects meshes named Petal / Sepal / Stem / Receptacle (case-insensitive).
   * Materials from file are discarded; glass factories win.
   */
  async loadGLB(url = 'public/models/rose.glb') {
    const resolved = new URL(url, document.baseURI || window.location.href).href;
    try {
      const head = await fetch(resolved, { method: 'HEAD' });
      if (!head.ok) return false; // no asset yet — stay procedural, silent
    } catch {
      return false;
    }

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    // CDN wasm — optional; undraco'd glb still loads
    draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/libs/draco/gltf/');
    loader.setDRACOLoader(draco);

    let gltf;
    try {
      gltf = await loader.loadAsync(resolved);
    } catch (e) {
      console.warn('[RoseRig] GLB load failed, keeping procedural:', e?.message || e);
      draco.dispose();
      return false;
    }

    // tear down procedural geos (unique set)
    this._disposeGeometries();
    while (this.group.children.length) this.group.remove(this.group.children[0]);

    const petals = [];
    const sepals = [];
    let stem = null;
    let receptacle = null;
    const box = new THREE.Box3();

    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const n = (o.name || '').toLowerCase();
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.geometry) this._geometries.add(o.geometry);
      if (n.includes('petal')) petals.push(o);
      else if (n.includes('sepal')) sepals.push(o);
      else if (n.includes('stem') || n.includes('thorn')) {
        if (!stem) stem = o;
        o.material = this.stemGlass;
      } else if (n.includes('recept') || n.includes('ovary')) {
        receptacle = o;
        o.material = this.stemGlass;
      } else {
        // default: treat as petal glass
        petals.push(o);
      }
    });

    for (const p of petals) p.material = this.glass;
    for (const s of sepals) s.material = this.stemGlass;

    this.group.add(gltf.scene);
    box.setFromObject(this.group);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = 1.0;
    if (size.y > 1e-4) {
      const s = targetH / size.y;
      gltf.scene.scale.multiplyScalar(s);
      box.setFromObject(this.group);
    }
    const center = new THREE.Vector3();
    box.getCenter(center);
    gltf.scene.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));

    box.setFromObject(this.group);
    const bloom = new THREE.Vector3();
    box.getCenter(bloom);
    bloom.y = box.min.y + (box.max.y - box.min.y) * 0.62;

    this.group.userData.petalMeshes = petals.length ? petals : this._collectMeshes(gltf.scene);
    this.group.userData.sepalMeshes = sepals;
    this.group.userData.stem = stem;
    this.group.userData.receptacle = receptacle;
    this.group.userData.bloomCenter = bloom;
    this._source = 'glb';
    draco.dispose();
    return true;
  }

  _collectMeshes(root) {
    const out = [];
    root.traverse((o) => {
      if (o.isMesh) out.push(o);
    });
    return out;
  }

  /** Gentle wind sway — amplitude ~0.4°. Never accumulate into rotation.z. */
  update(t, windYaw = 0) {
    const a = 0.007;
    this.group.rotation.z = Math.sin(t * 0.7 + windYaw) * a;
    this.group.rotation.x = Math.cos(t * 0.55) * a * 0.6;
    const petals = this.petalMeshes;
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      const base = p.userData.baseRotZ ?? 0;
      p.rotation.z = base + Math.sin(t * 0.9 + i * 0.4) * 0.012;
    }
  }

  _disposeGeometries() {
    for (const g of this._geometries) {
      if (g && g.dispose) g.dispose();
    }
    this._geometries.clear();
  }

  dispose() {
    this._disposeGeometries();
    this.glass.dispose();
    this.stemGlass.dispose();
  }
}
