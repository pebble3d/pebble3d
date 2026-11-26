# Pebble Garden

A physics sandbox and level editor built with Pebble3D. Place pieces on a sand garden with the mouse, move, rotate and scale them with a gizmo, set their colour and body type, then press Play to simulate and press it again to rewind exactly. Every garden **is** a Pebble3D scene: Export writes schema-valid scene JSON (download, or copy to the clipboard), and Import opens any scene JSON, with readable error messages when it is not valid. A human can build what an agent writes, and the reverse.

It ships four starter gardens: three challenges (get the pebble into the bowl) and a free sandbox.

| Garden           | Idea                                                                          | Par  |
| ---------------- | ----------------------------------------------------------------------------- | ---- |
| First Roll       | The pebble rolls off the chute and away. Guide it into the walled bowl.       | 1    |
| Domino Terrace   | Nine dominoes stand between you and the bowl. Start the run.                  | 1    |
| The Turning Rake | The pebble will not move by itself. Kinematic rakes turn when you press Play. | 1    |
| Rock Garden      | A free sandbox: a boulder ramp, a domino arc, a rake and a roller.            | none |

## Run it

```bash
pnpm install && pnpm build:wasm       # first time only
pnpm --filter pebble-garden dev       # http://localhost:5290/
pnpm --filter pebble-garden test      # documents, validation, round trips, gardens
```

| URL param                            | What it does                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `demo=1`                             | The autoplayer builds a contraption, plays it, rewinds and exports it                                               |
| `garden=<key>`                       | Open a starter garden (`first-roll`, `domino-terrace`, `turning-rake`, `rock-garden`); `free=1` unlocks a challenge |
| `solution=1`, `play=1`               | With `garden`: place the reference solution, then press Play                                                        |
| `panel=export\|import\|help\|picker` | Open a panel; `bad=1` fills Import with a broken scene and validates it                                             |
| `mode=fixed&ticks=<n>`               | One tick per frame, for captures                                                                                    |
| `backend=webgl`, `mute=1`, `hud=0`   | WebGL backend, sound off, HUD off                                                                                   |

Captures: `bash apps/pebble-garden/bench/capture-final.sh`. Browser smoke test: `node apps/pebble-garden/bench/smoke.mjs`.

## Controls

| Input                                          | Action                                                 |
| ---------------------------------------------- | ------------------------------------------------------ |
| Click a piece in the tray, then click the sand | Place it (hold Shift to keep placing)                  |
| 1–0                                            | Pick one of the ten palette pieces                     |
| Click a piece in the garden                    | Select it                                              |
| G / R / S                                      | Move, rotate or scale gizmo                            |
| Q / E                                          | Turn the selection 15°                                 |
| Arrow keys, Page Up / Page Down                | Nudge 0.25 m                                           |
| Delete, Ctrl D                                 | Delete, duplicate                                      |
| Ctrl Z, Ctrl Shift Z (or Ctrl Y)               | Undo, redo                                             |
| Space                                          | Play, and again to reset (the reset rewinds exactly)   |
| X, I                                           | Export, import (or drop a scene JSON file on the page) |
| ?                                              | Controls                                               |
| Esc                                            | Close a panel, disarm the placing piece, or deselect   |
| Drag, right-drag, wheel                        | Orbit, pan, zoom                                       |

## What it shows off

- **The scene format as a product feature.** The garden is edited as a scene document. Export writes it as tidy, schema-valid scene JSON; the tests check that every palette piece produces a valid scene and that each starter garden survives export and import with an identical document and an identical state hash.
- **Schema validation people can read.** Import reports a JSON syntax error with a line and column, and lists every schema problem with its field path, the line it sits on and, for a misspelt key, a suggestion. A valid scene that uses features the sandbox does not simulate (glTF meshes, characters, spawners, splats) loads with warnings and round-trips through Export unchanged. Text over 2 MB is refused with a readable message.
- **Play and rewind.** Play simulates the garden on the engine's deterministic build, and reset returns to the edited state, so playing twice from the same edit gives the same state hash (tested).
- **Kinematic motors.** Kinematic pieces turn about their own up axis on Play, driven by `setKinematicPose`.
- **Challenges verified headless.** Each challenge's reference solution reaches the bowl within par in Node, and an unsolved garden does not.

## Known issues

- The sandbox simulates primitives and prefabs only. Imported glTF meshes, characters, spawners and splats are kept and exported, but not simulated.
- Challenge gardens lock their own pieces; only the pieces you add can be edited.
