# Examples map

Where each engine feature is used in the showcase games and the playground: feature, file and line range, one-line note. Copy from these; the cookbook ([cookbook/README.md](cookbook/README.md)) explains each pattern. Line ranges were checked against the files when this page was written; if one has drifted, search the file for the named symbol.

## Playground (`apps/playground`)

| Feature | File (lines) | Note |
| --- | --- | --- |
| URL params | `apps/playground/src/main.ts` (8-21) | `scene`, `mode`, `ticks`, `backend`, `cam`, `splat`, `debug`, `script`, `overlay`. |
| Load a scene by name | `apps/playground/src/main.ts` (74-91) | `import.meta.glob` over `scenes/*.json`; fills the default HDRI from the asset manifest. |
| Scripted player input | `apps/playground/src/main.ts` (112-179) | Writes `game.player.input` and camera yaw; `jumpAtTick` shows the two-tick input latency. |
| WebGPU to WebGL fallback | `apps/playground/src/main.ts` (200-212) | Only an implicit backend falls back, on a fresh canvas. |
| Stats overlay | `apps/playground/src/main.ts` (215-217) | `mountOverlay(game, undefined, { startVisible })`; backtick toggles. |
| Fatal error to `__pebble3d.error` | `apps/playground/src/main.ts` (221-231) | Automation reports the error instead of timing out. |
| Scene spawner | `apps/playground/scenes/showcase.json` (361-375) | 60 balls at 4 per second from a prefab. |
| Toon style switch | `apps/playground/scenes/showcase-toon.json` (35-39) | `post.style: "toon"` with default `toon` settings. |
| Splat level, character, presets | `apps/playground/scenes/showcase.json` | Outdoor splat capture, bounds, third-person character, crates. |

## Chain Reaction (`apps/chain-reaction`): JSON levels, headless verify

| Feature | File (lines) | Note |
| --- | --- | --- |
| `createGame` as renderer only | `apps/chain-reaction/src/main.ts` (79-97) | Empty entity list; puzzle bodies live in per-run worlds from the same module. |
| Fixed-step accumulator in `onFrame` | `apps/chain-reaction/src/main.ts` (149-168) | Up to 4 ticks per frame, then drops time; alpha for presentation. |
| Probes and `stateHash` override | `apps/chain-reaction/src/main.ts` (170-186) | Shot sidecars report the puzzle world's hash. |
| New worlds from a loaded module | `apps/chain-reaction/src/puzzle/sim.ts` (58-65) | `engineFrom(handle)`: `new (world.constructor)(seed, g)`. |
| Spawn an expanded scene into a fresh world | `apps/chain-reaction/src/puzzle/sim.ts` (114-133) | `world.spawn(JSON.stringify(e.desc))`, frees the world on failure, own `StateViews`. |
| Preallocated event ring | `apps/chain-reaction/src/puzzle/sim.ts` (180-203) | 64 reused records, drained each tick: no per-tick allocation. |
| One tick: impulses, step, impacts, goal | `apps/chain-reaction/src/puzzle/sim.ts` (205-324) | Springs and fans as mass-scaled impulses; velocity reads from scratch `[12..15)`. |
| Level schema | `apps/chain-reaction/src/puzzle/level.ts` (38-104) | zod `LevelSchema`; `scene` is a partial scene. |
| Compose a level into a scene | `apps/chain-reaction/src/puzzle/compose.ts` (152-256) | `deepMerge` over `levels/base.json`, prefab entities, then `parseScene` + `expandScene`. |
| Headless verify CLI | `apps/chain-reaction/src/cli/verify.ts` (99-145) | Runs each reference solution, compares `expect.hash`; `--update` rewrites it. |
| Wasm in Node | `apps/chain-reaction/src/puzzle/node-engine.ts` (5-14) | `loadSim("deterministic", bytes)`. |
| Demo driver | `apps/chain-reaction/src/demo.ts` (4-27) | Places each solution part by part, runs, shows the result; tick-driven. |

## Rockfall (`apps/rockfall`): custom boot, engine spawners, 1,800 bodies

