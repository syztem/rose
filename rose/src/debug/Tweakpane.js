import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { GLASS_RUBY } from '../constants/glass.js';

export function attachDebugGUI({
  roseGlass,
  waterMat,
  renderer,
  scene,
  rain,
  droplets
}) {
  const gui = new GUI({ title: 'Rose Glass' });
  const g = {
    color: GLASS_RUBY.color,
    roughness: roseGlass.roughness,
    ior: roseGlass.ior,
    thickness: roseGlass.thickness,
    attenuationColor: GLASS_RUBY.attenuationColor,
    attenuationDistance: roseGlass.attenuationDistance,
    dispersion: roseGlass.dispersion,
    clearcoatRoughness: roseGlass.clearcoatRoughness
  };

  const folder = gui.addFolder('Ruby glass');
  folder.addColor(g, 'color').onChange((v) => roseGlass.color.set(v));
  folder.add(g, 'roughness', 0, 0.4, 0.001).onChange((v) => (roseGlass.roughness = v));
  folder.add(g, 'ior', 1.0, 1.8, 0.001).onChange((v) => (roseGlass.ior = v));
  folder.add(g, 'thickness', 0.001, 0.08, 0.001).onChange((v) => (roseGlass.thickness = v));
  folder.addColor(g, 'attenuationColor').onChange((v) => roseGlass.attenuationColor.set(v));
  folder
    .add(g, 'attenuationDistance', 0.01, 0.5, 0.001)
    .onChange((v) => (roseGlass.attenuationDistance = v));
  folder.add(g, 'dispersion', 0, 1, 0.01).onChange((v) => (roseGlass.dispersion = v));
  folder
    .add(g, 'clearcoatRoughness', 0, 0.5, 0.001)
    .onChange((v) => (roseGlass.clearcoatRoughness = v));

  if (waterMat) {
    const w = { ior: waterMat.ior, roughness: waterMat.roughness };
    const wf = gui.addFolder('Water beads');
    wf.add(w, 'ior', 1.1, 1.5, 0.001).onChange((v) => (waterMat.ior = v));
    wf.add(w, 'roughness', 0, 0.2, 0.001).onChange((v) => (waterMat.roughness = v));
  }

  if (droplets) {
    const d = { count: droplets.mesh.count };
    const df = gui.addFolder('Droplets');
    df.add(d, 'count', 0, droplets.max, 1).onChange((v) => droplets.setCount(v));
  }

  const exp = {
    exposure: renderer.toneMappingExposure,
    env: scene.environmentIntensity ?? 1
  };
  const envf = gui.addFolder('Scene');
  envf.add(exp, 'exposure', 0.2, 2.5, 0.01).onChange((v) => (renderer.toneMappingExposure = v));
  envf.add(exp, 'env', 0, 2, 0.01).onChange((v) => (scene.environmentIntensity = v));

  if (rain) {
    const r = { speed: rain.speed };
    const rf = gui.addFolder('Rain');
    rf.add(r, 'speed', 1, 10, 0.1).onChange((v) => (rain.speed = v));
  }

  // transmission RT scale when backend exposes it
  if (renderer && 'transmissionResolutionScale' in renderer) {
    const t = { scale: renderer.transmissionResolutionScale ?? 1 };
    envf.add(t, 'scale', 0.25, 1, 0.05).onChange((v) => {
      renderer.transmissionResolutionScale = v;
    });
  }

  return gui;
}

export function wantDebug() {
  const q = new URLSearchParams(location.search);
  return q.get('debug') === '1' || q.get('debug') === 'true';
}
