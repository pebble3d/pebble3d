# Lanternfall

**A stealth heist in a keep that is generated fresh from a seed every run.** You are a thief in a moonlit stone keep guarded by brass automaton wardens. Steal the Ember Relic from the hall farthest from the gate, take what gold you pass, and walk back out the gate. Lantern light shows you to the guards: in the dark they see you only from a step or two away. In a lantern pool they see you from across the room.

Every keep is a real Pebble3D scene. A seeded generator writes the scene JSON, which holds the rooms, doorways, colonnades, pillars, cover, lanterns, the player and the guard characters. The schema validates it, and `createGame` loads it. `?dumpScene=1` shows the JSON and lets you download it.

## Run it

```bash
pnpm i && pnpm build:wasm && pnpm fetch-assets
pnpm --filter lanternfall dev            # http://localhost:5260
```

| URL param              | Effect                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `seed=<n>`             | Which keep (default: random in realtime, 64 in fixed mode). **N** in game loads the next one.                                           |
| `demo=1`               | The autoplayer steals the relic itself. Without a `seed`, it tours keeps: a few seconds after each result it moves on to the next keep. |
| `dumpScene=1`          | Show and download the generated scene JSON (`&layout=1` adds guard routes, lights and loot).                                            |
| `guards=<n>`           | Number of wardens (default 4, clamped to 1-6).                                                                                          |
| `mode=fixed&ticks=<n>` | Deterministic capture mode (one tick per frame). `start=1` skips the title. `hud=0`, `mute=1`, `shotCam=px,py,pz,tx,ty,tz,fov`.         |

Export a keep headless: `pnpm --filter lanternfall gen -- --seed 7 --out keep7.json` (add `--layout` for the metadata). The file loads like any other scene, for example from `apps/playground/scenes/`.

## Controls

| Key           | Action                                                             |
| ------------- | ------------------------------------------------------------------ |
| WASD / arrows | Creep (screen-relative; the camera looks north)                    |
| Shift         | Run. It is faster, but guards within 7 m hear it and come to look. |
| Enter / Space | Begin, or retry the same keep after a result                       |
| N             | A new keep (the next seed)                                         |

The HUD shows how visible you are right now: the eye meter (Hidden / Dim / Exposed), the guard cones and the red suspicion bar. Each cone is drawn at exactly the distance from which that guard could see you right now (your light level, running, an alarm). It is a fan of raycasts at head height, clipped by whatever blocks the guards' sight. A `?` over a guard fills up as its suspicion grows, and `!` means it is chasing you. When a guard is alarmed it first stops and points for about 0.75 s, then gives chase at 3.7 m/s. You run at 5.2 m/s, so break line of sight: it searches where it last saw you before giving up.

## What it shows off

- **Runtime scene generation.** `src/gen/generate.ts` turns a seed into a schema-valid scene, with no `Math.random`. A randomised spanning tree with loop edges sets the doorways, one doorway may be knocked through into a colonnaded great hall, and each room gets a type (pillared hall, storeroom, library, gallery with partitions, relic chamber). `test/gen.test.ts` sweeps the whole live seed range (1 to 10,000; an unseeded run picks from 1 to 9973). It round-trips each scene through JSON text and `parseScene`, rasterises the static colliders of the exported JSON into a walkability grid with the player's clearance, then flood-fills it. The spawn must reach the relic, the exit, every room and every piece of gold, and no patrol may cross the gatehouse. The generator is total: a seed that fails validation is regenerated with fresh draws.
- **Raycast perception AI.** Each guard has a 104° view cone. Its reach scales with the light at the thief's tile: 2.4 m in darkness, up to 10.4 m in full lantern light. A static-only `world.raycast` from the guard's eye to the thief's chest and head decides line of sight. Walls, pillars, bookshelves and tall crate stacks are real cover. Barrels, short crates, tables and braziers are not, and the cones show that. Guards move through patrol, suspicious, alert, search and return states. They shout to nearby guards and investigate running footsteps. Chases use A* over the same grid.
- **Character controller with `accel`.** The thief _and_ the guards are engine characters: kinematic capsules with eased acceleration (`accel` 18 and 10). The sim only writes `setCharacterInput` intents. The guards' Robot animations are driven from `characterState` through `renderer.attachCharacter`.
- **Moody lighting and shadows.** A dim blue moon casts CSM shadows. A pool of 10 point lights follows the camera and is handed to the nearest lanterns, braziers and guards' hand lanterns, with flicker. The light is baked per tile by raycasting from every lantern, so what you see is what the guards see. The floor flagstones and wall ashlar are procedural TSL, and ACES bloom picks up the fires and the relic.
- **Determinism.** Fixed 60 Hz ticks and a seeded generator. The Node test reproduces the browser capture exactly: keep 64 escapes at tick 1784 in both.

## Captures (`bash apps/lanternfall/bench/capture-final.sh`)

| File                     | What                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `01-title.png`           | Title over the generated keep 64                                         |
| `02-creep.png`           | The demo thief sneaking through the dark between guards' cones           |
| `03-alarm.png`           | Keep 18: a warden raises the alarm (red cone, `!`)                       |
| `04-relic.png`           | The relic lifted, objective switched to the escape                       |
| `05-escaped.png`         | Results: escaped                                                         |
| `06-caught.png`          | Keep 42: caught                                                          |
| `07-keep-from-above.png` | Staged overhead of the whole generated keep, with cones clipped by walls |
| `08-title-keep-7.png`    | A different seed, a different keep                                       |
| `09-heist.webp`          | 20 s of the demo heist (10 fps, every 10th tick)                         |
| `10-chase.webp`          | Keep 18's chase                                                          |

## Known issues

- The demo bot escapes in 70% of keeps 1-200 (140 escaped, 58 caught, 2 still playing at 5 minutes) and 69.5% of keeps 201-400 (139/200), measured after the engine's accel/autostep fix. Guards were tuned to make that rate possible: a short startle pause before a chase, a slower chase, and a shorter sight range in lantern light.
- The Robot model has about 20 meshes, so the four guards cost about 160 draw calls; they cast no moon shadows to save the cascade passes.
- Guard-on-guard collisions in a doorway are resolved by stuck detection (skip to the next waypoint), not by avoidance.
- Realtime mode samples input once per frame, so several ticks of one frame share it: live play is not replayable tick-for-tick (fixed mode is).