| Feature | File (lines) | Note |
| --- | --- | --- |
| Boot without `createGame` | `apps/rockfall/src/main.ts` (180-199) | `parseScene`, `expandScene`, `loadSim` and `createRenderer` in parallel. |
| Hand-installed `__pebble3d` hook | `apps/rockfall/src/main.ts` (274-322) | Everything `pnpm shot` reads, plus `game` probes. |
| `FixedStepLoop` with 2 catch-up ticks | `apps/rockfall/src/main.ts` (324-331) | Slows down under load instead of spiralling. |
| Per-tick input, log, step, events | `apps/rockfall/src/main.ts` (336-378) | Bot or live input into one `TickInput`, logged, then `sim.step`. |
| Sync and render | `apps/rockfall/src/main.ts` (383-398) | `views.refresh()`, `renderer.sync(prev, curr, alpha)`, views, `render`. |
| Input log | `apps/rockfall/src/game/input.ts` (8-55) | Quantised axes (1/127) so live play and replay match. |
| Seeded RNG | `apps/rockfall/src/game/rng.ts` (1-31) | mulberry32, allocation-free. |
| Fresh world per run | `apps/rockfall/src/game/factory.ts` (1-21) | Frees the handle's first world on first use. |
| Character from spawn JSON | `apps/rockfall/src/game/sim.ts` (264-287) | Kinematic capsule plus `character`. |
| The tick | `apps/rockfall/src/game/sim.ts` (346-371) | Input, director, `world.step(1)`, refresh, drain spawns, read player. |
| Driving and reading the character | `apps/rockfall/src/game/sim.ts` (373-415) | `setCharacterInput` per tick; `characterState` grounded flag. |
| Runtime spawners | `apps/rockfall/src/game/sim.ts` (418-475) | Spawner JSON per wave order; despawned when finished. |
| Draining spawned bodies | `apps/rockfall/src/game/sim.ts` (595-640) | `spawnedPending`/`drainSpawned` triples; seeded tumble via `setVelocity`. |
| Raycast with exclude | `apps/rockfall/src/game/sim.ts` (934-951) | Filter 2 skips the player when resting a pickup. |
| Game hash | `apps/rockfall/src/game/sim.ts` (216-218) | `stateHash()` plus score, hp, wave, rock count. |
| Spawned bodies into the instance registry | `apps/rockfall/src/game/view/rock-view.ts` (68-101) | `instances.add(key, geo, mat, slot, colour)` / `removeSlot`. |
| Landing rings | `apps/rockfall/src/game/view/telegraph-view.ts` (112-116) | Ground height under each rock, the rock excluded. |

## Ghostline (`apps/ghostline`): marble time trials, ghosts

