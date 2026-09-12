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

Optional Vite path still in `package.json` if you want HMR later — **not required for Pages**.

## Controls

- Drag orbit, scroll dolly
- Slow idle camera when near start framing
- `?debug=1` — lil-gui for IOR / thickness / attenuation / exposure

## Stack lock

- `three@0.186.0` only
- Glass = `MeshPhysicalMaterial` transmission + attenuation + dispersion (no opacity-as-glass)
- Water beads = separate instances, IOR 1.333 vs glass 1.52
- Rain streaks = non-transmissive instancing

## License notes

- Code: yours
- `public/hdr/*.hdr`: from three.js examples pack (same license as three.js examples assets — verify before commercial reuse). Swap for your own overcast forest HDRI anytime; keep filename `public/hdr/env.hdr` or edit `ForestScene.js`.

## Optional GLB (T11)

Drop an authored rose at `public/models/rose.glb`. On load the procedural body is replaced; glass materials still come from code. Name meshes with `Petal` / `Sepal` / `Stem` / `Receptacle`. Override path with `?glb=public/models/other.glb`, or `?glb=0` to force procedural.

## Debug

`?debug=1` opens lil-gui (glass / water / droplets / rain / exposure).
