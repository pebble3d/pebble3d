# Ringout

A local multiplayer sumo arena built with Pebble3D. Up to four heavy orbs roll on a spinning arena of 61 hexagonal basalt columns in 5 rings. Shove, dash and knock the others off the edge while the arena collapses ring by ring from the outside in, and the spin speeds up with every ring that drops. Two people can share one keyboard; bots fill the other seats. After every round an instant replay re-simulates the round from its input log and proves on screen that it reproduces the live state hash.

## Run it

```bash
pnpm install && pnpm build:wasm       # first time only
pnpm --filter ringout dev             # http://localhost:5270/
pnpm --filter ringout test            # sim, replay and match tests (Node, real wasm)
```

| URL param                          | What it does                                                            |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `demo=1`                           | Bots fill every seat and the match plays itself                         |
| `title=1`                          | Stay on the title screen                                                |
| `seats=p1,p2,bot,off`              | Seat setup: four of `p1`, `p2`, `bot`, `off` (default `p1,bot,bot,bot`) |
| `bestOf=3\|5\|7`                   | Match length (default 5; demo 3)                                        |
| `seed=<n>`                         | Match seed                                                              |
| `replay=0`                         | Skip the instant replays                                                |
| `mode=fixed&ticks=<n>`             | One tick per frame, for captures                                        |
| `hud=0`, `mute=1`, `backend=webgl` | HUD off, sound off, WebGL backend                                       |

Captures: `bash apps/ringout/bench/capture-final.sh`. Frame rate: `node apps/ringout/bench/fps.mjs`.

## Controls

| Input                               | Action                                                                |
| ----------------------------------- | --------------------------------------------------------------------- |
| W A S D                             | Player 1: roll (the camera never turns, so W is always away from you) |
| Space or Left Shift                 | Player 1: dash                                                        |
| Arrow keys                          | Player 2: roll                                                        |
| Enter, Right Shift, `/` or Numpad 0 | Player 2: dash                                                        |
| Title: 1–4                          | Change what sits in each seat (player 1, player 2, bot or off)        |
| Title: R                            | Change the match length                                               |
| Title: Enter or Space               | Start the match                                                       |
| Enter or Space                      | Skip a replay, or rematch from the results                            |
| Esc                                 | Leave the match                                                       |

## What it shows off

- **Deterministic lockstep.** Every round runs on the engine's deterministic Rapier build at a fixed 60 Hz. Each round is fully defined by its seed and the input log of all four seats.
- **Instant replay with a live hash proof.** The replay builds a fresh world from the round's seed, feeds it the logged inputs, and compares its final state hash with the live round's on screen. The tests check that re-simulating a round from its input log reproduces the live hash exactly, and that one changed input changes it.
- **Impulses and torque.** Orbs are 10 kg dynamic spheres driven by `applyTorqueImpulse` about the rolling axis plus a small `applyImpulse` for steering. A dash is a single large impulse with a cooldown, and a hard hit staggers the orb that was struck.
- **Kinematic movers.** Every hex column is a kinematic body placed each tick with `setKinematicPose`: the whole arena turns, warned rings shake, and dropping tiles fall away in a seeded order.
- **Reading velocities.** Every tick the sim reads each orb's `linearVelocity` and `angularVelocity`: the drive stops adding speed above a cap, and both feed the round's hash, so a replay must match them too.
- **Independent worlds.** The live round and each replay get their own `World` from the same loaded wasm module, so a replay can never touch the live state.

## Known issues

- Local play only. Two people share one keyboard; there is no online mode.