| Feature | File (lines) | Note |
| --- | --- | --- |
| Boot | `apps/ghostline/src/main.ts` (84-97) | `createGame` with the course scene; the app runs its own worlds in `onFrame`. |
| Worlds from the loaded module | `apps/ghostline/src/game/physics.ts` (5-23) | Refuses the `fast` build. |
| Views per world | `apps/ghostline/src/game/physics.ts` (25-70) | Re-points when memory grows (any world's spawn can). |
| Int8 input log | `apps/ghostline/src/game/input.ts` (1-58) | 3 bytes per tick; run-length base64 for storage. |
| Ghost record and fingerprint | `apps/ghostline/src/game/ghost.ts` (25-67) | Seed, inputs, hash; course and rules fingerprinted. |
| Ghost re-simulation and verify | `apps/ghostline/src/game/ghost.ts` (136-212) | Second world in lockstep; `verifyRecord` replays headless. |
| Live run and ghost per tick | `apps/ghostline/src/game/app.ts` (463-477) | Logs the input, steps both. |
| Accumulator | `apps/ghostline/src/game/app.ts` (559-577) | Up to 5 ticks per frame, alpha for presentation. |
| Trimesh track with smooth seams | `apps/ghostline/src/game/sim.ts` (178-196) | Static `trimesh` colliders, `fixInternalEdges: true`. |
| Ground probe | `apps/ghostline/src/game/sim.ts` (359-391) | Raycast filter 2 excluding the marble; normal from scratch `[1..4)`. |

## Breakpoint (`apps/breakpoint`): demolition, physics in a worker

| Feature | File (lines) | Note |
| --- | --- | --- |
| Boot and build override | `apps/breakpoint/src/main.ts` (93-102) | `?build=` rewrites `sim.build` before `createGame`. |
| Worker or inline sim | `apps/breakpoint/src/main.ts` (118-152) | Worker in realtime; main thread in fixed mode. |
| Worker message handling | `apps/breakpoint/src/game/sim.worker.ts` (36-93) | `loadSim` inside the worker; transferable state buffers. |
| Buffer pool | `apps/breakpoint/src/game/sim.worker.ts` (24-34) | Reuses packed `Float32Array`s returned by the main thread. |
| Worker clock | `apps/breakpoint/src/game/sim.worker.ts` (128-155) | `setTimeout` loop, paused while the tab is hidden. |
| Instant replay by re-simulation | `apps/breakpoint/src/game/replay.ts` (5-17) | A shadow world follows the shot log for a bit-exact replay. |
| `fast` build | `apps/breakpoint/scenes/site.json` (42-45) | SIMD Rapier. |

## Field Notes (`apps/field-notes`): splat sites, depth of field

| Feature | File (lines) | Note |
| --- | --- | --- |
| Inject colliders into a splat scene | `apps/field-notes/src/main.ts` (75-98) | `bounds` plus body-only static boxes from the site data. |
| Static-only occlusion raycast | `apps/field-notes/src/main.ts` (100-105) | Filter 1 for photo line-of-sight. |
| Boot with a player rig | `apps/field-notes/src/main.ts` (118-131) | Fails fast if the scene has no character. |
| Restart with `teleport` | `apps/field-notes/src/main.ts` (158-166) | New seed, player snapped back, log cleared. |
| Ticks from `world.tick()` | `apps/field-notes/src/main.ts` (182-222) | Rules run once per engine tick; the sim's buttons drive `rig.input`. |
| Custom camera arm | `apps/field-notes/src/game/present.ts` (88-109) | Replaces the rig camera; the ray ignores `__bounds.*` walls. |
| Depth of field setup | `apps/field-notes/src/game/present.ts` (115-117) | `bokeh`, `backdrop` per site. |
| Depth of field per frame | `apps/field-notes/src/game/present.ts` (280-290) | Enabled while the camera is raised; focus and range from the lens. |
| Character with `accel` | `apps/field-notes/scenes/yard.json` (65-100) | glTF avatar, clip speeds, explicit capsule. |
| Splat alignment aid | `apps/field-notes/src/scout.ts` (6-10) | `?scout=<scene>&pose=...` draws a 1 m grid over the capture. |

## Ronin Outpost (`apps/katana-defense`): toon horde defence

| Feature | File (lines) | Note |
| --- | --- | --- |
| Inject arena physics | `apps/katana-defense/src/main.ts` (86-104) | Bounds and obstacle boxes added to the scene JSON. |
| Stylise cached glTFs | `apps/katana-defense/src/main.ts` (120-127) | `renderer.stylize(gltf.scene)` once, before any clone. |
| JS sim loop with input log | `apps/katana-defense/src/main.ts` (187-215) | Accumulator, bot/lab/live input, `sim.step`. |
| Probes | `apps/katana-defense/src/main.ts` (217-237) | Phase, wave, kills, hash, rig diagnostics. |
| Toon post settings | `apps/katana-defense/scenes/arena.json` (31-52) | Bands, shadow tone, rim, splat grade. |
| Hand-made toon material | `apps/katana-defense/src/game/view/katana.ts` (71-88) | `ToonNodeMaterial` with `toonRim`/`toonSpecular`. |
| Ragdoll corpse | `apps/katana-defense/src/game/view/zombie-view.ts` (496-537) | Runtime capsule `spawn` plus `setVelocity` spin; avatar hung from its slot. |
| Blob shadows | `apps/katana-defense/src/game/view/zombie-view.ts` (81-99) | One instanced quad mesh instead of skinned shadows. |
| Pre-cloned skinned pool | `apps/katana-defense/src/game/view/zombie-pool.ts` (4-45) | Clone counts from the worst wave, so no clone mid-fight. |
| Two-bone IK | `apps/katana-defense/src/game/view/two-bone-ik.ts` (18-62) | Analytic, allocation-free. |
| Live splat grade | `apps/katana-defense/src/game/view/dusk.ts` (136-145) | `renderer.splatColor` exposure, saturation, tint over the dusk cycle. |

## Skyrun (`apps/skyrun`): parkour time trial, riding kinematic movers

| Feature | File (lines) | Note |
| --- | --- | --- |
| Course format as zod-validated JSON | `apps/skyrun/src/game/course.ts` (102-160) | Islands, blocks, stairs, movers, checkpoints, shards, bot route; readable errors. |
| Mover poses as a pure function of time | `apps/skyrun/src/game/course.ts` (297-330) | slide (eased ping-pong with rests), spin, orbit. |
| Character riding platforms | `apps/skyrun/src/game/sim.ts` (160-169) | `character.ridePlatforms: true` with `accel`, `stepHeight`, `maxSlopeDeg`, `snap`. |
| Movers driven before each step | `apps/skyrun/src/game/sim.ts` (201-216) | `setKinematicPose` for the pose reached in this tick's `world.step`. |
| Jump buffer on top of the engine's coyote time | `apps/skyrun/src/game/sim.ts` (218-236) | A press 8 ticks before landing still jumps. |
| Respawn with `teleport` | `apps/skyrun/src/game/sim.ts` (271-279) | Clears the character's vertical and platform velocity. |
| Ghost re-simulated from the input log | `apps/skyrun/src/game/ghost.ts` (92-124) | Second sim in lockstep; a run that does not finish on its recorded tick is hidden. `courseFingerprint` (`course.ts`, 339) discards records from another layout. |
| `CharacterView` on an app-managed avatar | `apps/skyrun/src/game/view/runner-view.ts` (125-126) | Cross-faded clips and facing without `createGame`. |
| Spring-arm camera on a custom world | `apps/skyrun/src/game/view/camera-rig.ts` (35-48) | `ThirdPersonController` with a static-only ray into the sim's own world. |
| Painted sky and matched fog | `apps/skyrun/src/game/view/sky.ts` (55-68) | Replaces `backgroundNode` and `fogNode` after `createRenderer`. |
| Sub-path hosting | `apps/skyrun/src/main.ts` (86-93) | Root-absolute `/assets/...` and `/basis/` resolved by the renderer's asset base (`VITE_PEBBLE3D_ASSET_BASE`, else Vite's `BASE_URL`). |

