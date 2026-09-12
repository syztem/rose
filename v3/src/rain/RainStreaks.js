import * as THREE from 'three/webgpu';

/** Falling rain — instanced thin boxes with per-frame matrix updates. */
export class RainStreaks {
  constructor({ count = 4000 } = {}) {
    this.count = count;
    this.active = count;
    const geo = new THREE.BoxGeometry(0.004, 0.12, 0.004);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9eb6c8,
      transparent: true,
      opacity: 0.28,
      depthWrite: false
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.geo = geo;
    this.mat = mat;

    this._y = new Float32Array(count);
    this._x = new Float32Array(count);
    this._z = new Float32Array(count);
    this._sp = new Float32Array(count);
    const dummy = new THREE.Object3D();
    this._dummy = dummy;
    for (let i = 0; i < count; i++) {
      this._x[i] = (Math.random() - 0.5) * 8;
      this._y[i] = Math.random() * 6;
      this._z[i] = (Math.random() - 0.5) * 8;
      this._sp[i] = 2.6 + Math.random() * 3.8;
      dummy.position.set(this._x[i], this._y[i], this._z[i]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setActive(n) {
    this.active = Math.max(0, Math.min(this.count, n | 0));
    this.mesh.count = this.active;
  }

  update(dt) {
    const d = this._dummy;
    const n = this.active;
    for (let i = 0; i < n; i++) {
      this._y[i] -= this._sp[i] * dt;
      this._x[i] += dt * 0.12;
      if (this._y[i] < -0.15) {
        this._y[i] = 5.2 + Math.random() * 1.5;
        this._x[i] = (Math.random() - 0.5) * 8;
        this._z[i] = (Math.random() - 0.5) * 8;
      }
      d.position.set(this._x[i], this._y[i], this._z[i]);
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
