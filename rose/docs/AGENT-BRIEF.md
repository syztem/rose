# AGENT BRIEF — Glass Red Rose in Rain (Three.js r186)

Lock the stack. Do not invent APIs. Do not use `opacity` as glass. Do not use `MeshBasicMaterial` / `MeshPhongMaterial` for the rose. Do not use `CubeRefractionMapping` (removed years ago). All glass is **volume transmission** on `MeshPhysicalMaterial` / `MeshPhysicalNodeMaterial`.

---

## 0. Non-negotiable product target

A single hero shot / slow orbit:

- A **solid ruby-glass rose** (not painted plastic, not alpha-blended red mesh).
- Petals read as **thick gem-glass**: thin edges almost clear-pink, overlapping petal stacks go **deep blood-ruby** via Beer–Lambert attenuation.
- **Obvious refraction**: ferns, rain streaks, and mottled canopy light warp through petals. You must be able to *read the forest through the bloom*.
- **Hard speculars + environment reflections** that sit *on top of* the transmitted color (Fresnel: grazing edges mirror the woods, face-on views are gem-red).
- **Rain**: falling rain in air + **real water beads** on petals that refract independently (water IOR ≠ glass IOR).
- Mood: wet temperate forest after rain, overcast with one broken shaft of light. Quiet, high-craft, ASMR-grade motion. No UI chrome unless a debug GUI is behind a flag.

If refraction is subtle, the scene behind the rose is too empty or `thickness`/`ior`/`attenuationDistance` are wrong. Fix the *background density* before cranking IOR to cartoon values.

---

## 1. Version lock and module graph

```text
three@0.186.0          # npm "three" === r186 (released 2026-09-08)
```

**Preferred renderer:** `WebGPURenderer` (WebGPU backend, automatic WebGL2 fallback).  
**Fallback renderer:** `WebGLRenderer` only if you must ship a no-nodes path. Same materials work; post and droplets are weaker.

Canonical imports:

```js
import * as THREE from 'three/webgpu';
import {
  pass, bloom, mrt, output, emissive, metalness, roughness,
  Fn, float, vec2, vec3, vec4, uv, time, positionWorld, normalWorld,
  cameraPosition, texture, instanceIndex, hash, sin, cos, mix, clamp,
  length, normalize, dFdx, dFdy, If, Loop, uniform
} from 'three/tsl';
import { PassNode, bloom as bloomPass } from 'three/addons/tsl/display/BloomNode.js'; // only if the r186 addon path exists; otherwise use three/tsl bloom
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';       // RGBELoader was renamed ~r180
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'; // debug only
```

r186 migration landmines you must obey:

- `Object3D.dispose()` exists. Custom subclasses **must** call `super.dispose()`.
- `Scene.environmentIntensity` attenuates the *scene* IBL. `material.envMapIntensity` only attenuates a material’s *own* `envMap`.
- WebGPU: `PCFSoftShadowMap` is gone. Use `THREE.PCFShadowMap`.
- `PMREMGenerator` uses spiral blur (slightly different prefilter look than r185).
- Do not use `renderer.physicallyCorrectLights` / `useLegacyLights`. r186 is always physically based.

Renderer contract:

```js
const renderer = new THREE.WebGPURenderer({
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  forceWebGL: false
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
if ('transmitted' in renderer.shadowMap) renderer.shadowMap.transmitted = true; // r186 WebGPU caustics path
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
```

Color pipeline: all albedo/attenuation colors constructed as `new THREE.Color().setHex(0x…, THREE.SRGBColorSpace)` or via `.setStyle`. Data maps (`normal`, `roughness`, `thickness`, `transmission`) stay `NoColorSpace`.

---

## 2. Architecture (do not dump this in one file)

```
src/
  main.js                 // renderer, loop, resize, dispose
  scene/ForestScene.js    // environment, fog, terrain, vegetation
  rose/RoseRig.js         // loads or builds rose, assigns glass materials
  rose/GlassMaterials.js  // ruby glass + water droplet materials
  rain/RainSystem.js      // atmospheric streaks (GPU instancing / TSL)
  rain/DropletSystem.js   // surface beads, coalescence, drip
  rain/WetMaps.js         // animated clearcoat/normal/roughness for micro-wetness
  post/Composer.js        // TSL post: bloom, grain, mild CA, optional DoF
  debug/Tweakpane.js
```

