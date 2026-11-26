# Drift Drone

An FPV drone time trial built with Pebble3D. Fly a racing quadcopter through LED gates set around an old brick hall in a real Gaussian-splat capture: low over the garden beds, up past the windows and under the eaves, down through a gap between the planters. Your best lap comes back as a ghost, **re-simulated** from your own stick inputs, and races you from the line. The last crossing of the line is a slow-motion photo finish with depth of field.

The drone is a plain dynamic rigid body, and nothing animates it. Each 60 Hz tick it gets a thrust impulse along its own up axis and a torque impulse from a rate controller that reads the engine's `angularVelocity`. It flies among invisible proxy boxes that stand in for the capture's solid parts.

An original game: original name, tracks, look and audio.

## Run it

```bash
pnpm install && pnpm build:wasm && pnpm fetch-assets   # first time only
pnpm --filter drift-drone dev              # http://localhost:5310
pnpm --filter drift-drone test             # sim, ghost, track and key tests (Node, real wasm)
pnpm --filter drift-drone build && node apps/drift-drone/bench/fps.mjs hall-circuit 20   # frame rate
bash apps/drift-drone/bench/capture-final.sh                                             # all captures
```

URL params:

- `track=hall-circuit|needle-and-eaves`
- `flight=assisted|acro`
- `demo=1` (the autopilot races, then races again after the results)
- `title=1`
- `cam=chase|fpv`
- `ghost=0`
- `hud=0`
- `mute=1`
- `debug=colliders` (draws the proxy colliders and the flight volume)
- `shotCam=px,py,pz,tx,ty,tz,fov` (a staged camera)
- `mode=fixed&ticks=N`

Sub-path hosting: `DRIFT_DRONE_BASE=/prefix/ pnpm --filter drift-drone build`, or `vite build --base /prefix/`.

## Controls

| Input                              | Assisted                                                  | Acro                                                      |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| W / S                              | climb / descend; let go and it holds altitude             | throttle lever: stays where you leave it, starts at hover |
| Space                              |                                                           | ease the throttle back to hover                           |
| A / D                              | yaw                                                       | yaw rate                                                  |
| Arrows (or I J K L)                | tilt; let go and it levels and brakes                     | pitch and roll rates; nothing levels it                   |
| Gamepad (mode 2)                   | left stick: throttle and yaw; right stick: pitch and roll | the same; the left stick's centre is hover thrust         |
| C                                  | chase / FPV camera                                        |                                                           |
| R / Esc                            | restart the race / menu                                   |                                                           |
| Title: Tab or ← →, M or ↑ ↓, Enter | track, flight mode, arm                                   |                                                           |

## The loop

1. **Title.** Pick a track and a flight mode.
2. **Race.**
   - A 3-2-1 countdown on the pad, then 3 laps. The lap clock starts at the first crossing of the start/finish gate.
   - Gates must be flown in order. The next gate pulses in the track's hot colour, and an edge arrow points to it when it is off screen.
   - Hitting a collider hard, or ending up flipped on the floor, is a crash: about a second of SIGNAL LOST, then you respawn hovering past the last gate. The clock keeps running.
3. **Ghost.** Your best lap per track and mode becomes a ghost that leaves the line with you on every later lap. Split deltas show at each gate.
4. **Photo finish.** A long lens beside the line replays the last second at about a fifth of real speed, with depth of field on the drone and the ghost. The shutter fires on the sub-tick of the crossing.
5. **Results.** Total, laps, crashes and a medal. A new best lap is re-simulated headless and its hash is shown (MATCH).

## What it shows off

- **6-DOF force-driven dynamic bodies.**
  - The drone is a 0.8 kg dynamic sphere with CCD. It is flown only by `applyImpulse` (thrust plus quadratic drag) and `applyTorqueImpulse` (a rate loop on `angularVelocity`).
  - Assisted mode adds an attitude loop (auto-level and a drift brake) and altitude hold. Acro maps the sticks straight to body rates.
  - The controller uses only `+ - * /` and `Math.sqrt` on the deterministic build's f32 state. The demo race's finish hash in Chromium equals the one Node computes (`test/capture-ticks.test.ts`).
- **Ghosts by re-simulation.**
  - A best-lap record is the race's input log up to that lap's end, 4 bytes per tick, run-length encoded.
  - The ghost is a second `DroneSim` on its own Rapier world. It replays to the lap's start line in the background, then flies the lap in lockstep with you.
  - Tests check that it is tick-for-tick identical to the original lap, and that a tampered log or a stale record is rejected.
- **Splat-and-mesh compositing at speed.**
  - The capture is the 800k-splat "Knock Community Hall". Procedural gates (frames with bloom LED strips), the quad (spinning props with blur discs, nose and tail LEDs), light trails and the additive ghost composite into it.
  - The drone and the gates cast shadows onto the splat floor.
  - 7 proxy boxes (hall, tote, ramp and railings, 3 planters), plus the flight volume's walls and ceiling, are the colliders.
- **Depth of field.** The photo finish drives `renderer.dof`: focus on the drone's view depth with a shallow range.
- **Cameras.**
  - Chase rides about a quarter second back along the flown path, so it follows the drone through gate openings. A static-only raycast keeps it out of the proxies.
  - FPV is the quad's own camera with a 10° uptilt and an artificial horizon.
- **Tracks as JSON.**
  - `tracks/*.json` hold the pad, the gates (position, through-direction, size, callout), laps, medals and colours. `src/data/yard.json` holds the flight volume and the proxy boxes.
  - Tracks are validated on load: every gate must be inside the crisp part of the capture and under the ceiling.
  - There are 2 tracks of 7 gates each, Hall Circuit (Rookie) and Needle & Eaves (Pro). The demo pilot's laps run 9.9 to 11.3 s.

Captures come from `bash apps/drift-drone/bench/capture-final.sh` (fixed tick, demo pilot; its laps improve, so from lap 2 it races its own ghost).

## Known issues

- The capture is a drone survey. Looking west or south, or flying close to the hall wall, shows its soft blur. The gates keep you inside the crisp volume.
- The proxy colliders are hand-placed boxes. The ramp and railings are solid blocks, so you cannot thread the railing bars.
- Splats write no depth. The photo finish's depth of field gives splat pixels the floor plane or a 16 m backdrop distance, so nearby splat walls blur a little too much.
- When a lap sets a new best, its ghost is re-simulated synchronously at the next line crossing, and the results screen verifies it again. Each takes about 0.01 to 0.03 ms per tick, which is a 25 to 55 ms hitch for a typical race and more for a very long one.
- Keyboard acro is hard; a gamepad is much better. The demo pilot flies only assisted mode, and it has no recovery if perturbed into a wall.
- Frame rate: 60 fps is not yet confirmed; it was measured at 28 to 38 fps while the GPU was busy with other work. Re-measure on an idle GPU with `node apps/drift-drone/bench/fps.mjs`.
