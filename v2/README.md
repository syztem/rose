# Glass Red Rose in Rain (three.js r186)

Static WebGPU scene — **upload the folder to GitHub Pages and it runs**. No build step.

## Deploy (GitHub Pages)

1. Create a repo, push **this whole directory** (including `src/`, `public/`, `index.html`, `.nojekyll`).
2. Settings → Pages → Deploy from branch → `main` / root (or `docs/` if you move files there).
3. Open the site URL. Use a current Chromium / Firefox / Safari (WebGPU preferred; WebGPURenderer falls back to WebGL2).

### Why it works offline-of-npm

| Need | Source |
|------|--------|
| three r186 core (WebGPU) | `https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.webgpu.js` |
| TSL | `https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.tsl.js` |
| addons (`OrbitControls`, `HDRLoader`, `lil-gui`, BloomNode) | `https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/...` |
| Local modules | relative `./src/**/*.js` |
| HDRI | relative `./public/hdr/env.hdr` (bundled) |

Import map is in `index.html`. **Pinned `0.186.0`** — do not float `@latest`.

`.nojekyll` is required so GitHub does not ignore `src/` or underscore paths.

### Project pages base path

All URLs are **relative** (`./src/main.js`, `import.meta.url` for HDR). Works for:

- `https://user.github.io/repo/`
- `https://user.github.io/`
- local `npx serve .` or any static host

Do **not** put a leading `/` on module paths.

## Local preview

```bash
npx --yes serve -p 4173 .
# or: python3 -m http.server 4173
```

Open `http://localhost:4173/`  
Debug GUI: `http://localhost:4173/?debug=1`  
Proof mode (glass rose only, no forest/rain): `http://localhost:4173/?proof=1` (alias `?p0=1`)

## Controls

- Drag orbit, scroll dolly (touch: one-finger orbit, pinch dolly; HUD respects safe-area)
- Slow idle camera when near start framing
- `?debug=1` — lil-gui for IOR / thickness / attenuation / exposure
- `?proof=1` / `?p0=1` — glass rose alone (skip forest, rain, wet maps)

## Stack lock

- `three@0.186.0` only
- Glass = `MeshPhysicalMaterial` transmission + attenuation + dispersion (no opacity-as-glass)
- Water beads = separate instances, IOR 1.333 vs glass 1.52
- Rain streaks = non-transmissive instancing

## License

- Code: yours

## CREDITS

### HDRI — `public/hdr/env.hdr`

- **Asset:** [Forest Slope](https://polyhaven.com/a/forest_slope) (1k `.hdr`)
- **Author:** Andreas Mischok
- **Source:** [Poly Haven](https://polyhaven.com/)
- **License:** [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication; attribution appreciated, not required)
- **URL:** https://polyhaven.com/a/forest_slope
- **Load path:** keep filename `public/hdr/env.hdr` (see `src/scene/ForestScene.js`). To refresh: `bash scripts/fetch-env-hdr.sh`

Previously this path held three.js examples `moonless_golf_1k.hdr` (not forest mood / unclear for shipping). Replaced with the CC0 forest HDRI above (F07).

## Rose GLB (v2)

**Default:** app loads `public/models/rose.glb` with no flags (silent procedural fallback if missing).

**Shipped:** denser dual-shell loft (~4.9 MB undraco, 40 petals, 48×24) + bake maps:
- `public/textures/rose_thickness.png`
- `public/textures/rose_roughness.png`
- `public/textures/rose_veins.png`

Materials go through `createRubyGlass` / `createStemGlass`. Wind uses `userData.baseRotZ`. Regenerate: `node scripts/export-rose-glb.mjs` (needs `three@0.186.0` + `pngjs`). Force procedural: `?glb=0`.


## Debug

`?debug=1` opens lil-gui (glass / water / droplets / rain / exposure). Live FPS sits top-right always; debug HUD also shows avg fps and quality ladder step (`Q1`…`Q4`). Under load the ladder steps down (rain → droplets → pixelRatio → bloom off) with cooldown; recovers when FPS is healthy. Proof mode skips the ladder.

## Profile budget (T10)

Discrete defaults: **120 water beads + 12000 rain streaks** (IGP: 80 / 6000). Open `?debug=1` — HUD shows live `drops N/M · rain K`. See `docs/PROFILE.md`.
