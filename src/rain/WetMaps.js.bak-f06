import * as THREE from 'three/webgpu';

/**
 * Animated clearcoat normal + roughness wet mix via canvas.
 * Flats: lower roughness when wet; rings: slight roughness up + normal ridge.
 * Micro-wetness without extra transmission cost.
 */
export class WetMaps {
  constructor(_renderer, size = 512) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.needsUpdate = true;

    // Roughness wet mix (G channel used by MeshPhysicalMaterial.roughnessMap).
    // Multiplies material.roughness: wet flats lower; contact rings slightly higher.
    this.roughCanvas = document.createElement('canvas');
    this.roughCanvas.width = size;
    this.roughCanvas.height = size;
    this.roughCtx = this.roughCanvas.getContext('2d');
    this.roughnessTexture = new THREE.CanvasTexture(this.roughCanvas);
    this.roughnessTexture.colorSpace = THREE.NoColorSpace;
    this.roughnessTexture.wrapS = this.roughnessTexture.wrapT = THREE.RepeatWrapping;
    this.roughnessTexture.needsUpdate = true;

    this._frame = 0;
    this._drops = Array.from({ length: 80 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.02,
      vy: -0.01 - Math.random() * 0.04,
      r: 0.004 + Math.random() * 0.01
    }));
  }

  update(dt) {
    this._frame++;
    if (this._frame % 2 !== 0) return;

    const ctx = this.ctx;
    const rctx = this.roughCtx;
    const s = this.size;

    // Normal map base (flat clearcoat normal ≈ +Z in tangent space → mid blue)
    ctx.fillStyle = '#8080ff';
    ctx.fillRect(0, 0, s, s);

    // Roughness base: slightly under 1.0 so contact rings can rise above ambient
    // (roughnessMap multiplies material.roughness; cannot exceed base alone)
    rctx.fillStyle = '#e6e6e6';
    rctx.fillRect(0, 0, s, s);

    for (const d of this._drops) {
      d.x += d.vx * dt * 0.9;
      d.y += d.vy * dt * 0.9;
      if (d.y < -0.05 || d.x < -0.05 || d.x > 1.05) {
        d.x = Math.random();
        d.y = 1.05;
        d.r = 0.004 + Math.random() * 0.01;
      }
      const x = d.x * s;
      const y = d.y * s;
      const r = d.r * s;

      // --- clearcoat normal: scatter dots + comet streaks ---
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(180,180,255,0.85)');
      g.addColorStop(0.5, 'rgba(120,140,255,0.35)');
      g.addColorStop(1, 'rgba(128,128,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.1, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,150,255,0.25)';
      ctx.lineWidth = Math.max(1, r * 0.35);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - d.vx * s * 2, y - d.vy * s * 2);
      ctx.stroke();

      // --- roughness wet mix ---
      // Contact ring: slight roughness up toward 1.0 multiply (above ambient base)
      const ring = rctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.4);
      ring.addColorStop(0, 'rgba(255,255,255,0)');
      ring.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      ring.addColorStop(1, 'rgba(255,255,255,0)');
      rctx.fillStyle = ring;
      rctx.beginPath();
      rctx.ellipse(x, y, r * 1.45, r * 0.98, 0, 0, Math.PI * 2);
      rctx.fill();

      // Wet flat / bead body: lower roughness (darker G → smoother dielectric)
      const wet = rctx.createRadialGradient(x, y, 0, x, y, r * 0.95);
      wet.addColorStop(0, 'rgba(85,85,85,0.9)');
      wet.addColorStop(0.5, 'rgba(130,130,130,0.5)');
      wet.addColorStop(1, 'rgba(230,230,230,0)');
      rctx.fillStyle = wet;
      rctx.beginPath();
      rctx.ellipse(x, y, r * 1.05, r * 0.68, 0, 0, Math.PI * 2);
      rctx.fill();

      // Comet streak: mild wet trail (slightly lower roughness)
      rctx.strokeStyle = 'rgba(150,150,150,0.3)';
      rctx.lineWidth = Math.max(1, r * 0.4);
      rctx.beginPath();
      rctx.moveTo(x, y);
      rctx.lineTo(x - d.vx * s * 2, y - d.vy * s * 2);
      rctx.stroke();
    }

    this.texture.needsUpdate = true;
    this.roughnessTexture.needsUpdate = true;
  }

  bindToGlass(material) {
    material.clearcoatNormalMap = this.texture;
    material.clearcoatNormalScale = new THREE.Vector2(0.55, 0.55);
    material.roughnessMap = this.roughnessTexture;
  }

  dispose() {
    this.texture.dispose();
    this.roughnessTexture.dispose();
  }
}
