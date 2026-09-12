import * as THREE from "three/webgpu";
import {
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  color,
  range,
  fract,
  mod,
  uv,
  atan,
  abs
} from "three/tsl";

/**
 * Atmospheric rain — GPU SpriteNodeMaterial streaks (WebGPU/TSL).
 * Fall, wind drift, and camera-relative XZ wrap run in positionNode.
 * No per-frame lookAt / instanceMatrix writes.
 */
export class RainSystem {
  /**
   * @param {{ count?: number }} [opts]
   */
  constructor({ count = 12000 } = {}) {
    this.count = count;
    this.speed = 4.8;
    this.wind = new THREE.Vector3(0.04, 0, 0.02);
    this._t = 0;
    // Integrated wind displacement (∫ wind dt) — not wind*t (wrong under varying yaw)
    this._wx = 0;
    this._wz = 0;

    this._uTime = uniform(0);
    this._uSpeed = uniform(this.speed);
    this._uCam = uniform(new THREE.Vector3());
    this._uWind = uniform(new THREE.Vector3(this.wind.x, 0, this.wind.z));
    this._uWindIntegral = uniform(new THREE.Vector2(0, 0));

    const spanXZ = float(8);
    const halfXZ = float(4);
    const height = float(8);

    // Per-instance seeds (TSL range → instanced attributes)
    const seedX = range(-4, 4);
    const seedZ = range(-4, 4);
    const phase = range(0, 1);
    const lenScale = range(0.85, 1.25);

    const t = this._uTime;
    const cam = this._uCam;
    const wind = this._uWind;
    const windI = this._uWindIntegral;
    const spd = this._uSpeed;

    // Y cycles through [ -0.2, height-0.2 ) with phase offset
    const y = fract(phase.sub(t.mul(spd).div(height))).mul(height).sub(0.2);

    // XZ: integrated wind displacement + wrap into camera-relative box
    const xRel = mod(seedX.add(windI.x).add(halfXZ), spanXZ).sub(halfXZ);
    const zRel = mod(seedZ.add(windI.y).add(halfXZ), spanXZ).sub(halfXZ);
    const worldPos = vec3(cam.x.add(xRel), y, cam.z.add(zRel));

    const material = new THREE.SpriteNodeMaterial({
      depthWrite: false,
      transparent: true,
      sizeAttenuation: true
    });
    material.positionNode = worldPos;
    // Thin tall billboard streak (world units via size attenuation)
    material.scaleNode = vec2(float(0.0018), float(0.12).mul(lenScale));
    // Slight tilt from fall vs wind (matches prior atan2(wx, -fall) * 0.5)
    material.rotationNode = atan(wind.x, spd.negate()).mul(0.5);

    const u = uv();
    const edgeX = float(1).sub(abs(u.x.sub(0.5)).mul(2)).saturate();
    const edgeY = float(1).sub(abs(u.y.sub(0.5)).mul(1.35)).saturate();
    const alpha = float(0.18).mul(edgeX.pow(1.4)).mul(edgeY);
    material.colorNode = vec4(color(0xb7c4cc), alpha);

    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, material, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = "RainStreaks";
    this.mesh.count = count;

    this._geo = geo;
    this._mat = material;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {number} [windYaw]
   */
  update(dt, camera, windYaw = 0) {
    this._t += dt;
    this._uTime.value = this._t;
    this._uSpeed.value = this.speed;
    this._uCam.value.copy(camera.position);
    const wx = Math.sin(windYaw) * 0.35 + this.wind.x;
    const wz = Math.cos(windYaw) * 0.15 + this.wind.z;
    this._uWind.value.set(wx, 0, wz);
    // Accumulate ∫ wind dt so XZ drift stays continuous under varying windYaw
    this._wx += wx * dt;
    this._wz += wz * dt;
    this._uWindIntegral.value.set(this._wx, this._wz);
  }

  dispose() {
    this._geo.dispose();
    this._mat.dispose();
  }
}