Render layers:

| Layer | Contents | Casts shadow | Receives | Transmissive |
|---|---|---|---|---|
| 0 opaque world | soil, trunks, ferns, moss, sky proxy | yes | yes | no |
| 1 rain streaks | thin capsules / quads | no | no | no (additive / alpha) |
| 2 rose glass | petals, stem, sepals | yes (transmitted if available) | yes | **yes** |
| 3 water beads | instanced droplets on rose | no | no | **yes** (budgeted) |
| 4 volume / fog | height fog, optional god-ray planes | no | no | n/a |

Transmission in three.js is **screen-space**. Opaque world is copied into a transmission framebuffer; glass samples it with an IOR-bent ray. Consequences:

1. Anything you want *seen through the rose* must be **opaque and already drawn**.
2. Glass-behind-glass is first-class only in a limited way. Keep droplet count modest; do not make every fern blade transmissive.
3. `renderer.transmissionResolutionScale` (WebGL path) / internal transmission RT scale: start at `1.0`, drop to `0.5` on integrated GPUs.
4. Transmissive materials should keep `opacity = 1`. `transparent: true` is allowed as a flag; do not lower opacity to “make it glass.”

---

## 3. World units and camera

- Rose height ≈ **1.0** world unit (about 20 cm analog). This keeps `thickness` and `attenuationDistance` in sane ranges.
- Camera: `PerspectiveCamera(32–38, aspect, 0.05, 80)`, start at `(0.55, 0.42, 1.35)` looking at bloom center `(0, 0.38, 0)`.
- Controls: `OrbitControls`, `enableDamping = true`, `minDistance = 0.55`, `maxDistance = 3.2`, `maxPolarAngle = π * 0.49` (don’t go under the ground).
- Slow idle: camera dolly ±4 cm and yaw ±8° over 20 s. Satisfying = *slow*.

---

## 4. Rose geometry — this is 40% of the look

### 4.1 Preferred: authored GLB

Author in Blender (or ingest a high-quality rose) with **separate meshes**:

- `Petals` (20–40 shells, not one blob)
- `Sepals`
- `Stem` + `Thorns`
- `Receptacle` / ovary
- optional `Stamens` as small capsules

Requirements:

- Smooth normals, no hard splits on petal body.
- Petals have **real thickness** (0.8–2.5 mm analog → `0.004–0.012` world). Do not use single-sided paper planes.
- Watertight-enough for transmission; consistent winding; `FrontSide`.
- UVs unique-enough to hold a **thickness map** and a **micro-scratch roughness map**.
- Vertex colors optional: store curvature or “vein mask” in `color.r`.
- Export glTF + Draco. Materials in the file will be *replaced* in code.

If you generate procedurally (acceptable if no asset pipeline):

- Phyllotaxis: petal *i* at yaw `i * 137.508°`, radius `a * sqrt(i)`, lift with a logistic so inner petals are tighter.
- Each petal = lofted cubic profile (base wide, mid belly, tip acuminate) extruded with 2–4 mm thickness, 32×16 segments, then `mergeVertices` + `computeVertexNormals`.
- Add a vein displacement along the midrib (`sin` + fbm, amplitude 0.004).
- Stem = tapered tube + 3–6 thorn cones, slight S-curve.

**Subdivision:** `LoopSubdivision` or high GLB poly. Silhouette aliasing kills “luxury glass.” Target 80k–200k tris for the rose. Instanced vegetation can be cheap; the rose cannot.

Bake or generate:

- `thicknessMap` (R, linear): thin at margins and tips, thick at midrib and base. This is what makes gem-glass *read*.
- `normalMap`: veins + drawn-glass stretch marks, strength 0.15–0.35.
- `roughnessMap`: 0.02 field, 0.08–0.14 in vein recesses and mold-parting lines.
- `clearcoatNormalMap`: reserved for rain micro-beads (see §6.2).

---

## 5. Ruby glass material — the optical contract

Use **one shared material** for all rose glass parts (cheaper transmission program). Stem may be a second material (green-black glass, higher roughness).

### 5.1 Why these numbers

