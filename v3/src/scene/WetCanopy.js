import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * Wet night canopy — dense enough that refraction through the bloom has something to read.
 */
export class WetCanopy {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'WetCanopy';
    this._geo = [];
  }

  async loadEnvironment(scene, renderer) {
    const loader = new HDRLoader();
    const url = new URL('../../public/hdr/env.hdr', import.meta.url).href;
    const tex = await loader.loadAsync(url);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = tex;
    scene.background = new THREE.Color(0x050308);
    scene.environmentIntensity = 0.85;
    scene.backgroundBlurriness = 0.35;
    this.env = tex;
  }

  build() {
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a100e,
      roughness: 0.35,
      metalness: 0.05,
      envMapIntensity: 1.2
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this._geo.push(ground.geometry);

    // Wet reflective puddle discs
    const puddleMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a2228,
      roughness: 0.05,
      metalness: 0.0,
      transmission: 0.55,
      thickness: 0.02,
      ior: 1.333,
      transparent: true,
      envMapIntensity: 1.4
    });
    this.puddleMat = puddleMat;
    for (let i = 0; i < 7; i++) {
      const r = 0.25 + Math.random() * 0.55;
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), puddleMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((Math.random() - 0.5) * 4.5, 0.004, (Math.random() - 0.5) * 4.5);
      m.renderOrder = 1;
      this.group.add(m);
      this._geo.push(m.geometry);
    }

    // Silhouette trunks / fern proxies — optical density for refraction
    const bark = new THREE.MeshStandardMaterial({ color: 0x12100e, roughness: 0.9 });
    for (let i = 0; i < 9; i++) {
      const h = 1.4 + Math.random() * 2.2;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, h, 7), bark);
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const rad = 2.2 + (i % 3) * 0.55;
      trunk.position.set(Math.cos(a) * rad, h * 0.5, Math.sin(a) * rad);
      this.group.add(trunk);
      this._geo.push(trunk.geometry);
    }

    const fern = new THREE.MeshStandardMaterial({
      color: 0x142818,
      roughness: 0.75,
      side: THREE.DoubleSide
    });
    for (let i = 0; i < 24; i++) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.55), fern);
      const a = Math.random() * Math.PI * 2;
      const rad = 0.6 + Math.random() * 2.8;
      blade.position.set(Math.cos(a) * rad, 0.25, Math.sin(a) * rad);
      blade.rotation.y = a;
      blade.rotation.x = -0.4 - Math.random() * 0.5;
      this.group.add(blade);
      this._geo.push(blade.geometry);
    }

    return this.group;
  }

  addLights(scene) {
    const hemi = new THREE.HemisphereLight(0x6a7a99, 0x0a0806, 0.35);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xc8d4ff, 1.1);
    key.position.set(2.5, 5.5, 1.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    // broken shaft
    const shaft = new THREE.SpotLight(0xffe6cc, 2.2, 12, 0.28, 0.55, 1.2);
    shaft.position.set(-1.2, 4.5, 2.0);
    shaft.target.position.set(0, 0.4, 0);
    scene.add(shaft);
    scene.add(shaft.target);
    this._lights = [hemi, key, shaft];
  }

  dispose() {
    for (const g of this._geo) g.dispose();
    this.puddleMat?.dispose();
    this.env?.dispose();
  }
}
