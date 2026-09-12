# Glass Red Rose in Rain — Design & Implementation Plan

> **For Hermes:** Implement task-by-task in order P0→P8. Do not skip phases. Built-in r186 transmission only.

**Goal:** Ship a single-hero WebGPU/Three.js r186 scene: solid ruby-glass rose in wet temperate forest rain, with volume attenuation, readable refraction, dual-IOR water beads, and ASMR-grade slow motion.

**Architecture:** Vite ESM app; `WebGPURenderer` + TSL post; modular `src/` split (scene / rose / rain / post / debug). Transmission is screen-space — opaque forest draws first; ≤3 unique transmissive materials; instanced rain + beads.

**Tech stack:** `three@0.186.0`, Vite, optional Tweakpane (debug flag), Draco GLB, forest HDRI (2k). Local engine ref: `cubert:/sd-backup/projects/threejs/three.js-r186/`.

**Project root:** `cubert:/sd-backup/projects/rose/`

**Spec law:** `docs/AGENT-BRIEF.md` (full optical contract). This plan is the build sequence; the brief wins on numbers and prohibitions.

---

## 0. Product lock (one sentence)

Slow orbit of a **thick ruby volume-glass rose** that refracts a dense wet forest, with real water beads (IOR 1.333) on glass (IOR 1.52), not tinted plastic and not opacity-as-glass.

---

## 1. Assumptions

| Item | Decision |
|------|----------|
| Runtime | Browser; desktop discrete GPU primary (60 fps @ 1080p); IGP secondary (30–45) |
| Rose mesh | Prefer authored GLB; **P1 ships procedural stand-in** so optics work without Blender blocking |
| three path | npm `three@0.186.0` (not import from the learning tree at runtime) |
| Renderer | `WebGPURenderer` first; no Drei / no custom raymarch unless acceptance fails |
| Assets | HDRI + optional GLB under `public/`; license-clean; no RoomEnvironment in final |
| Audio | Out of scope |
| Host | Develop/serve from machine with GPU + display (not headless antiX Surface) |

### Local r186 teacher files (read before coding glass)

On cubert under `three.js-r186/examples/`:

- `webgpu_materials_transmission.html`
- `webgpu_loader_gltf_transmission.html`
- `webgl_materials_physical_transmission.html`
- `webgl_materials_physical_transmission_alpha.html`
- `webgl_materials_physical_clearcoat.html`
- `webgpu_lights_physical.html`

Copy patterns; do not invent APIs.

---

## 2. Repo layout (already scaffolded)

```
rose/
  package.json
  vite.config.js
  index.html
  README.md
  docs/
    AGENT-BRIEF.md          # full product/optics law
    DESIGN-PLAN.md          # this file
  public/
    hdr/                    # overcast forest HDRI
    models/                 # rose.glb (+ draco wasm if needed)
    textures/               # thickness, roughness, vein normal, ground
  src/
    main.js                 # renderer, loop, resize, dispose
    scene/ForestScene.js    # env, fog, terrain, vegetation, lights
    rose/RoseRig.js         # load/build rose, assign materials
    rose/GlassMaterials.js  # ruby + water MeshPhysicalNodeMaterial
    rain/RainSystem.js      # atmospheric streaks (non-transmissive)
    rain/DropletSystem.js   # hero beads + adhesion/coalesce/drip
    rain/WetMaps.js         # clearcoat normal RT micro-wetness
    post/Composer.js        # TSL bloom, grain, mild CA, optional DoF
    debug/Tweakpane.js      # behind ?debug=1
    constants/glass.js      # GLASS_RUBY + WATER defaults
```

Render layers (draw order / intent):

| Layer | Content | Transmissive |
|-------|---------|--------------|
| 0 | soil, trunks, ferns, moss | no |
| 1 | rain streaks | no (alpha) |
| 2 | rose glass | **yes** |
| 3 | water beads | **yes** (≤160) |
| 4 | fog / optional shaft | n/a |

---

## 3. Optical contract (do not renegotiate)

**Glass (rose):** near-white `color`, `transmission=1`, `opacity=1`, `ior=1.52`, `thickness≈0.012` + thicknessMap, `attenuationColor` deep ruby (`0x6e0212`), `attenuationDistance≈0.11`, `dispersion≈0.22`, `roughness≈0.035`, clearcoat wet film, `FrontSide` only.

**Water:** `ior=1.333`, near-clear attenuation, separate instanced spheres — not a normal map alone.