| Parameter | Value | Why |
|---|---|---|
| `color` | `0xf6e4e8` to `0xffffff` | Surface albedo. Keep near white. **Volume color comes from attenuation**, not `color`. A saturated `color` muddies reflections. |
| `metalness` | `0` | Dielectric. |
| `roughness` | `0.035` base | Optical glass. Never 0 (fireflies). Wet + micro-scratches via map. |
| `transmission` | `1` | Physical transparency. |
| `opacity` | `1` | Mandatory with transmission. |
| `ior` | `1.52` | Soda-lime / potash glass. Water droplets use `1.333`. Do not set rose to 2.0. |
| `thickness` | `0.012` | Local-space fallback. Combined with `thicknessMap`. If the mesh is already thick, start at `0.02–0.04`. |
| `attenuationColor` | `0x7a0214` or `0x5c0010` | Beer–Lambert pigment. Deep ruby, not candy red. |
| `attenuationDistance` | `0.07–0.16` | Light mean-free-path in **world units**. Tune until a *single* petal is translucent pink and a *stack of three* is almost black-crimson. |
| `dispersion` | `0.22` | r186 `MeshPhysicalMaterial.dispersion` (KHR_materials_dispersion). Visible prism only on silhouettes and speculars. 0.0 = dead; 1.0 = cheap rainbow. |
| `specularIntensity` | `1.0` | |
| `specularColor` | `0xffffff` | |
| `clearcoat` | `1.0` | Wet film. |
| `clearcoatRoughness` | `0.03` | Rain raises this locally via map. |
| `iridescence` | `0.08–0.15` | Optional oil-film on wet glass. Keep low. |
| `iridescenceIOR` | `1.33` | Water film. |
| `iridescenceThicknessRange` | `[180, 380]` | nm-ish thin film. |
| `envMapIntensity` | `1.0–1.25` | Only if the material has its own envMap. Prefer `scene.environment`. |
| `side` | `FrontSide` | DoubleSide on volumetric petals double-paints and breaks thickness. |
| `forceSinglePass` | `false` | Let the renderer do the transmission extra pass. |

WebGPU / TSL form (preferred on r186):

```js
const roseGlass = new THREE.MeshPhysicalNodeMaterial({
  color: new THREE.Color().setHex(0xf7ecee, THREE.SRGBColorSpace),
  metalness: 0,
  roughness: 0.035,
  transmission: 1,
  opacity: 1,
  ior: 1.52,
  thickness: 0.012,
  attenuationColor: new THREE.Color().setHex(0x6e0212, THREE.SRGBColorSpace),
  attenuationDistance: 0.11,
  dispersion: 0.22,
  specularIntensity: 1,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  iridescence: 0.1,
  iridescenceIOR: 1.33,
  iridescenceThicknessRange: [180, 380]
});
roseGlass.thicknessMap = thicknessTex;          // NoColorSpace
roseGlass.roughnessMap = roughnessTex;
roseGlass.normalMap = veinNormalTex;
roseGlass.normalScale.set(0.22, 0.22);
roseGlass.clearcoatNormalMap = rainNormalRT.texture; // animated
roseGlass.clearcoatNormalScale.set(0.55, 0.55);
```

Stem variant: `attenuationColor = 0x10240c`, `attenuationDistance = 0.20`, `roughness = 0.08`, `ior = 1.50`, slight anisotropy `0.15` along stem tangent if tangents exist (drawn-glass look).

### 5.2 Tuning protocol (agent must follow, in order)

1. White `attenuationColor`, `attenuationDistance = Infinity`, `dispersion = 0`, grey world behind rose. Confirm you see **warped background** and **hard white spec**. If not: thickness too low, or nothing opaque behind, or roughness too high.
2. Restore `attenuationColor` ruby. Lower `attenuationDistance` until petal stacks go dark. If the whole rose turns black, distance is too small or thickness too large.
3. Add `dispersion` until you see a 1-pixel prism on the limb, then stop.
4. Add clearcoat + rain maps.
5. Only then grade exposure.

### 5.3 What “obvious translucency” means in this engine

Three.js transmission is **not** path-traced multiple scattering. You fake the missing physics:

