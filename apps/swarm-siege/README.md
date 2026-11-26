# Swarm Siege

A top-down tower defence game built with Pebble3D. Two rifts at the far corners of a
night-time salt flat pour a glowing tide of creatures down ember-lit lanes. The lanes merge
into one serpentine trunk that ends at the Beacon. Place towers on the build pads beside the
lanes, upgrade them, and hold for twelve waves. Wave 12 sends more than 7,000 enemies and
peaks at about 6,000 alive at once.

It is the engine's showcase for:

- **Instancing at scale.** Each enemy kind is one `InstancedMesh`. The Mite pool has
  32,768 slots. Every frame the view writes the instance matrices and a per-instance glow
  attribute, which a TSL fresnel-rim emissive node reads. Towers are one `InstancedMesh` per
  type and part: about 30 draw calls for any number of towers.
- **A sim in a Web Worker.** In realtime play the whole game sim runs in a module worker and
  posts packed, transferred snapshots with backpressure. Fixed-mode captures and tests run
  the same code on the main thread.
- **Camera picking with engine raycasts.** The cursor ray is a `World.raycast`: a tower
  collider selects that tower, and the ground gives a build pad. A downward probe that must
  hit only the ground confirms each placement.
- **The Rust-side seeded spawners.** A Brute's death, and the Beacon's fall, create a
  runtime engine spawner that drops up to 320 debris shards as real rigid bodies.
- **A perf HUD and bloom VFX.**

## What runs where

- **Enemies are not physics bodies.** They are pooled kinematic agents in TypeScript, in a
  structure-of-arrays pool. Each agent is a path index, an arc-length progress and a lateral
  offset on pre-sampled lane curves. A uniform grid rebuilt every tick serves the tower
  queries. This all runs in the worker.
- **The Rapier world** (the `fast` SIMD wasm build by default; `?build=deterministic` also
  works) holds the static colliders: the ground, the outcrops, the Beacon and one box per
  tower, up to 64. It answers the picking and placement raycasts and simulates the debris
  shards. It lives in the same worker.
- **Why not bodies:** `bench/physics-agents.ts` steers N dynamic, mutually colliding Rapier
  spheres with `setVelocity` every tick. It does not measure kinematic or non-colliding
  bodies. On the development machine (Node), the `fast` build took about 4 ms per tick at
  1,000 bodies and 20 ms at 4,000. The pooled agents take about 0.2 ms at 4,000 and 1.5 ms
  at 32,768 (`pnpm --filter swarm-siege bench`).

## Run it

```bash
pnpm install && pnpm build:wasm      # first time only; no downloaded assets are needed
pnpm --filter swarm-siege dev        # http://localhost:5300/
```

| URL                                            | What you get                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/`                                            | Play: title, then waves with build phases, then the result screen                                             |
| `/?demo=1`                                     | The autoplayer places towers by camera-ray pick, upgrades them, calls waves early and restarts after a result |
| `/?demo=1&wave=12&gold=3000`                   | The final wave, at full size                                                                                  |
| `/?stress=1&rate=1000`                         | Perf stress: an endless stream of Mites that loop back to the rifts (no towers, no deaths)                    |
| `/?worker=0`                                   | Run the sim on the main thread                                                                                |
| `/?build=deterministic`, `/?hud=0`, `/?mute=1` | Other wasm build, HUD off, sound off                                                                          |

All parameters are listed at the top of `src/main.ts`.

## Controls

| Input                            | Action                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `1`-`4` or click a card          | Choose Spark (60), Mortar (100), Frost (80) or Lance (150). The pad grid and a range ghost appear. |
| Left click                       | Place the chosen tower on the pad under the cursor, or select a tower                              |
| `U` / `X`                        | Upgrade / sell the selected tower (selling refunds 70%)                                            |
| `Enter` / `Space`                | Begin, call the next wave early, or restart after a result                                         |
| `WASD` / arrow keys, middle drag | Pan                                                                                                |
| `Q` / `E`, right drag            | Orbit                                                                                              |
| `R` / `F`, mouse wheel           | Tilt, zoom                                                                                         |
| `Esc`                            | Cancel placement or selection                                                                      |

Spark fires fast bolts at the enemy closest to the Beacon. Mortar lobs a shell to where its
target will be, with splash damage. Frost pulses a field that slows and chips everything in
it. Lance fires a piercing beam that hits everything along its line. Each tower has three
levels. Enemies come in three kinds: Mites (the tide), Gliders and Brutes.

## Key numbers

All measured on the integrated AMD Radeon 860M (WebGPU, 1280×720, vsync), sim in the
worker, `fast` build, with other GPU work running on the same machine. Numbers vary by
machine.

- **Final wave with the demo bot:** 59.2 fps mean, p95 16.8 ms, with 1,500-6,100 agents
  on the field. The worker sim took 0.57 ms per tick. The main thread took 4.5 ms per frame.
- **Stress ramp** (`node bench/fps.mjs ramp`): 60 fps held up to **about 22,900 live
  agents** in the best run. Other GPU load made repeat runs lower.
- Run `node bench/fps.mjs [demo|ramp|both]` after `pnpm --filter swarm-siege build`
  (`BENCH_VSYNC=1` measures under the 60 Hz cap). Run `node bench/smoke.mjs` for a live
  mouse and keyboard test through the worker.

Captures come from `bash apps/swarm-siege/bench/capture-final.sh` (seed 7, fixed tick). The
capture ticks are pinned in `test/capture-ticks.test.ts`.

## Determinism

The rules tick at a fixed 60 Hz with no `Math.random` or `Date`. Runs are reproducible from
the seed and the command log. The tests run the deterministic wasm in Node and check four
things:

- The same seed gives the same hash.
- Worker-style batches of 1, 3 or mixed ticks give the same hash as single steps.
- Coalesced snapshots leave the sim unchanged.
- The capture ticks stay where `capture-final.sh` expects them.

## Known issues

- **Captures run the sim inline.** `pnpm shot` uses fixed-tick mode, which runs on the main
  thread. The worker path is exercised by `bench/fps.mjs` and `bench/smoke.mjs`.
- **The game holds when the page stalls.** If the main thread stops taking snapshots, the
  worker keeps at most two in flight, merges newer ticks into one, and then pauses the sim.
  A long stall pauses the game instead of fast-forwarding it.
- **`stateHash()` can lag the tick in worker mode.** In realtime the worker refreshes the
  hash only every 30 ticks.
- **Clicks act on the latest hover pick.** The pick answer comes back from the worker one
  frame later, so a click right after a fast mouse move can use the previous cell. Touch
  input has no hover.
- **Waves can have a long tail.** Late waves can last 20-40 s after the tide is cleared,
  while the last slow Brutes walk in.
- **The fast build is machine-specific.** It is deterministic only on the same binary and
  machine. A cross-machine replay needs `?build=deterministic`.
