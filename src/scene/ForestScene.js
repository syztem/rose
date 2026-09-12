import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

function makeFernBlade() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.04, 0.15, 0.0, 0.42);
  shape.quadraticCurveTo(-0.04, 0.15, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.006,
    bevelEnabled: false,
    steps: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -0.003);
  return geo;
}

function resolveHdrUrl() {
  // Page-relative so GitHub project pages (/user/repo/) resolve correctly.
  // Vite/public serve also maps /hdr/* if mirrored; we keep public/hdr for static Pages.
  return new URL('public/hdr/env.hdr', document.baseURI || window.location.href).href;
}

/**
 * Dense near-field forest blockout so transmission has something to bend.
 */
export class ForestScene {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Forest';
    this._assets = [];
    this.ferns = [];
  }

  async loadEnvironment(scene) {
    let envMap = null;
    try {
      const loader = new HDRLoader();
      const url = resolveHdrUrl();
      envMap = await loader.loadAsync(url);
      envMap.mapping = THREE.EquirectangularReflectionMapping;
      envMap.colorSpace = THREE.LinearSRGBColorSpace;
      scene.environment = envMap;
      scene.environmentIntensity = 0.85;
      scene.background = envMap;
      if ('backgroundBlurriness' in scene) scene.backgroundBlurriness = 0.12;
      if ('backgroundIntensity' in scene) scene.backgroundIntensity = 0.55;
      this._assets.push(envMap);
    } catch (err) {
      console.warn('[ForestScene] HDR load failed, solid fallback', err);
      scene.background = srgb(0x8a9a8e);
      scene.environment = null;
    }

    scene.fog = new THREE.FogExp2(0x8a9a8e, 0.045);
    return envMap;
  }

  build() {
    const groundGeo = new THREE.PlaneGeometry(14, 14, 64, 64);
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const h =
        Math.sin(x * 1.3) * Math.cos(y * 1.1) * 0.04 +
        Math.sin(x * 4.1 + y * 2.3) * 0.012;
      pos.setZ(i, h);
    }
    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshStandardMaterial({
      color: srgb(0x1a2218),
      roughness: 0.62,
      metalness: 0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'Ground';
    this.group.add(ground);
    this.ground = ground;
    this._assets.push(groundGeo, groundMat);

    const bark = new THREE.MeshStandardMaterial({
      color: srgb(0x2a221c),
      roughness: 0.92,
      metalness: 0
    });
    this._assets.push(bark);
    for (let i = 0; i < 12; i++) {
      const h = 2.2 + (i % 4) * 0.35;
      const geo = new THREE.CylinderGeometry(0.07 + (i % 3) * 0.02, 0.11, h, 8);
      const mesh = new THREE.Mesh(geo, bark);
      const ang = (i / 12) * Math.PI * 2 + 0.3;
      const rad = 2.4 + (i % 5) * 0.35;
      mesh.position.set(Math.cos(ang) * rad, h * 0.5, Math.sin(ang) * rad - 0.6);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this._assets.push(geo);
    }

    const bladeGeo = makeFernBlade();
    const fernMat = new THREE.MeshStandardMaterial({
      color: srgb(0x1c3a22),
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide
    });
    this._assets.push(bladeGeo, fernMat);
    // deterministic-ish layout for stable refraction subject
    for (let i = 0; i < 36; i++) {
      const g = new THREE.Group();
      const ang = (i * 2.399) % (Math.PI * 2);
      const rad = 0.55 + ((i * 0.17) % 1.1);
      g.position.set(Math.cos(ang) * rad, 0.02, Math.sin(ang) * rad - 0.15);
      const blades = 5 + (i % 4);
      for (let b = 0; b < blades; b++) {
        const m = new THREE.Mesh(bladeGeo, fernMat);
        m.rotation.y = (b / blades) * Math.PI * 2 + i * 0.2;
        m.rotation.x = -0.45 - (i % 5) * 0.05;
        m.rotation.z = ((b % 3) - 1) * 0.15;
        m.scale.setScalar(0.75 + (i % 4) * 0.12);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      }
      this.group.add(g);
      this.ferns.push(g);
    }

    const mossMat = new THREE.MeshStandardMaterial({
      color: srgb(0x243f28),
      roughness: 0.85,
      metalness: 0
    });
    this._assets.push(mossMat);
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.SphereGeometry(0.08 + (i % 4) * 0.015, 8, 6);
      const m = new THREE.Mesh(geo, mossMat);
      const ang = (i / 10) * Math.PI * 2;
      const rad = 0.5 + (i % 5) * 0.22;
      m.position.set(Math.cos(ang) * rad, 0.03, Math.sin(ang) * rad);
      m.scale.set(1.4, 0.45, 1.1);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this._assets.push(geo);
    }

    return this.group;
  }

  addPuddles(waterMat) {
    const geo = new THREE.CircleGeometry(1, 24);
    this._assets.push(geo);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(geo, waterMat);
      const ang = (i / 7) * Math.PI * 2 + 0.4;
      const rad = 0.7 + (i % 3) * 0.25;
      m.rotation.x = -Math.PI / 2;
      m.position.set(Math.cos(ang) * rad, 0.015, Math.sin(ang) * rad + 0.2);
      m.scale.setScalar(0.12 + (i % 3) * 0.04);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  addLights(scene) {
    const hemi = new THREE.HemisphereLight(0xc9d6cf, 0x1a2418, 0.35);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xe8efe4, 1.6);
    sun.position.set(4.2, 7.5, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 24;
    sun.shadow.camera.left = -4;
    sun.shadow.camera.right = 4;
    sun.shadow.camera.bottom = -4;
    sun.shadow.camera.top = 4;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    this.sun = sun;
    this.hemi = hemi;

    const fill = new THREE.DirectionalLight(0xb7c4cc, 0.25);
    fill.position.set(-3, 4, -2);
    scene.add(fill);
    this.fill = fill;
  }

  update(t) {
    for (let i = 0; i < this.ferns.length; i++) {
      this.ferns[i].rotation.z = Math.sin(t * 1.2 + i) * 0.012;
    }
  }

  dispose() {
    for (const a of this._assets) {
      if (a && a.dispose) a.dispose();
    }
    this._assets.length = 0;
  }
}