- Attenuation (color vs thickness) → gem body.
- Thickness map → edge glow.
- Dispersion → spectral limb.
- IBL + clearcoat → surface jewelry.
- A bright, structured background → readable refraction.
- Optional cheap caustic: project a blurred, inverted transmission of the rose onto the soil with a cookie / TSL `viewportSharedTexture` trick, opacity 0.12, animated with rain.

Do **not** write a custom fullscreen ray marcher unless the built-in transmission fails the acceptance tests. Built-in r186 transmission + volume attenuation is the correct base.

---

## 6. Rain — two systems, not one particle dump

### 6.1 Atmospheric rain (forest, not on the rose)

- 8k–20k instanced quads or capsules, camera-aligned, length 0.08–0.18, width 0.0015.
- Shader: stretch UV, soft alpha core, slight refraction shimmer not required.
- Velocity `vec3(0.04, -4.8, 0.02)` world, plus wind gust uniform that slowly yaws.
- Respawn in a cylinder around camera/rose, radius 4, height 8.
- Color: `0xb7c4cc`, opacity 0.18, `depthWrite = false`, `transparent = true`, renderOrder `-1`.
- Motion: TSL `positionWorld` offset by `fract(time * speed + hash(id))`.
- **Do not** make these transmissive.

Optional second layer: distant rain as a camera-facing sheet with a scrolling noise alpha (cheap density).

### 6.2 Surface water on the rose (the money shot)

Water IOR **1.333**, glass IOR **1.52**. Beads must be **separate meshes**, not just a normal map, or they will not refract as droplets.

**Hero droplets (instanced):**

```js
const dropGeo = new THREE.SphereGeometry(1, 18, 14);
// flatten slightly: scale.set(1.0, 0.62, 1.15) per instance after adhesion
const waterMat = new THREE.MeshPhysicalNodeMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.02,
  transmission: 1,
  opacity: 1,
  ior: 1.333,
  thickness: 0.006,
  attenuationColor: 0xffffff,
  attenuationDistance: 1.0,   // water is almost colorless at this scale
  dispersion: 0.08,
  clearcoat: 0,
  specularIntensity: 1
});
```

Count: **80–160** visible beads. More than ~250 transmissive instances will tank the transmission pass.

Simulation (CPU is fine at this count; GPU compute if you already use TSL storage):

1. Sample spawn points: Poisson on upward-facing petals (`normal.y > 0.25`).
2. Each drop stores: `petalIndex`, `uv` or barycentric, `mass`, `velocity` (tangent space).
3. Forces: gravity projected onto the local surface (`g - n*(g·n)`), plus a slow flow toward curvature valleys (veins).
4. Adhesion: clamp speed; large mass overcomes adhesion and drips off the margin.
5. Coalesce: if two drops on same petal within `0.012`, merge mass, conserve volume `r ∝ m^(1/3)`.
6. Drip: when a drop leaves the silhouette, convert to a falling streak in the atmospheric system and spawn a tiny splash ripple on the next lower petal or soil.
7. Instance matrix: position = surface point + `n * r * 0.55` (sit *on* the glass, not inside). Orient so flattened axis follows gravity projected on the surface.

**Micro-wetness (thousands of unresolvable beads):**

Render a 512–1024 RT each 2–3 frames:

- Scatter dots + comet-tail streaks in petal UV space.
- Convert height → normal (`dFdx/dFdy`).
- Feed as `clearcoatNormalMap`.
- Also lift `roughness` by `0.02 * wetMask` in recesses (water fills scratches → actually *smoother* on flats; use wetMask to *lower* roughness on flats and *raise* it only in droplet contact rings).

Physically: a wet dielectric is smoother and more reflective. Encode:

- `roughness = mix(0.05, 0.02, wetFlat)`
- `clearcoat = 1`
- ring around each hero drop: extra normal ridge

### 6.3 Ground impact

- Sparse splash decals / 8-frame flipbook on soil, very subtle.
- Shallow puddle disks (`CircleGeometry`) with the water material, `roughness 0.04`, `transmission 0.9`, `thickness 0.02`, reflecting trunks. Keep to 5–12 puddles near the rose so refraction has something crisp to bend.

---

## 7. Forest, lighting, IBL — refraction fuel

Glass with a studio-grey void looks like a cheap shaderball. The forest exists to be **bent**.

### 7.1 Environment

