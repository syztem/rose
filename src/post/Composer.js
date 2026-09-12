import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

/**
 * r186 WebGPU post via RenderPipeline + TSL bloom (matches webgpu_postprocessing_bloom.html).
 * Soft-fails to plain renderer.render if anything is missing.
 */
export class Composer {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this.pipeline = null;
    this.bloomPass = null;
  }

  async init() {
    try {
      if (typeof THREE.RenderPipeline !== 'function') {
        throw new Error('RenderPipeline unavailable');
      }
      this.pipeline = new THREE.RenderPipeline(this.renderer);
      const scenePass = pass(this.scene, this.camera);
      const sceneColor = scenePass.getTextureNode('output');
      // mild bloom — high threshold so only glass specs sing (strength, radius, threshold)
      this.bloomPass = bloom(sceneColor, 0.22, 0.25, 1.15);
      this.pipeline.outputNode = sceneColor.add(this.bloomPass);
      this.enabled = true;
    } catch (e) {
      console.warn('[Composer] TSL bloom skipped:', e?.message || e);
      this.enabled = false;
      this.pipeline = null;
    }
    return this;
  }

  render() {
    if (this.enabled && this.pipeline) {
      this.pipeline.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this.pipeline = null;
    this.bloomPass = null;
  }
}
