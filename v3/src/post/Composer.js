import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class Composer {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = false;
    this._post = null;
  }

  async init() {
    try {
      const scenePass = pass(this.scene, this.camera);
      const color = scenePass.getTextureNode('output');
      const bloomNode = bloom(color, 0.2, 0.35, 0.8);
      this._post = new THREE.PostProcessing(this.renderer);
      this._post.outputNode = color.add(bloomNode);
      this.enabled = true;
    } catch (e) {
      console.warn('[Composer] bloom unavailable, raw render:', e?.message || e);
      this.enabled = false;
    }
  }

  async render() {
    if (this.enabled && this._post) {
      await this._post.renderAsync();
    } else {
      await this.renderer.renderAsync(this.scene, this.camera);
    }
  }
}