- Load a high-quality **overcast forest / rainy woodland** HDRI (`HDRLoader` or `UltraHDRLoader`). Resolution 2k is enough; 4k if memory allows.
- `hdr.mapping = THREE.EquirectangularReflectionMapping`
- `scene.environment = hdr`
- `scene.background = hdr` **or** a slightly blurred copy (`pmrem` / lower mip) so the backdrop is soft while reflections stay sharp.
- `scene.environmentIntensity = 0.85` (r186).
- Do not use `RoomEnvironment` in the final shot; it reads as a showroom.

### 7.2 Built world (keep it close — 3 m radius of density)

- Ground: displaced plane 12×12, wet dark loam `MeshStandardMaterial`, `roughness 0.62`, `metalness 0`, puddle wetness map.
- 8–20 tree trunks mid-distance, dark bark, high roughness.
- Ferns / hostas / moss clumps in the **immediate 1.5 m behind and beside the rose**. These are the refraction subject. Mid-poly, `MeshStandardMaterial`, deep green `0x1c3a22`, roughness 0.55, subtle subsurface not required.
- Fallen needles / petals as color noise on ground albedo.
- Height fog: `scene.fog = new THREE.FogExp2(0x8a9a8e, 0.045)` tuned so 8–12 m melts. Color must match HDRI horizon or the rose limb will fringe.
- Optional: one volumetric light shaft (low-opacity planes or TSL fog density) from upper-left, catching rain.

### 7.3 Lights

IBL does most of the work. Add:

```js
const hemi = new THREE.HemisphereLight(0xc9d6cf, 0x1a2418, 0.35);
const sun = new THREE.DirectionalLight(0xe8efe4, 1.6);
sun.position.set(4.2, 7.5, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 24;
sun.shadow.camera.left = sun.shadow.camera.bottom = -4;
sun.shadow.camera.right = sun.shadow.camera.top = 4;
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 2; // if available on this shadow type
```

One small `RectAreaLight` or tight spot, off-camera, aimed at the bloom — creates a single traveling specular as you orbit. Intensity low; glass already explodes with IBL.

Rose `castShadow = true`, `receiveShadow = true`. Vegetation the same. Rain streaks do not cast.

---

## 8. Post-processing (TSL composer, r186)

Keep it cinematic, not gamer-HUD.

1. MSAA via `antialias: true`. If you add a composer, re-enable quality with a resolve pass.
2. **Bloom**: threshold ~1.15 so only glass spec and wet glints bloom. Strength 0.18–0.28, radius small. If the whole rose blooms, attenuation is too weak or exposure too high.
3. **Grain**: 0.025, animated.
4. **Very slight chromatic aberration** on screen edges only (not on the rose center — the material already has physical dispersion).
5. Optional **DoF**: focal distance to bloom, `bokeh` tiny (f/4 analog). Over-DoF destroys refraction readability.
6. Color grade: lift shadows 3%, drop saturation on greens 8%, keep reds.

Do not stack five post effects that smear the transmission buffer.

---

## 9. Animation / “satisfying”

Loop 20–30 s, seamless:

- Rain never stops; wind azimuth oscillates `sin(t * 0.07)`.
- Droplets nucleate, grow, merge, drip. Period of a drip on a given petal ~2–6 s.
- Rose is almost still. Add 0.4° stem sway in wind, phase-offset petals 0.2°.
- One water bead that travels a full midrib every ~8 s — the eye-follow object.
- Occasional leaf shiver in the background (vertex or bone, amplitude 3 mm).

Audio is out of scope unless requested. Visual rhythm *is* the product.

---

## 10. Performance budget

Target 60 fps at 1080p discrete GPU, 30–45 on integrated.

| Item | Budget |
|---|---|
| Rose tris | ≤ 200k |
| Hero transmissive droplets | ≤ 160 |
| Unique `MeshPhysical*Material` with `transmission > 0` | ≤ 3 (rose, water, puddles) |
| Shadow map | 2048 |
| HDRI | 2k |
| Transmission RT scale | 1.0 desktop / 0.5 IGP |
| Atmospheric rain instances | ≤ 20k (non-physical material) |

Instancing is mandatory for rain and droplets. Do not allocate materials per petal.

Dispose path (r186): textures, geometries, materials, PMREM, render targets, then `object.dispose()` walking the graph.

