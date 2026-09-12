import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { createRaymarchedBloom } from './bloom/RaymarchedBloom.js';
import { WetCanopy } from './scene/WetCanopy.js';
import { RainStreaks } from './rain/RainStreaks.js';
import { WaterBeads } from './rain/WaterBeads.js';
import { Composer } from './post/Composer.js';

const q = new URLSearchParams(location.search);
const debug = q.has('debug') || q.get('debug') === '1';

async function main() {
  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 40);
  camera.position.set(0.85, 0.95, 2.15);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.9;
  controls.maxDistance = 5.5;
  controls.target.set(0, 0.55, 0);
  controls.maxPolarAngle = Math.PI * 0.49;

  const canopy = new WetCanopy();
  await canopy.loadEnvironment(scene, renderer);
  scene.add(canopy.build());
  canopy.addLights(scene);

  const bloom = createRaymarchedBloom();
  scene.add(bloom.group);

  const rain = new RainStreaks({ count: 4500 });
  scene.add(rain.mesh);

  const beads = new WaterBeads({ count: 100 });
  scene.add(beads.mesh);

  const composer = new Composer(renderer, scene, camera);
  await composer.init();

  if (debug) {
    const gui = new GUI({ title: 'dielectric' });
    const f = {
      exposure: renderer.toneMappingExposure,
      rain: rain.active,
      absorbR: bloom.uniforms.uAbsorb.value.x,
      absorbG: bloom.uniforms.uAbsorb.value.y,
      absorbB: bloom.uniforms.uAbsorb.value.z
    };
    gui.add(f, 'exposure', 0.4, 2.2, 0.01).onChange((v) => {
      renderer.toneMappingExposure = v;
    });
    gui.add(f, 'rain', 0, rain.count, 50).onChange((v) => rain.setActive(v));
    gui.add(f, 'absorbR', 0.2, 6, 0.05).onChange((v) => {
      bloom.uniforms.uAbsorb.value.x = v;
    });
    gui.add(f, 'absorbG', 1, 16, 0.1).onChange((v) => {
      bloom.uniforms.uAbsorb.value.y = v;
    });
    gui.add(f, 'absorbB', 1, 16, 0.1).onChange((v) => {
      bloom.uniforms.uAbsorb.value.z = v;
    });
  }

  const clock = new THREE.Clock();
  let idle = 0;

  async function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    idle += dt;

    bloom.update(t);
    rain.update(dt);
    beads.update(t);

    // slow cinematic drift when untouched
    if (idle > 2.5) {
      const a = (t - 2) * 0.08;
      camera.position.x = Math.sin(a) * 2.15;
      camera.position.z = Math.cos(a) * 2.15;
      camera.position.y = 0.95 + Math.sin(t * 0.25) * 0.05;
      camera.lookAt(0, 0.55, 0);
    }

    controls.update();
    await composer.render();
    requestAnimationFrame(frame);
  }

  controls.addEventListener('start', () => {
    idle = 0;
  });
  addEventListener('pointerdown', () => {
    idle = 0;
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="color:#f88;padding:16px;white-space:pre-wrap">${e?.stack || e}</pre>`
  );
});
