import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ForestScene } from './scene/ForestScene.js';
import { ProofBackdrop, wantProof } from './scene/ProofBackdrop.js';
import { RoseRig } from './rose/RoseRig.js';
import { createWaterMaterial } from './rose/GlassMaterials.js';
import { RainSystem } from './rain/RainSystem.js';
import { DropletSystem } from './rain/DropletSystem.js';
import { WetMaps } from './rain/WetMaps.js';
import { Composer } from './post/Composer.js';
import { attachDebugGUI, wantDebug } from './debug/LilGuiPanel.js';

const errEl = document.getElementById('err');
const hud = document.getElementById('hud');

function showError(e) {
  console.error(e);
  if (!errEl) return;
  errEl.style.display = 'grid';
  errEl.textContent =
    'Failed to start WebGPU/WebGL rose scene.\\n\\n' +
    (e && (e.stack || e.message || String(e))) +
    '\\n\\nNeed a modern Chromium/Firefox/Safari with WebGPU or WebGL2.\\n' +
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
  const q = new URLSearchParams(location.search);
  const proof = wantProof(q);

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
  renderer.toneMappingExposure = proof ? 1.0 : 1.05;
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

  // F17: mobile touch orbit polish - desktop (fine pointer) unchanged
  // OrbitControls touch defaults: 1=ROTATE, 2=DOLLY, 3=PAN
  if (window.matchMedia('(pointer: coarse)').matches) {
    controls.enablePan = false; // one-finger pan jitter on phones
    controls.rotateSpeed = 0.65; // slightly slower than default 1.0
    // optional 2-finger pan (instead of dolly) when pan is wanted on touch:
    // controls.enablePan = true; controls.touches.TWO = THREE.TOUCH.PAN;
  }

  // F08: proof mode — glass rose alone (no forest/rain/wet tax)
  let backdrop;
  let rain = null;
  let droplets = null;
  let wet = null;
  let puddleMat = null;
  const rainCount = proof ? 0 : igp ? 6000 : 12000;
  const dropMax = proof ? 0 : igp ? 80 : 120;

  if (proof) {
    backdrop = new ProofBackdrop();
    backdrop.setupEnvironment(scene);
    scene.add(backdrop.build());
    backdrop.addLights(scene);
  } else {
    backdrop = new ForestScene();
    await backdrop.loadEnvironment(scene, renderer);
    scene.add(backdrop.build());
    backdrop.addLights(scene);
  }

  const rose = new RoseRig();
  rose.group.position.set(0, 0.02, 0);
  scene.add(rose.group);
  // T11: optional authored mesh — silent no-op if missing
  const glbParam = q.get('glb');
  if (glbParam !== '0') {
    await rose.loadGLB(glbParam || 'public/models/rose.glb');
  }

  if (!proof) {
    puddleMat = createWaterMaterial({
      roughness: 0.04,
      transmission: 0.9,
      thickness: 0.02,
      ior: 1.333
    });
    backdrop.addPuddles(puddleMat);

    wet = new WetMaps(renderer, igp ? 256 : 512);
    wet.bindToGlass(rose.glass);

    droplets = new DropletSystem(rose.petalMeshes, { max: dropMax });
    scene.add(droplets.mesh);

    // Profile budget (DESIGN-PLAN T10 / brief §12.8): discrete 120 drops + 12k rain; IGP 80 + 6k
    rain = new RainSystem({ count: rainCount });
    scene.add(rain.mesh);
  }

  const composer = new Composer(renderer, scene, camera);
  await composer.init();
  const bloomAvailable = composer.enabled;
  const basePixelRatio = Math.min(window.devicePixelRatio || 1, igp ? 1.5 : 2);

  // F13: tiny live FPS (avg ~0.5s) — always on, corner mark
  // F17: layout/safe-area via #fps CSS in index.html (no inline geometry)
  const fpsEl = document.createElement('div');
  fpsEl.id = 'fps';
  fpsEl.setAttribute('aria-hidden', 'true');
  fpsEl.textContent = '— fps';
  document.body.appendChild(fpsEl);

  // F13: auto quality ladder (skip in proof — no rain/droplet load path)
  let qualityLevel = 0; // 0 = full; higher = more degraded
  const QUALITY_MAX = 4;
  let ladderCooldownUntil = 0;
  let lowSince = 0;
  let highSince = 0;
  let avgFps = 60;
  let fpsFrames = 0;
  let fpsWindowStart = performance.now();
  const FPS_WINDOW_MS = 500;
  const LOW_FPS = 28;
  const HIGH_FPS = 45;
  const HOLD_MS = 2200;
  const COOLDOWN_MS = 2800;

  /** Apply cumulative quality state for ladder level (0=full … 4=max degrade). */
  function applyQualityLevel(level) {
    let r = rainCount;
    let d = dropMax;
    let pr = basePixelRatio;
    let bloomOn = bloomAvailable;

    if (level >= 1 && rainCount > 0) r = Math.max(1500, Math.floor(rainCount * 0.5));
    if (level >= 2 && dropMax > 0) d = Math.max(36, Math.floor(dropMax * 0.55));
    if (level >= 3) pr = Math.min(basePixelRatio, igp ? 1.0 : 1.25);
    if (level >= 4) bloomOn = false;

    if (rain) {
      rain.count = r;
      rain.mesh.count = r;
    }
    if (droplets) droplets.setCount(d);
    renderer.setPixelRatio(pr);
    // keep drawing-buffer size in sync after PR change
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (composer.pipeline) composer.enabled = bloomOn;
  }

  function tickQualityLadder(now) {
    if (proof) return;
    if (now < ladderCooldownUntil) return;

    if (avgFps < LOW_FPS) {
      highSince = 0;
      if (!lowSince) lowSince = now;
      if (now - lowSince >= HOLD_MS && qualityLevel < QUALITY_MAX) {
        qualityLevel += 1;
        applyQualityLevel(qualityLevel);
        ladderCooldownUntil = now + COOLDOWN_MS;
        lowSince = 0;
        highSince = 0;
      }
    } else if (avgFps > HIGH_FPS) {
      lowSince = 0;
      if (!highSince) highSince = now;
      if (now - highSince >= HOLD_MS && qualityLevel > 0) {
        qualityLevel -= 1;
        applyQualityLevel(qualityLevel);
        ladderCooldownUntil = now + COOLDOWN_MS;
        lowSince = 0;
        highSince = 0;
      }
    } else {
      lowSince = 0;
      highSince = 0;
    }
  }

  let gui = null;
  let refreshDebugHud = null;
  if (wantDebug()) {
    gui = attachDebugGUI({
      roseGlass: rose.glass,
      waterMat: droplets ? droplets.mat : null,
      renderer,
      scene,
      rain,
      droplets
    });
    const profileLine = () =>
      (proof ? 'proof' : 'debug') +
      ' · three r' +
      THREE.REVISION +
      (composer.enabled ? ' · bloom' : '') +
      (igp ? ' · igp' : '') +
      (proof
        ? ''
        : ' · drops ' +
          (droplets ? droplets.activeCount : 0) +
          '/' +
          dropMax +
          ' · rain ' +
          (rain ? rain.mesh.count : 0) +
          (qualityLevel ? ' · Q' + qualityLevel : '')) +
      ' · ' +
      Math.round(avgFps) +
      'fps · ' +
      rose._source;
    const refreshHud = () => {
      hud.textContent = profileLine();
    };
    refreshHud();
    if (droplets) {
      const _setCount = droplets.setCount.bind(droplets);
      droplets.setCount = (n) => {
        _setCount(n);
        refreshHud();
      };
    }
    refreshDebugHud = refreshHud;
  } else if (proof) {
    hud.innerHTML =
      '<b>proof</b> · glass rose · three r' +
      THREE.REVISION +
      (composer.enabled ? ' · bloom' : '') +
      ' · drag orbit · <b>?debug=1</b>';
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
    const now = performance.now();
    const windYaw = Math.sin(t * 0.07) * 0.5;

    if (userOrbit && now >= resumeIdleAt) userOrbit = false;

    // F13: FPS window ~0.5s
    fpsFrames += 1;
    if (now - fpsWindowStart >= FPS_WINDOW_MS) {
      const elapsedSec = (now - fpsWindowStart) / 1000;
      avgFps = fpsFrames / Math.max(elapsedSec, 1e-6);
      fpsEl.textContent = Math.round(avgFps) + ' fps';
      fpsFrames = 0;
      fpsWindowStart = now;
      tickQualityLadder(now);
      if (refreshDebugHud) refreshDebugHud();
    }

    rose.update(t, windYaw);
    backdrop.update(t);
    if (droplets) droplets.update(dt);
    if (wet) wet.update(dt, droplets);
    if (rain) rain.update(dt, camera, windYaw);

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
    if (rain) rain.dispose();
    if (droplets) droplets.dispose();
    if (wet) wet.dispose();
    backdrop.dispose();
    rose.dispose();
    if (puddleMat) puddleMat.dispose();
    composer.dispose();
    if (gui) gui.destroy();
    if (fpsEl && fpsEl.parentNode) fpsEl.parentNode.removeChild(fpsEl);
    renderer.dispose();
  });
}

main().catch(showError);