---

## 11. Implementation sequence for the agent

Work in this order. Do not skip.

**P0 — boot**  
Canvas, `WebGPURenderer`, ACES, orbit camera, grey ground, one `SphereGeometry` with the *exact* rose glass params. Put a high-contrast grid / fern photo plane *behind* the sphere. Confirm refraction + reflection + ruby attenuation.

**P1 — rose stand-in**  
Load GLB or procedural rose. Assign glass. Tune `thickness` / `attenuationDistance` against the real mesh scale. If the rose is 1 unit and looks like tinted ice, thickness is too small. If it is a red rock, attenuationDistance is too small.

**P2 — IBL + forest blockout**  
HDRI + 3 ferns + trunk + wet ground. Re-tune exposure. Refraction must now show *leaves*, not a grid.

**P3 — wetness maps**  
Animated clearcoat normals. The rose should look rained-on even before hero droplets.

**P4 — hero droplets**  
Instancing + adhesion sim. Confirm water IOR vs glass IOR (beads should “sit” and magnify veins).

**P5 — atmospheric rain + wind**  
Streaks that read at 1/60 shutter (slightly long streaks, not dots).

**P6 — lighting polish + shadows + optional caustic cookie**

**P7 — post + camera easing + drip hero moment**

**P8 — GUI (debug flag)**  
Expose: `ior`, `thickness`, `attenuationDistance`, `attenuationColor`, `dispersion`, `roughness`, `clearcoatRoughness`, `exposure`, `environmentIntensity`, droplet count, rain speed. This is how you finish the look.

---

## 12. Acceptance tests (fail = not done)

1. **Transmission test:** with `attenuationColor = white`, forest detail behind a petal is warped and magnified. No warp → broken transmission setup.
2. **Volume test:** petal edge is pale rose-crystal; three overlapping petals are dark ruby. Uniform candy-red = you tinted `color` instead of attenuation.
3. **Fresnel test:** at grazing angle the petal becomes a mirror of trees; face-on it is gem. If both views look the same, roughness is too high or IBL is missing.
4. **Dispersion test:** a bright highlight on a limb shows a thin red/blue split. Whole rose rainbow = dispersion too high.
5. **Two-IOR test:** a water bead on a petal magnifies the vein underneath *more locally* than the petal magnifies the forest. Beads must not look painted-on.
6. **Wet test:** after disabling hero droplets, the rose still reads wet (clearcoat / micro normals).
7. **Mood test:** no studio-grey; no neon; no orbit-gamer lighting; rain is visible against dark trunks; motion is slow.
8. **Perf test:** stable frame time with 120 droplets + 12k rain + rose + forest blockout.

---

## 13. Hard prohibitions

- No `opacity < 1` used as glass.
- No `MeshStandardMaterial` + `transparent` for the rose.
- No additive red fresnel shader as a substitute for volume attenuation.
- No `Side: DoubleSide` on thick petal volumes.
- No 4k particle rain that tanks the GPU while the rose is a 2k-tri cone.
- No default `RoomEnvironment` in the final image.
- No post bloom strong enough to hide a bad material.
- No third-party `MeshTransmissionMaterial` from Drei unless you explicitly fall back after documenting that built-in r186 transmission failed a listed acceptance test. Built-in physical transmission + attenuation + dispersion **is** the r186 path.

---

## 14. Reference values cheat-sheet (copy into GUI defaults)

```js
const GLASS_RUBY = {
  color: 0xf7ecee,
  roughness: 0.035,
  metalness: 0,
  transmission: 1,
  opacity: 1,
  ior: 1.52,
  thickness: 0.012,
  attenuationColor: 0x6e0212,
  attenuationDistance: 0.11,
  dispersion: 0.22,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  iridescence: 0.1,
  iridescenceIOR: 1.33,
  specularIntensity: 1,
  envMapIntensity: 1
};

const WATER = {
  color: 0xffffff,
  roughness: 0.02,
  metalness: 0,
  transmission: 1,
  opacity: 1,
  ior: 1.333,
  thickness: 0.006,
  attenuationDistance: 1.0,
  dispersion: 0.08
};
```

Start there. Only move one knob at a time. The look is in the **ratio** of thickness : attenuationDistance : IOR : background contrast — not in a secret shader.