# Breakpoint

Breakpoint is a physics demolition game built with Pebble3D. You fire heavy iron balls from a siege cannon at stone structures generated from a seed. Each site gives you three shots, and you score the mass you knock below the orange survey line.

There are three sites, each with 838 to 1,344 rigid bodies:

- **The Old Keep:** four towers, four curtain walls and a tall central keep.
- **Dry Viaduct:** brick piers and beam-and-slab spans, two gatehouses and a colonnade.
- **Sun Citadel:** a ziggurat spire between two towers.

After the run, the game replays your best shot. The replay is not a recording. A second Rapier world rebuilds the site from its seed and is fed the same recorded inputs. When it reaches the end of the shot, it compares its state hash with the live run and shows the result on screen.

## Run it

```bash
pnpm install && pnpm build:wasm && pnpm fetch-assets   # first time only (HDRI sky)
pnpm --filter breakpoint dev                           # http://localhost:5210/
```

| URL                    | What you get                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/`                    | Play: title, then three sites, the demolition report and the best-shot replay                                     |
| `/?demo=1`             | The autoplayer plays every site, then replays the best shot                                                       |
| `/?level=2`            | Start at a later site (0 = keep, 1 = viaduct, 2 = citadel). The run ends after the last site                      |
| `/?seed=n`             | A different run seed, so different block jitter and course counts                                                 |
| `/?worker=0`           | Run the simulation on the main thread instead of in the worker                                                    |
| `/?build=det`          | Use the engine's `deterministic` Rapier build instead of the default SIMD `fast` build (about 2× slower per tick) |
| `/?stats=1`            | Show the debug stats line: fps, awake bodies, Rapier ms/tick, game-time rate                                      |
| `/?mode=fixed&ticks=n` | Fixed-step capture mode: one frame per 1/60 s of game time, and the sim runs inline                               |

## Controls

- **Aim:** point at a spot on a structure. The dotted arc shows the flight path and the ring marks the aim point. The arc turns red when the target is out of reach.
- **Fire:** hold the left mouse button to charge (24–58 m/s), then release.
- **Continue past a card:** Space or Enter, or the button on the card.
- **Replay on the report card:** R, or the button.

## What it shows off

- **Rapier at scale, in Rust/WASM (the engine's SIMD `fast` build).** The run has 3,166 dynamic box bodies over three sites, and a single keep collapse wakes about 1,300 bodies at once. Bricks are laid in interlocking courses with small gaps between neighbours, and they settle and sleep before the first shot. Wake-up spreads through the contact islands.
- **Physics off the main thread.** In real-time play the sim runs in a Web Worker and streams each tick's packed body states (8 floats per body). The main thread mirrors those states, interpolates between the last two ticks and only renders. A collapse that costs 25–40 ms per Rapier tick slows game time but does not drop frames.
- **Instant deterministic replay.** During idle time (aiming, cards), a background "shadow" world re-simulates the level up to the shot in flight. When that shot becomes the best, the shadow is already parked at its fire tick, so the replay starts at once. It plays at 0.4× with a letterbox and ends with a live check of the state hash.
- **Lighting and post on debris.** Cascaded shadow maps, GTAO from the mesh prepass, ACES tone mapping and bloom on the survey tape. The stone is dressed with object-space TSL noise, so the texture stays fixed to each block as it tumbles, and every block gets its own colour jitter. Each block kind is one InstancedMesh.
- **Impact VFX from the physics state alone.** No contact events are needed. A body whose speed drops sharply between two ticks has just hit something. Those hits spawn dust, stone chips, camera shake and synthesised impact sounds. The ball's first hit starts a 0.22× slow-motion impact camera.
- **Audio** is synthesised with WebAudio only: the cannon, stone knocks, a collapse rumble, the charge whine and chimes.

Captures come from `bash apps/breakpoint/bench/capture-final.sh` (seed 7, fixed step, demo autoplayer).

## Known issues

- **Heavy collapses can dilate game time.** At about 1,300 awake bodies a fast-build tick can approach the 16.7 ms budget on a busy CPU, so a big collapse can run a little slower than real time. `?stats=1` shows the effective game-time rate. Frame rates were measured on a shared, busy GPU; an uncontended 60 fps has not been measured.
- **Replay determinism holds within one binary only.** The game ships the `fast` build, whose WASM float maths is deterministic within one binary. The replay re-simulates in the same browser with the same build and checks the hash on screen. Tests run the full demo plus replay on both builds. A replay recorded on one build would not match on the other.
- **Bodies are boxes only.** Drums are box colliders with rotated box visuals, and the arches are corbelled beams rather than voussoirs.
- **Demo bot targets are scripted.** A headless search (`bench/search.ts`) found them. The bot is a capture driver, not a fair opponent.
- **Small particles can clip.** Dust quads are soft but not depth-faded, so they can clip into the ground at grazing angles.
