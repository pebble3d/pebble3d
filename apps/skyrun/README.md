# Skyrun

A third-person parkour time trial above a dawn cloud sea, built with Pebble3D. Run, jump and ride your way across floating islands: climb stairs and ramps, hop onto shuttles, a ferry, lifts, a turnstile bridge, orbiting gondolas and a spinning wheel, collect sky shards, pass every checkpoint and reach the gold gate. Your best run comes back as a translucent ghost, **re-simulated** from your own inputs. Before you have a best, the ghost is the "course spirit", a recorded run of the demo bot.

The runner is a kinematic character controller (a Rocketbox avatar or the robot). Every platform is a kinematic body driven by `setKinematicPose`, and the runner rides them through the engine's opt-in `character.ridePlatforms`.

An original game: original name, courses, look and audio.

## Run it

```bash
pnpm install && pnpm build:wasm && pnpm fetch-assets   # first time only
pnpm --filter skyrun dev                     # http://localhost:5280
npx vitest run --project skyrun              # sim, ghost, course and slope tests (Node, real wasm)
pnpm --filter skyrun build && node apps/skyrun/bench/fps.mjs 20       # frame rate, both courses
pnpm --filter skyrun build && node apps/skyrun/bench/live-smoke.mjs   # keyboard smoke test
bash apps/skyrun/bench/capture-final.sh                                # all captures
```

URL params:

- `course=dawnsteps|gale-spires`
- `runner=human|robot`
- `demo=1` (the autoplayer runs both courses in a loop: title, run, results, next course)
- `bot=fast|steady` (demo bot style; `steady` hesitates before jumps)
- `title=1` (stay on the title screen)
- `ghost=0`
- `hud=0`
- `mute=1`
- `cam=hero`, `camYaw`, `camPitch`, `camDist`
- `mode=fixed&ticks=N`

Sub-path hosting: `vite build --base /prefix/`. Shared files stay root-absolute (`/assets/...`, `/basis/`) and are resolved by the renderer's asset base.

## Controls

| Input                          | Action                                                          |
| ------------------------------ | --------------------------------------------------------------- |
| WASD / arrows                  | run, relative to the camera                                     |
| Space                          | jump (an 8-tick jump buffer on top of the engine's coyote time) |
| Shift                          | sprint                                                          |
| Mouse (click to lock) or Q / E | turn the camera; it eases back behind you when left alone       |
| R / Esc                        | restart / menu                                                  |
| Title: ← →, Tab, Enter         | course, runner, start                                           |
| Results: Enter, N, Esc         | retry, next course, menu                                        |

## The loop

1. **Title.** Course cards with medal times and your best, and a runner choice.
2. **Run.**
   - A 3-2-1 countdown, then the clock runs.
   - Checkpoints must be passed in order. Each one shows your split against the ghost.
   - Falling into the clouds respawns you at the last checkpoint. The clock keeps running.
3. **Ghost.** Your best run per course is stored as its input log and replays as a fading cyan ghost.
4. **Results.** Time, medal, shards, falls, best and the gap to the next medal.

## What it shows off

- **Riding kinematic movers.** The engine's `character.ridePlatforms`, added for this game:
  - A grounded character moves exactly with the kinematic body under it, including its rotation about the body's origin.
  - On leaving the body, the character keeps its velocity as momentum.
  - The game uses three mover kinds: slide (eased ping-pong with rests), spin and orbit. Each mover's pose is a pure function of the tick, sent with `setKinematicPose` before each step.
- **The full kinematic character controller:**
  - `accel` 32 m/s²
  - autostep up 0.3 m stairs
  - slope limit 46°; a test proves a 30° ramp is walkable and a 56° slab is not
  - ground snap
  - coyote jump
  - `teleport` respawns
- **The spring-arm camera.** `ThirdPersonController`, with the arm ray hitting only static geometry from the run's own world.
- **Animation blending.** The renderer's `CharacterView` on an app-managed avatar: cross-faded idle, walk, run, jump and fall, with speed-matched playback.
- **Determinism.**
  - The sim owns its world and advances one int8 input record per 60 Hz tick.
  - The ghost is a second world re-fed the logged inputs. A course fingerprint discards stale records.
  - Tests check that a logged run replays to the same hash.
- **Courses as JSON.** `courses/*.json` hold islands, blocks, stairs, movers, checkpoints, shards, medals and the demo bot's route. They are validated with zod on load.

## Key numbers

- 2 courses:
  - Dawnsteps: medals 30 / 36 / 48 s
  - Gale Spires: medals 45 / 54 / 70 s
- Each course has 3 checkpoints and 8 shards.
- The demo bot finishes Dawnsteps in 33.05 s and Gale Spires in 46.47 s (steady style), with 0 falls.
- Character: speed 5 m/s, sprint 8.5 m/s, jump 8 m/s under gravity -18 m/s².
- 60 fps on both courses on the AMD RDNA3 iGPU (WebGPU, 1280x720, `bench/fps.mjs`).
- The sim costs under 0.1 ms per tick per world in Node.

## Known issues

- **Spinning movers.** The runner's facing does not turn with a spinning platform: it follows the runner's own velocity. Air momentum off a spinning or orbiting mover is linear only.
- **Platform carry is not swept.** A mover that pushes the runner into static geometry can overlap it. The courses keep movers clear of walls.
- **Ghosts across browsers.** The shipped course-spirit ghosts were recorded in V8. Mover poses use `Math.sin`/`Math.cos`, so in another JS engine the ghost can drift. It is hidden once it is detected as off its record.
- **No touch or gamepad input.**