**Tuning order (mandatory):**

1. White attenuation + Infinity distance → prove warp + hard spec  
2. Ruby attenuation → stack goes dark  
3. Dispersion → 1 px limb prism  
4. Clearcoat + wet maps  
5. Exposure grade last  

**If refraction is weak:** densify background first; do not crank IOR to cartoon.

---

## 4. Performance budget (hard)

| Item | Cap |
|------|-----|
| Rose tris | ≤ 200k |
| Hero transmissive drops | ≤ 160 |
| Transmissive materials | ≤ 3 (rose, water, puddles) |
| Atmospheric rain | ≤ 20k non-physical instances |
| Shadow map | 2048 |
| HDRI | 2k |
| Transmission RT scale | 1.0 desktop / 0.5 IGP |

---

## 5. Implementation tasks

### Task 0 — Tooling scaffold

**Objective:** Runnable empty Vite + three r186 shell.

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.js` (clear canvas loop only)
- Create: `src/constants/glass.js` (export `GLASS_RUBY`, `WATER` from brief §14)

**Steps:**
1. `npm init` / pin `"three": "0.186.0"`, `"vite":` current stable, optional `tweakpane`.
2. `index.html` canvas full-viewport; module entry `src/main.js`.
3. `vite.config.js`: default; assets from `public/`.
4. `npm i && npm run dev` — blank clear color proves serve path.

**Verify:** browser loads without import errors; `THREE.REVISION` === `'186'`.

**Commit:** `chore: vite + three@0.186 scaffold`

---

### Task 1 — P0 Boot: transmission proof sphere

**Objective:** One sphere with exact rose glass params + high-contrast backdrop proves refraction/attenuation before any rose mesh.

**Files:**
- Modify: `src/main.js`
- Create: `src/rose/GlassMaterials.js` (`createRubyGlass()`, `createWaterMaterial()`)
- Create: `src/scene/ProofBackdrop.js` (grid or fern photo plane + grey ground)

**Renderer contract (copy exactly):**
```js
const renderer = new THREE.WebGPURenderer({
  antialias: true, alpha: false,
  powerPreference: 'high-performance', forceWebGL: false
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
if ('transmitted' in renderer.shadowMap) renderer.shadowMap.transmitted = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
await renderer.init();
```

**Camera:** `PerspectiveCamera(35, aspect, 0.05, 80)` at `(0.55, 0.42, 1.35)` looking at `(0, 0.38, 0)`.  
**Controls:** OrbitControls, damping, min 0.55, max 3.2, maxPolarAngle `Math.PI * 0.49`.

**Material:** `MeshPhysicalNodeMaterial` with `GLASS_RUBY` defaults; colors via `setHex(..., SRGBColorSpace)`.

**Acceptance gate (must pass before P1):**
- White attenuation mode: background warps through sphere  
- Ruby mode: sphere reads gem, not candy tint on `color`  
- Grazing angle picks up environment/backdrop specular  

**Teacher:** `webgpu_materials_transmission.html`

**Commit:** `feat: P0 glass sphere transmission proof`

---

### Task 2 — P1 Rose stand-in (procedural first)

**Objective:** Phyllotaxis / lofted thick petals ~1.0 unit tall; shared ruby material; tune thickness vs attenuationDistance on real silhouette.

**Files:**
- Create: `src/rose/proceduralRose.js` (petals, sepals, stem, thorns)
- Create: `src/rose/RoseRig.js` (group, cast/receive shadow, dispose)
- Modify: `src/main.js` swap sphere → rig

**Geometry rules:**
- Real thickness 0.004–0.012 world (not paper planes)
- 32×16 petal segments; mergeVertices + computeVertexNormals
- Target 80k–200k tris total; FrontSide
- Optional procedural thickness attribute → DataTexture thicknessMap later

**Tune protocol on real mesh:** single petal pink-translucent; three stacks almost black-crimson. Ice = thickness too small; red rock = attenuationDistance too small.

**Later asset hook:** `RoseRig` accepts GLB path; replace materials from file; same glass factories. Do not block P1 on Blender.

**Commit:** `feat: P1 procedural thick-petal rose + glass assign`

---

### Task 3 — P2 IBL + forest blockout

**Objective:** Refraction subject becomes leaves/trunks, not a grid. Mood = wet overcast forest.

**Files:**
- Create: `src/scene/ForestScene.js`
- Add: `public/hdr/<forest-overcast>.hdr` (or `.exr` via UltraHDR if chosen)
- Modify: `src/main.js` mount forest

**World (≤ ~3 m density around rose):**
- Displaced ground 12×12, wet loam `MeshStandardMaterial` roughness ~0.62
- 8–20 trunks mid-distance
- Ferns/hostas/moss in **1.5 m behind/beside rose** (refraction fuel) — deep green `0x1c3a22`
- `FogExp2(0x8a9a8e, ~0.045)` matched to HDRI horizon
- Lights: hemi + directional sun (brief §7.3 numbers); optional low RectArea/spot for traveling specular
- `scene.environment` = HDR; `environmentIntensity = 0.85`; soft background (blurred mip / separate bg) vs sharp reflections
- **No** final-shot `RoomEnvironment`

**Verify:** through-petal view shows identifiable foliage warp; exposure re-tuned after IBL.

**Commit:** `feat: P2 forest blockout + HDRI IBL`

---

### Task 4 — P3 Micro-wetness maps

**Objective:** Rose reads rained-on with hero droplets disabled.

**Files:**
- Create: `src/rain/WetMaps.js` (512–1024 RT, update every 2–3 frames)
- Wire: `roseGlass.clearcoatNormalMap` + roughness wet mix

**Encode:**
- Scatter dots + comet streaks in petal UV
- Height → normal via screen/UV derivatives
- Flats: lower roughness when wet; rings: slight roughness up + normal ridge
- `clearcoat = 1`, base clearcoatRoughness ~0.03

**Acceptance:** Wet test (§12.6) passes with droplets off.

**Commit:** `feat: P3 animated clearcoat wet maps`

---

### Task 5 — P4 Hero droplets (two-IOR money shot)

**Objective:** 80–160 instanced water spheres on petals; adhesion, coalesce, drip; water magnifies veins more locally than glass magnifies forest.

**Files:**
- Create: `src/rain/DropletSystem.js`
- Use: shared `createWaterMaterial()` only (material budget)

**Sim (CPU OK):**
1. Poisson spawns on `normal.y > 0.25`
2. Store petalIndex, uv/bary, mass, tangent velocity
3. Gravity projected on surface + flow to vein valleys
4. Adhesion clamp; mass overcomes → drip
5. Coalesce distance 0.012; `r ∝ m^(1/3)`
6. Leave silhouette → hand off streak to rain system + splash cue
7. Instance pos = surface + `n * r * 0.55`; flatten scale ~`(1, 0.62, 1.15)`

**Hard cap:** ≤160 visible; never per-drop materials.

**Acceptance:** Two-IOR test (§12.5).

**Commit:** `feat: P4 instanced water beads + surface sim`

---

### Task 6 — P5 Atmospheric rain + wind

**Objective:** Readable falling streaks; not dots; not transmissive.

**Files:**
- Create: `src/rain/RainSystem.js`

**Spec:**
- 8k–12k first (headroom to 20k), camera-aligned quads/capsules
- length 0.08–0.18, width ~0.0015
- velocity `(0.04, -4.8, 0.02)` + wind yaw `sin(t * 0.07)`
- respawn cylinder r=4 h=8 around rose/camera
- color `0xb7c4cc`, opacity ~0.18, depthWrite false, renderOrder -1
- TSL instance offset via `hash(instanceIndex)` + time

**Optional:** distant rain sheet noise alpha.

**Commit:** `feat: P5 atmospheric rain streaks + wind`

---

### Task 7 — P6 Lighting polish + shadows + puddles / caustic

**Objective:** Soft broken shaft mood; rose/veg cast+receive; sparse ground water for extra bend targets.

**Files:**
- Extend: `ForestScene.js` (shadow camera framing, 5–12 puddle disks water mat, optional splash decals)
- Optional: cheap caustic cookie (blurred inverted transmission → soil, opacity ~0.12)

**Shadow:** 2048, bias/normalBias per brief; rain does not cast.

**Commit:** `feat: P6 shadows puddles optional caustic`

---

### Task 8 — P7 Post + camera motion + drip hero

**Objective:** Cinematic grade without smearing transmission; 20–30 s seamless loop feel.

**Files:**
- Create: `src/post/Composer.js` (TSL: bloom thr~1.15 str 0.18–0.28, grain 0.025, edge-only mild CA, optional tiny DoF)
- Extend: `main.js` idle dolly ±4 cm / yaw ±8° over ~20 s; stem sway 0.4°; one midrib bead every ~8 s as eye-follow

**Teacher:** r186 bloom via `three/tsl` / `addons/tsl/display/BloomNode.js` — verify path exists in installed package before import.

**Do not:** bloom the whole rose to hide bad attenuation.

**Commit:** `feat: P7 TSL post + idle camera + hero drip`

---

### Task 9 — P8 Debug GUI

**Objective:** Finish the look with knobs; production hides UI unless `?debug=1`.

**Files:**
- Create: `src/debug/Tweakpane.js`

**Expose:** ior, thickness, attenuationDistance, attenuationColor, dispersion, roughness, clearcoatRoughness, exposure, environmentIntensity, droplet count, rain speed, transmissionResolutionScale.

**Commit:** `feat: P8 debug tweakpane behind flag`

---

### Task 10 — Dispose + perf pass

**Objective:** Clean teardown; hit budget on target GPU.

**Steps:**
- Walk graph: textures, geos, mats, PMREM, RTs, then `object.dispose()` + `super.dispose()` on subclasses
- Cap droplets/rain; drop transmission scale on IGP detect
- Profile: 120 drops + 12k rain + rose + forest stable

**Commit:** `fix: dispose path + perf caps`

---

### Task 11 — Optional GLB upgrade

**Objective:** Replace procedural rose with authored thick-petal GLB + baked thickness/roughness/vein maps when asset ready.

**Files:** `public/models/rose.glb`, bake maps under `public/textures/`, `RoseRig` loader path via GLTFLoader + DRACOLoader.

**No change** to glass factories or acceptance tests.

---

## 6. Acceptance checklist (ship gate)

Copy from brief §12; all eight must pass:

1. Transmission warp (white attenuation)  
2. Volume stack (edge pale / stack dark ruby)  
3. Fresnel (graze mirror / face gem)  
4. Dispersion (thin limb split, not rainbow body)  
5. Two-IOR beads  
6. Wet without heroes  
7. Mood (no studio grey / no neon / slow rain)  
8. Perf (120 drops + 12k rain stable)

---

## 7. Hard prohibitions (fail build review)

- `opacity < 1` as glass  
- `MeshStandardMaterial` + transparent rose  
- Additive red Fresnel instead of attenuation  
- `DoubleSide` on thick petals  
- 4k particle rain + toy rose  
- Final `RoomEnvironment`  
- Bloom hiding bad glass  
- Drei `MeshTransmissionMaterial` unless documented built-in failure  

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Screen-space transmission weak / empty bg | Dense ferns in 1.5 m; never empty studio |
| Glass-behind-glass cost (beads) | Cap 160; single water material; shared rose material |
| Procedural rose silhouette cheap | Subdivide; real thickness; GLB upgrade path |
| WebGPU addon import path drift | Probe installed `three` package for BloomNode path at Task 8 |
| HDRI licensing / mood mismatch | Prefer overcast woodland; fog color match horizon |
| IGP melt | transmissionResolutionScale 0.5; lower rain/drops |
| Over-post smears refraction | Bloom only specular; mild CA edges only; DoF optional tiny |

---

## 9. Open questions (non-blocking)

1. **HDRI source** — owner pick vs agent fetch license-clean 2k overcast forest.  
2. **GLB pipeline** — stay procedural until asset lands, or pause after P1 for Blender.  
3. **Serve host** — cubert GPU box vs Mac/desktop for daily `npm run dev`.  
4. **Caustic cookie** — ship P6 without it if schedule tight; optional polish.

Defaults if unanswered: procedural through P7; agent places a temporary high-contrast forest proxy + any free overcast HDRI with attribution in README; develop where WebGPU works.

---

## 10. Suggested first commands (when executing)

```bash
ssh cubert
cd /sd-backup/projects/rose
# after Task 0 files exist:
npm install
npm run dev -- --host 0.0.0.0
```

Read before glass work:

```bash
# on cubert
less /sd-backup/projects/threejs/three.js-r186/examples/webgpu_materials_transmission.html
```

---

## 11. Execution order summary

```
T0 scaffold → T1 P0 sphere proof → T2 P1 rose → T3 P2 forest/IBL
  → T4 P3 wet maps → T5 P4 beads → T6 P5 rain → T7 P6 light/shadow
  → T8 P7 post/camera → T9 P8 GUI → T10 dispose/perf → T11 optional GLB
```

Stop after any phase that fails its acceptance gate. Optics before foliage density before particles before post.

---

*Plan written 2026-09-12. Spec: docs/AGENT-BRIEF.md.*