## Lanternfall (`apps/lanternfall`): a generated keep, raycast guards

| Feature | File (lines) | Note |
| --- | --- | --- |
| Total seeded generator | `apps/lanternfall/src/gen/generate.ts` (143-156) | `generateKeep`: a seed that fails validation is regenerated with fresh draws. |
| Characters with `accel` in the generated scene | `apps/lanternfall/src/gen/generate.ts` (877-879) | The thief; the guards use the same block with `accel: 10` (970-975). |
| Validate, rasterise, flood-fill | `apps/lanternfall/src/gen/generate.ts` (939-949) | `parseScene` on the generated JSON, then a walkability grid and a reachability flood. |
| Generated scene into `createGame` | `apps/lanternfall/src/main.ts` (53-67) | `generateKeep(seed)`, an optional `?dumpScene=1`, then the scene object straight into `createGame`. |
| Character intents only | `apps/lanternfall/src/game/sim.ts` (377-400) | `setCharacterInput` for every guard and the player each tick. |
| Static-only line-of-sight raycast | `apps/lanternfall/src/game/sim.ts` (534-552) | Guard eye to the thief; a hit closer than the target blocks sight. |

## Ringout (`apps/ringout`): sumo with impulses, kinematic movers, replay

| Feature | File (lines) | Note |
| --- | --- | --- |
| Two players on one keyboard | `apps/ringout/src/game/keys.ts` (3-16) | WASD with Space or Left Shift; arrows with Enter, Right Shift, `/` or Numpad 0. |
| Torque and impulse drive | `apps/ringout/src/game/sim.ts` (207-213) | `applyImpulse` to steer plus `applyTorqueImpulse` about the rolling axis, capped by speed along the stick. |
| Dash | `apps/ringout/src/game/sim.ts` (214-230) | One large impulse with a cooldown, grounded and not staggered. |
| Arena turned by kinematic poses | `apps/ringout/src/game/sim.ts` (294-306) | Every column's pose from the arena angle, the shake and the fall, via `setKinematicPose`. |
| Velocity reads | `apps/ringout/src/game/sim.ts` (322-331) | `linearVelocity` and `angularVelocity` into the scratch buffer every tick. |
| Round hash | `apps/ringout/src/game/sim.ts` (458-478) | Engine `stateHash` plus every rule variable. |
| Instant replay and its proof | `apps/ringout/src/game/app.ts` (240-256, 267-283) | Fresh `RoundSim` from the seed, fed the input log; the final hash is compared on screen. |
| Independent worlds from one module | `apps/ringout/src/game/physics.ts` (15-23) | New `World`s from the already-loaded deterministic wasm. |

