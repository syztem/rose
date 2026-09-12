import * as THREE from 'three/webgpu';

/**
 * Atmospheric rain — non-transmissive instanced streaks.
 * CPU-updated; stagger half the instances per frame to cut write cost.
 */
export class RainSystem {
  constructor({ count = 10000 } = {}) {
    this.count = count;
    this.speed = 4.8;
    this.wind = new THREE.Vector3(0.04, 0, 0.02);
    this._t = 0;
    this._parity = 0;

    const geo = new THREE.PlaneGeometry(0.0018, 0.12);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHex(0xb7c4cc, THREE.SRGBColorSpace),
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'RainStreaks';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this._seeds = new Float32Array(count * 4);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 8;
      const y = Math.random() * 8;
      const z = (Math.random() - 0.5) * 8;
      const phase = Math.random();
      this._seeds[i * 4] = x;
      this._seeds[i * 4 + 1] = y;
      this._seeds[i * 4 + 2] = z;
      this._seeds[i * 4 + 3] = phase;
      dummy.position.set(x, y, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this._dummy = dummy;
    this._geo = geo;
    this._mat = mat;
  }

  update(dt, camera, windYaw = 0) {
    this._t += dt;
    this._parity ^= 1;
    const dummy = this._dummy;
    const cam = camera.position;
    const wx = Math.sin(windYaw) * 0.35 + this.wind.x;
    const wz = Math.cos(windYaw) * 0.15 + this.wind.z;
    const fall = this.speed;
    // advance seeds every frame; rewrite matrices on alternate halves
    const step = 2;

    for (let i = 0; i < this.count; i++) {
      const i4 = i * 4;
      let x = this._seeds[i4];
      let y = this._seeds[i4 + 1];
      let z = this._seeds[i4 + 2];
      const phase = this._seeds[i4 + 3];

      y -= fall * dt;
      x += wx * dt;
      z += wz * dt;

      if (y < -0.2) {
        y = 6 + Math.random() * 2;
        x = cam.x + (Math.random() - 0.5) * 8;
        z = cam.z + (Math.random() - 0.5) * 8 - 0.5;
      }

      const dx = x - cam.x;
      const dz = z - cam.z;
      if (dx * dx + dz * dz > 25) {
        x = cam.x + (Math.random() - 0.5) * 6;
        z = cam.z + (Math.random() - 0.5) * 6;
      }

      this._seeds[i4] = x;
      this._seeds[i4 + 1] = y;
      this._seeds[i4 + 2] = z;

      if ((i & 1) !== this._parity) continue;

      dummy.position.set(x, y, z);
      const len = 0.85 + phase * 0.4;
      dummy.scale.set(1, len, 1);
      dummy.lookAt(cam.x, y, cam.z);
      dummy.rotateX(Math.PI / 2);
      dummy.rotateZ(Math.atan2(wx, -fall) * 0.5);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this._geo.dispose();
    this._mat.dispose();
  }
}
