# T10 profile budget

Stable target (DESIGN-PLAN Task 10 / brief §12.8): **rose + forest + 120 drops + 12k rain**.

| Path | Drops (`DropletSystem`) | Rain (`RainSystem`) |
|------|-------------------------|---------------------|
| Discrete (default dGPU / non-IGP) | **120** | **12000** |
| IGP heuristic | **80** | **6000** |

## Verify

1. Serve the folder (`npx serve -p 4173 .` or any static host).
2. Open `/?debug=1`.
3. HUD must show `drops 120/120` and `rain 12000` on discrete (or `drops 80/80` · `rain 6000` · `igp` on IGP).
4. Lil-gui **Droplets → count** calls `setCount`; HUD updates. `count = 0` early-outs the bead sim loop (CPU, not only `mesh.count`).

Defaults live in `src/main.js` (`dropMax`, `rainCount`) and `RainSystem` ctor (`count = 12000`).