## Pebble Garden (`apps/pebble-garden`): scene JSON editor, play and rewind

| Feature | File (lines) | Note |
| --- | --- | --- |
| Export as tidy scene JSON | `apps/pebble-garden/src/garden/doc.ts` (200-226) | 2-space JSON with number arrays on one line; parses back deep-equal. |
| Import with readable errors | `apps/pebble-garden/src/garden/validate.ts` (42-93) | JSON syntax first, then `SceneSchema.safeParse`; every issue with its path and source line. |
| Import size caps | `apps/pebble-garden/src/garden/validate.ts` (30-33) | 2 MB of text, entity and dynamic-body limits. |
| A fresh world per Play | `apps/pebble-garden/src/garden/sim.ts` (133-151) | `expandScene`, a new deterministic `World`, one `spawn` per entry. |
| Kinematic motors | `apps/pebble-garden/src/garden/sim.ts` (220-235) | The pose for the end of the tick from the tick count alone, via `setKinematicPose`. |
| Starter gardens and par | `apps/pebble-garden/src/garden/gardens.ts` (30-72) | Three challenges with reference solutions, and the Rock Garden sandbox. |

## Swarm Siege (`apps/swarm-siege`): instancing at scale, sim in a worker

| Feature | File (lines) | Note |
| --- | --- | --- |
| Agent pool size | `apps/swarm-siege/src/game/constants.ts` (4) | `MAX_AGENTS = 32768`. |
| One `InstancedMesh` per enemy kind | `apps/swarm-siege/src/game/view/swarm-view.ts` (107-125) | Per-instance glow attribute read by a TSL fresnel-rim emissive node. |
| Sim in a module worker | `apps/swarm-siege/src/game/host.ts` (186-193) | `new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" })`. |
| Placement probe | `apps/swarm-siege/src/game/sim.ts` (378-384) | A downward raycast that must hit only the ground. |
| Camera picking | `apps/swarm-siege/src/game/sim.ts` (968-1012) | The cursor ray as an engine raycast: a tower body selects it, the ground gives a build cell. |
| Spawner debris | `apps/swarm-siege/src/game/sim.ts` (889-911) | A runtime Rust-side seeded spawner burst of shards. |

## Drift Drone (`apps/drift-drone`): force-driven flight in a splat capture

| Feature | File (lines) | Note |
| --- | --- | --- |
| The drone body | `apps/drift-drone/src/game/sim.ts` (207-216) | A dynamic sphere with CCD. |
| Reading `angularVelocity` | `apps/drift-drone/src/game/sim.ts` (249-254) | Into the scratch buffer each tick for the rate loop. |
| Rate loop as a torque impulse | `apps/drift-drone/src/game/sim.ts` (384-394) | `applyTorqueImpulse` towards the wanted body rates. |
| Thrust and drag | `apps/drift-drone/src/game/sim.ts` (396-405) | One `applyImpulse` along the body's up axis minus quadratic drag. |
| Ghost by re-simulation | `apps/drift-drone/src/game/ghost.ts` (145-171) | A second `DroneSim` on its own world, re-fed the record's inputs. |
| Static-only camera ray | `apps/drift-drone/src/game/app.ts` (167-176) | The chase camera stays out of the proxy colliders. |
| Photo-finish depth of field | `apps/drift-drone/src/game/app.ts` (767-772) | `renderer.dof` focused on the drone's view depth. |
