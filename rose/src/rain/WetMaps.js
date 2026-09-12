import * as THREE from 'three/webgpu';

/**
 * Animated clearcoat normal via canvas — micro-wetness, no extra transmission cost.
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
    const s = this.size;
    ctx.fillStyle = '#8080ff';
    ctx.fillRect(0, 0, s, s);

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
    }
    this.texture.needsUpdate = true;
  }

  bindToGlass(material) {
    material.clearcoatNormalMap = this.texture;
    material.clearcoatNormalScale = new THREE.Vector2(0.55, 0.55);
  }

  dispose() {
    this.texture.dispose();
  }
}
