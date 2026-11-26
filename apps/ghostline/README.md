# Ghostline

A marble time trial built with Pebble3D. Tilt the board and roll a glass, chrome or ember marble down three ribbon courses in the sky, with boosts, jumps, sweepers and checkpoints, against a translucent ghost of your best run. The ghost is never a recording. It is your run **re-simulated**: a second Rapier world fed the same seed and the same logged inputs, one tick at a time, in lockstep with you.

An original game: original name, courses, look and audio.

## Run it

```bash
pnpm install && pnpm build:wasm && pnpm fetch-assets   # first time only
pnpm --filter ghostline dev              # http://localhost:5220
pnpm --filter ghostline test             # sim, determinism and course tests (Node, real wasm)
pnpm --filter ghostline build && node apps/ghostline/bench/smoke.mjs   # browser end-to-end
```

URL params: `course=sunfold|lacquer|undertow`, `demo=1` (the bot drives), `title=1`, `skin=glass|chrome|ember`, `ghost=best|par|off`, `bot=fast|par|slow`, `mode=fixed&ticks=N`, `hud=0`, `mute=1`, `camAngle`/`camDist` (glamour angles), `hide=ground,pillars,deck,...` (look-dev).

## Controls

| Input                         | Action                              |
| ----------------------------- | ----------------------------------- |
| W A S D / arrows / left stick | tilt the board (camera-relative)    |
| Space / pad A                 | hop (when grounded)                 |
| Shift / pad B, LT             | brake                               |
| R                             | retry (race your ghost again)       |
| Esc                           | menu                                |
| Title: ← → / ↑ ↓ / G / Enter  | course / marble / ghost mode / race |

## What it shows off

- **Determinism (the point).** Every run is fully defined by `(course JSON, seed, input log)`. The fixed 60 Hz sim runs on the engine's deterministic Rapier wasm build. Inputs are converted to world space and quantised to int8 _before_ they are logged, so the camera never leaks into the sim. A ghost is a second `MarbleSim` on its own `World` in the same wasm module, stepped in lockstep with the live run.
  - `test/determinism.test.ts`, per course: a recorded noisy run re-simulates to the identical final hash; the ghost matches the original on every tick; flipping one logged input changes the outcome; the seed sets the sweeper phases.
  - The shipped par ghosts (`ghosts/*.par.json`, recorded in Node) are re-simulated in tests **and in the browser**. The browser ghost ends on the same hash that Node wrote, so Node and Chromium are bit-identical.
  - After every run, the results screen re-simulates your run headless on a fresh world and shows the reproduced hash. Only a verified run can become your saved best.
- **PBR.** The marbles use MeshPhysical (TSL) materials: iridescent clearcoat glass whose opacity follows the fresnel term, with an emissive twisted vane inside; mirror chrome; and ember, with animated noise veins. The courses add lacquered clearcoat decks with a TSL lane pattern, glass walls, metal rails, emissive neon rails and grid floors, CSM shadows, GTAO and bloom. The lighting is the outdoor HDRI (Sunfold) or the studio cyclorama (Lacquer, Undertow).
- **JSON-authored levels.** `courses/*.json` are a Pebble3D scene (environment, lighting, post) plus a turtle-style track: segments (`len`, `turn`/`radius`, `gap`, `pitch`, `bank`, `width`, `wall`) and features (`boost`, `checkpoint`, `finish`, `sweeper`). `Track` expands a course into centreline frames, trimesh colliders (with `fixInternalEdges`) and meshes. Course tests check the frames and trimeshes, and that the bot finishes inside bronze on several seeds.
- **Feel.** The chase camera widens its FOV and pulls back with speed, rolls with the tilt and shakes on landings. Speed lines, spark bursts, a ghost trail ribbon, sub-tick split times with deltas against the ghost, medal targets, and WebAudio-synthesised rolling, wind, boosts, chimes and fanfare.

Captures come from `bash apps/ghostline/bench/capture-final.sh` (fixed tick, demo bot, par ghost on seed 1).

## Known issues

- The keyboard tilt eases in over about 0.14 s. With no analogue stick, fine lines through hairpins take practice.
- The par times and medal targets are set from the bot. Gold is near the bot's pace, so it may be hard for a first-time human.
- Sunfold's horizon shows a soft seam where the explicit fog colour meets the HDRI sky.
- Glass walls and the ghost are transparent with no order-independent transparency. Through stacked glass, the sorting can pop at grazing angles.
- "Tilting" is modelled as a slope force plus camera roll; there are no tilting platforms. "Jumps" are kicker ramps over gaps plus a hop.
