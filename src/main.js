import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ForestScene } from './scene/ForestScene.js';
import { RoseRig } from './rose/RoseRig.js';
import { createWaterMaterial } from './rose/GlassMaterials.js';
import { RainSystem } from './rain/RainSystem.js';
import { DropletSystem } from './rain/DropletSystem.js';
import { WetMaps } from './rain/WetMaps.js';
import { Composer } from './post/Composer.js';
import { attachDebugGUI, wantDebug } from './debug/Tweakpane.js';

const errEl = document.getElementById('err');
const hud = document.getElementById('hud');

function showError(e) {
  console.error(e);
  if (!errEl) return;
  errEl.style.display = 'grid';
  errEl.textContent =
    'Failed to start WebGPU/WebGL rose scene.\n\n' +
    (e && (e.stack || e.message || String(e))) +
    '\n\nNeed a modern Chromium/Firefox/Safari with WebGPU or WebGL2.\n' +
    'CDN must allow: cdn.jsdelivr.net/npm/three@0.186.0/';
}

function isLikelyIGP() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const info = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    return /intel|uhd|iris|adreno|mali|apple gpu|llvmpipe|swiftshader/i.test(info);
  } catch {
    return false;
  }
}

async function main() {
  const igp = isLikelyIGP();

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    forceWebGL: false
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, igp ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  if (THREE.PCFShadowMap !== undefined) renderer.shadowMap.type = THREE.PCFShadowMap;
  if (renderer.shadowMap && 'transmitted' in renderer.shadowMap) {
    renderer.shadowMap.transmitted = true;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if ('transmissionResolutionScale' in renderer) {
    renderer.transmissionResolutionScale = igp ? 0.5 : 1.0;
  }
  document.body.prepend(renderer.domElement);

  await renderer.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    36,
    window.innerWidth / window.innerHeight,
    0.05,
    80
  );
  camera.position.set(0.55, 0.42, 1.35);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.55;
  controls.maxDistance = 3.2;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.set(0, 0.38, 0);

  const forest = new ForestScene();
  await forest.loadEnvironment(scene, renderer);
  scene.add(forest.build());
  forest.addLights(scene);

  const rose = new RoseRig();
  rose.group.position.set(0, 0.02, 0);
  scene.add(rose.group);
  // T11: optional authored mesh — silent no-op if missing
  const q = new URLSearchParams(location.search);
  const glbParam = q.get('glb');
  if (glbParam !== '0') {
    await rose.loadGLB(glbParam || 'public/models/rose.glb');
  }

  const puddleMat = createWaterMaterial({
    roughness: 0.04,
    transmission: 0.9,
    thickness: 0.02,
    ior: 1.333
  });
  forest.addPuddles(puddleMat);

  const wet = new WetMaps(renderer, igp ? 256 : 512);
  wet.bindToGlass(rose.glass);

  const dropMax = igp ? 80 : 120;
  const droplets = new DropletSystem(rose.petalMeshes, { max: dropMax });
  scene.add(droplets.mesh);

  // Profile budget (DESIGN-PLAN T10 / brief §12.8): discrete 120 drops + 12k rain; IGP 80 + 6k
  const rainCount = igp ? 6000 : 12000;
  const rain = new RainSystem({ count: rainCount });
  scene.add(rain.mesh);

  const composer = new Composer(renderer, scene, camera);
  await composer.init();

  let gui = null;
  if (wantDebug()) {
    gui = attachDebugGUI({
      roseGlass: rose.glass,
      waterMat: droplets.mat,
      renderer,
      scene,
      rain,
      droplets
    });
    // Profile proof (T10): live budget path counts — discrete 120/12k, IGP 80/6k
    const profileLine = () =>
      'debug · three r' +
      THREE.REVISION +
      (composer.enabled ? ' · bloom' : '') +
      (igp ? ' · igp' : '') +
      ' · drops ' +
      droplets.activeCount +
      '/' +
      dropMax +
      ' · rain ' +
      rainCount +
      ' · ' +
      rose._source;
    hud.textContent = profileLine();
    // Keep HUD counts in sync when lil-gui setCount changes
    const _setCount = droplets.setCount.bind(droplets);
    droplets.setCount = (n) => {
      _setCount(n);
      hud.textContent = profileLine();
    };
  } else {
    hud.innerHTML =
      'ruby glass · three r' +
      THREE.REVISION +
      (composer.enabled ? ' · bloom' : '') +
      ' · drag orbit · <b>?debug=1</b>';
  }

  const clock = new THREE.Clock();
  const homePos = new THREE.Vector3(0.55, 0.42, 1.35);
  const homeTarget = new THREE.Vector3(0, 0.38, 0);
  let userOrbit = false;
  let resumeIdleAt = 0;
  controls.addEventListener('start', () => {
    userOrbit = true;
  });
  controls.addEventListener('end', () => {
    resumeIdleAt = performance.now() + 4000;
  });

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    const windYaw = Math.sin(t * 0.07) * 0.5;

    if (userOrbit && performance.now() >= resumeIdleAt) userOrbit = false;

    rose.update(t, windYaw);
    forest.update(t);
    wet.update(dt);
    droplets.update(dt);
    rain.update(dt, camera, windYaw);

    if (!userOrbit) {
      const k = Math.sin((t * Math.PI * 2) / 20);
      camera.position.set(
        homePos.x + Math.sin(t * 0.08) * 0.04,
        homePos.y + k * 0.02,
        homePos.z + k * 0.04
      );
      controls.target.set(homeTarget.x, homeTarget.y + Math.sin(t * 0.1) * 0.01, homeTarget.z);
    }

    controls.update();
    composer.render();
  });

  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    rain.dispose();
    droplets.dispose();
    wet.dispose();
    forest.dispose();
    rose.dispose();
    puddleMat.dispose();
    composer.dispose();
    if (gui) gui.destroy();
    renderer.dispose();
  });
}

main().catch(showError);
