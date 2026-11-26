# Rockfall

An arcade survival game built with Pebble3D. The walls of a desert quarry are coming down: rocks, slate slabs, boulders and finally molten meteors rain into a walled pit in escalating waves. Read the impact markers, dodge, push through the rubble, grab crystals, and stay standing as long as you can.

It is the engine's showcase for:

- **The Rust-side seeded spawners** (`crates/engine-core/src/spawner.rs`). Every falling rock comes from an engine spawner. The game never places a rock itself: the wave director only creates spawner entities (a template body, a rate, a count, a box and a seed), and the engine's own `Pcg32` decides when and where each rock appears.
- **Hundreds to thousands of live dynamic bodies**: up to 1,400 convex-hull rigid bodies on the deterministic build and 1,800 on the fast build (`MAX_ROCKS`, `MAX_ROCKS_FAST` in `src/game/constants.ts`). At the fast build's cap the world holds 1,801 rigid bodies: the rocks plus the player.
- **The KCC character pushing dynamic bodies.** The player is the engine's kinematic character controller (mass 110 kg). It shoves pebbles and rocks aside as it wades through the rubble; boulders (420 kg) barely move.
- **A Node headless bench** (`bench/bodies.ts`) that reports how many bodies each build sustains.

## Run it

```bash
pnpm install && pnpm build:wasm && pnpm fetch-assets   # first time only
pnpm --filter rockfall dev      # http://localhost:5240/
```

| URL                             | What you get                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`                             | Play: the title screen, then endless waves, then the results screen                                                   |
| `/?demo=1`                      | The autoplayer starts from the title and restarts after a game over (`&demoWaves=5` makes it stand down after wave 5) |
| `/?start=1&wave=7&rubble=1400`  | Skip the title, start at wave 7 on a pit pre-filled with 1,400 rocks                                                  |
| `/?build=fast`                  | Run on the fast (non-enhanced-determinism) engine build, with the higher rock cap                                     |
| `/?god=1`                       | No damage (perf runs)                                                                                                 |
| `/?ao=0`, `/?hud=0`, `/?mute=1` | GTAO off, HUD off, sound off                                                                                          |

## Controls

- **WASD or the arrow keys:** move. The camera never turns, so W is always up the screen.
- **Shift:** sprint. It drains the stamina bar under your hull.
- **Space:** jump, over rubble or a rolling boulder.
- **Space, Enter or a click:** start a run, or restart from the results screen.

## How it plays

- **Waves:** each wave lasts 25 s, with a 3.5 s breather between waves and a +500 × wave bonus for clearing one. Each wave mixes background rain (pebbles and rocks from wave 1, boulders from wave 2, slate slabs from wave 3) with special patterns, each announced by a callout: Targeted, Rockslide, Cave-in, Encircled, a Meteor shower (wave 4 on) whose meteors shove every rock within 4 m outward with the engine's `setVelocity`, and Hunter volleys (from wave 2).
- **Reading the danger:** every falling rock that isn't a pebble projects a marker where it will land. The landing point is predicted ballistically, and an engine raycast finds the top of the rubble under it. The colour gives the threat: amber for rocks, orange for slabs, red for boulders, pink for meteors. The sun's cascaded shadows also slide onto the landing point.
- **Near misses:** a rock that falls past your waist within about 1.6 m of you, without touching you, scores +50 × the multiplier and raises the multiplier by 0.1, up to ×4. Any heavy hit resets it.
- **Pickups:** crystals (+250 × the multiplier), repair (+30 hull) and a shield that absorbs one heavy hit.
- **Score:** 10 points per second survived, times the multiplier, plus the bonuses above. Your best score is kept in `localStorage`.
- **The rock cap:** past the cap, the oldest rocks crumble to dust, so the pit stays playable and the body count stays at the cap.

## What the engine is doing

- **One engine world per run.** The sim (`src/game/sim.ts`) builds a fresh `World` for every run: the floor, the walls, four pillars and the KCC player.
- **Rocks come from spawners.** The wave director turns each wave plan into spawner entities, `world.spawn({spawner: {template, rate, count, areaMin, areaMax, seed}})`. Each tick the sim drains `drainSpawned()`, records every new rock by its state-buffer slot, and gives it a seeded tumble through `setVelocity`.
- **Hit tests read the wasm state buffers.** Hits, near misses and landings are judged from the prev and curr state buffers, with no per-body calls into wasm.
- **Shapes match exactly.** Rock shapes are seeded convex hulls. The same points feed the Rust convex-hull collider and three's `ConvexGeometry`.
- **Drawing:** each kind and variant is one `InstancedMesh` in the engine renderer's `InstanceRegistry`, interpolated from the prev and curr buffers.
- **Determinism:** the sim ticks at a fixed 60 Hz with no `Math.random` or `Date`. Runs are reproducible from the seed and the input log.

## Bench

`pnpm --filter rockfall bench` runs the real `RockfallSim` headless in Node on the same wasm the browser runs. On one shared machine, starting at wave 6 with 1,200 rubble rocks for 60 s, the deterministic build held 1,401 bodies at 5.27 ms mean per tick and the fast build held 1,801 at 4.10 ms. The caps were sized from these runs. `node apps/rockfall/bench/fps.mjs` measures browser frame rate; on the integrated AMD Radeon 860M (WebGPU, 1280×720) the full pit held 60 fps with vsync on both builds. Numbers vary by machine.

Captures come from `bash apps/rockfall/bench/capture-final.sh` (seed 7, fixed tick).

## Known issues

- **Rocks are rarely seen in the air before they land.** The chase camera is high and fixed (north-up) so the impact markers read well, which means rocks that spawn 24–30 m up mostly enter the frame only in their last second. The markers and sliding shadows carry the telegraph.
- **Hits are not contact events.** The engine exposes no contact events, so the sim judges hits from the state buffers: a capsule-versus-radius test on rocks at lethal speed. A grazing rock can count as a hit or a miss slightly off from what you see.
- **`time`-driven shader pulses** (meteor veins, the shield) use the renderer's clock, so fixed-tick captures are not pixel-identical in those materials. Game state and the state hash are identical.
- **The demo bot dodges almost perfectly**; it was tuned to keep the captures alive. With `demoWaves` it stands down and gets buried.
