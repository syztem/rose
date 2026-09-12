# Crimson Dielectric (v3)

**Paradigm:** screen-space **SDF raymarch** of a crystallographic ruby dielectric bloom (TSL / WebGPU), composited over a wet night canopy. Not a mesh-loft petal stack.

Optics: Beer–Lambert absorption inside the SDF volume, Fresnel at the hit, **glass IOR 1.52** vs **water bead IOR 1.333**, falling rain as thin dielectric streaks.

## Run

```bash
npx --yes serve -p 4173 .
# open http://localhost:4173/
# ?debug=1 — exposure / IOR / rain density
```

Pinned `three@0.186.0`. Static Pages-ready (relative URLs + `.nojekyll`).

## Stack

| Layer | Role |
|-------|------|
| `RaymarchedBloom` | TSL raymarcher: petal SDFs ∪ receptacle, absorption + refraction sample of scene color |
| `WetCanopy` | Low-poly wet ground + emissive shafts for something to refract |
| `RainStreaks` | Instanced non-transmissive streaks |
| `WaterBeads` | Instanced `MeshPhysicalMaterial` droplets (IOR 1.333) drifting on an orbital shell |
| `Composer` | Optional bloom pass |

HDRI: Poly Haven *Forest Slope* (CC0) at `public/hdr/env.hdr`.
