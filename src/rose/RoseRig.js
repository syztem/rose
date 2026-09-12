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
   * Existence probe for optional GLB.
   * Static hosts often reject HEAD (405/501/403) while GET works — fall back to a
   * cheap ranged GET before treating as missing. 404/network → false (procedural).
   */
  async _probeAsset(url) {
    let methodBlocked = false;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (head.ok) return true;
      methodBlocked =
        head.status === 405 ||
        head.status === 501 ||
        head.status === 403 ||
        /method\s*not\s*allowed/i.test(head.statusText || '');
      // 404 and other misses: stay procedural, no GET retry
      if (!methodBlocked) return false;
    } catch {
      // Network miss on HEAD — silent procedural
      return false;
    }

    // Static hosts often reject HEAD while GET works
    try {
      const get = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' }
      });
      // 200 / 206 = present; 404 etc. = miss
      if (get.ok || get.status === 206) {
        try {
          get.body?.cancel?.();
        } catch {
          /* ignore */
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Collect unique mesh materials (incl. multi-material arrays) from a graph.
   */
  _collectMaterials(root) {
    const mats = new Set();
    root.traverse((o) => {
      if (!o.isMesh || o.material == null) return;
      const m = o.material;
      if (Array.isArray(m)) {
        for (const x of m) if (x) mats.add(x);
      } else {
        mats.add(m);
      }
    });
    return mats;
  }

  /**
   * Dispose discarded GLTF file materials + their textures/maps.
   * Never touches this.glass / this.stemGlass (factory-owned).
   */
  _disposeDiscardedMaterials(materials) {
    for (const mat of materials) {
      if (!mat || mat === this.glass || mat === this.stemGlass) continue;
      for (const value of Object.values(mat)) {
        if (value && value.isTexture && typeof value.dispose === 'function') {
          value.dispose();
        }
      }
      if (typeof mat.dispose === 'function') mat.dispose();
    }
  }

  /**
   * Replace procedural body with authored GLB when present.
   * Expects meshes named Petal / Sepal / Stem / Receptacle (case-insensitive).
   * Materials from file are discarded; glass factories win.
   */
  async loadGLB(url = 'public/models/rose.glb') {
    const resolved = new URL(url, document.baseURI || window.location.href).href;

    const exists = await this._probeAsset(resolved);
    if (!exists) return false; // no asset yet — stay procedural, silent

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

    // Snapshot file materials before swap (unique set)
    const fileMats = this._collectMaterials(gltf.scene);

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

    // File mats discarded for glass factories — free GPU resources
    this._disposeDiscardedMaterials(fileMats);

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
