import * as THREE from 'three/webgpu';

/**
 * Water beads — separate dielectric (IOR 1.333) from glass (1.52).
 * Drift on an orbital shell around the bloom.
 */
export class WaterBeads {
  constructor({ count = 90 } = {}) {
    this.count = count;
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.02,
      transmission: 1,
      thickness: 0.35,
      ior: 1.333,
      transparent: true,
      attenuationColor: new THREE.Color(0xd8e8f5),
      attenuationDistance: 1.2,
      envMapIntensity: 1.5
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.renderOrder = 20;
    this.mesh.castShadow = true;
    this.geo = geo;
    this.mat = mat;
    this._dummy = new THREE.Object3D();
    this._data = [];
    for (let i = 0; i < count; i++) {
      this._data.push({
        yaw: Math.random() * Math.PI * 2,
        pitch: 0.15 + Math.random() * 1.1,
        r: 0.22 + Math.random() * 0.38,
        s: 0.008 + Math.random() * 0.016,
        spin: 0.15 + Math.random() * 0.55
      });
    }
  }

  update(t) {
    const d = this._dummy;
    for (let i = 0; i < this.count; i++) {
      const b = this._data[i];
      const yaw = b.yaw + t * b.spin * 0.12;
      const y = 0.25 + Math.sin(b.pitch) * b.r * 0.85 + Math.sin(t * 0.7 + i) * 0.01;
      const x = Math.cos(yaw) * Math.cos(b.pitch * 0.65) * b.r;
      const z = Math.sin(yaw) * Math.cos(b.pitch * 0.65) * b.r;
      d.position.set(x, y + 0.35, z);
      d.scale.setScalar(b.s);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}
