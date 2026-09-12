import * as THREE from 'three/webgpu';

function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

/**
 * Minimal P0/proof backdrop: neutral solid env, ground plane, key+hemi lights.
 * No forest density, no HDRI tax, no fog.
 */
export class ProofBackdrop {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'ProofBackdrop';
    this._assets = [];
  }

  /** Solid neutral background + optional weak room-like env via hemi only. */
  setupEnvironment(scene) {
    const bg = srgb(0x2a3034);
    scene.background = bg;
    scene.environment = null;
    scene.fog = null;
    if ('backgroundBlurriness' in scene) scene.backgroundBlurriness = 0;
    if ('backgroundIntensity' in scene) scene.backgroundIntensity = 1;
    return null;
  }

  build() {
    const groundGeo = new THREE.PlaneGeometry(4, 4, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({
      color: srgb(0x1c2220),
      roughness: 0.85,
      metalness: 0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ProofGround';
    this.group.add(ground);
    this.ground = ground;
    this._assets.push(groundGeo, groundMat);
    return this.group;
  }

  addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xd8e0e4, 0x1a1e20, 0.55);
    scene.add(hemi);
    this.hemi = hemi;

    const key = new THREE.DirectionalLight(0xfff4ea, 1.85);
    key.position.set(2.8, 5.5, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 16;
    key.shadow.camera.left = -2.5;
    key.shadow.camera.right = 2.5;
    key.shadow.camera.bottom = -2.5;
    key.shadow.camera.top = 2.5;
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    this.key = key;
    this.sun = key;

    const fill = new THREE.DirectionalLight(0xb0c0d0, 0.35);
    fill.position.set(-2.5, 3.0, -1.5);
    scene.add(fill);
    this.fill = fill;
  }

  update(_t) {
    // static
  }

  dispose() {
    for (const a of this._assets) {
      if (a && a.dispose) a.dispose();
    }
    this._assets.length = 0;
  }
}

/** True when ?proof=1 or ?p0=1 (any truthy-ish value other than 0/false). */
export function wantProof(search = location.search) {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const v = q.get('proof') ?? q.get('p0');
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'no';
}
