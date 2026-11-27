# Flowroll

A Brazilian jiu-jitsu game played as positional chess in real time. Two jointed wooden mannequins in cloth gis start standing, fight for grips, and the roll flows through the positions real rolls go through: closed guard, half guard, side control, knee on belly, mount and back control. Every position offers up to three moves on your direction keys; every move has a telegraph, a timing window and a counter. Win by submission (armbar, triangle, kimura, rear-naked choke) or on points when the 3-minute clock runs out.

The heart is a deterministic position graph (`src/game/graph.ts`, plain data) driven by a fixed-tick sim (`src/game/sim.ts`) that runs and is tested in Node. The renderer only presents. Design brief and the decisions made while building: [BRIEF.md](BRIEF.md).

## Run it

```bash
pnpm i
pnpm --filter flowroll dev          # http://localhost:5390/
npx vitest run --project flowroll   # graph, scoring, stamina, submissions, clock, replay, CPU, tutorial
bash apps/flowroll/bench/capture-final.sh            # reproduces every capture (deterministic, seed 124)
pnpm --filter flowroll build && node apps/flowroll/bench/fps.mjs   # fps (BENCH_BACKEND=webgl for WebGL)
```

| URL param       | Values                                          | Effect                                                                                  |
| --------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `demo`          | `1`                                             | CPU vs CPU plays the whole loop (roll, replay, results) and rematches forever           |
| `title`         | `1`                                             | Stay on the title screen (an attract roll plays behind it)                              |
| `belt`          | `white`, `blue`, `black`                        | Your partner's belt (default `blue`); in demo, the blue gi's belt                       |
| `belt2`         | `white`, `blue`, `black`                        | Demo only: the white gi's belt (default = `belt`)                                       |
| `versus`        | `1`                                             | Two players on one keyboard                                                             |
| `tutorial`      | `1`                                             | Start in the guided tutorial roll (with `demo=1` a bot follows the cards)               |
| `round`         | `30` to `600`                                   | Round length in seconds (default 180)                                                   |
| `seed`          | integer                                         | Match seed (default: random in realtime play, 1 in fixed mode and demo)                 |
| `pose`          | position id or `all`                            | Pose gallery for review: every keyed pose, solved and contact-resolved as in play       |
| `view`          | `q`, `q2`, `q3`, `front`, `side`, `top`, `back` | Camera for a single-pose gallery                                                        |
| `mode`          | `realtime`, `fixed`                             | `fixed` steps one tick per frame (captures); `ticks=<n>` stops there                    |
| `ticks`         | integer                                         | Fixed mode: stop after this game tick                                                   |
| `backend`       | `webgpu`, `webgl`                               | Renderer backend (default WebGPU)                                                       |
| `webglFallback` | `1`                                             | Fall back to WebGL when WebGPU is missing (read by `createGame`)                        |
| `dof`           | `1`                                             | Depth of field on submissions (off by default: the engine DOF bands on this wide floor) |
| `hud`           | `0`                                             | Hide the HUD                                                                            |
| `mute`          | `1`                                             | No audio (always muted in fixed mode)                                                   |

## Controls

| Action                                                                    | Player 1 | Player 2          |
| ------------------------------------------------------------------------- | -------- | ----------------- |
| Launch a move / pick a counter (each shown next to its key)               | W A S D  | Arrow keys        |
| Grip (hold) · press on the beat · squeeze a submission (hold)             | J        | Numpad 1 (or `,`) |
| Breathe: refill gas, drops your grips (hold)                              | K        | Numpad 2 (or `.`) |
| Posture: harder to grip, a little more defence; stalling after 5 s (hold) | L        | Numpad 3 (or `/`) |

Menus: W/S or arrows choose, A/D or left/right change the partner's belt, Enter starts. In a roll, Esc pauses and, when paused, only resumes (Q in the pause screen quits to the title); in the tutorial, Esc skips straight into a roll. Results: Enter rematches in the same mode (two players stay two players), Esc returns to the title. The replay of the finish can be skipped with Enter after a moment.

How an exchange works: launch a move (your grip must reach the white tick on your grip meter) and your mannequin shifts into its telegraph posture. Then the move is named and a white ring closes on a gold circle: press J as they meet. The defender reads the posture and presses the matching counter; a counter during the telegraph (before the name appears) is the strongest. The wrong counter overcommits and costs gas. In a submission the finisher holds J to squeeze (burning gas) while the defender taps the escape key on each pulse.

## Sourced numbers

| Number                                            | Value                                                                                                         | Source                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Takedown, sweep, knee on belly, pass, mount, back | 2, 2, 2, 3, 4, 4 points                                                                                       | The point values widely used in sport jiu-jitsu competition (simplified: points on arrival, no 3-second hold; no claim to match any federation's rulebook) |
| Round                                             | 3 minutes                                                                                                     | The brief (a short roll); `round` param to change                                                                                                          |
| Tie-breaks                                        | points, then advantages, then time in a dominant position                                                     | Common competition order; the last step stands in for a referee decision                                                                                   |
| Advantage                                         | a move stuffed by less than 0.06 strength, an escaped submission, or the opponent stalling (posture held 5 s) | Design (`TUNE.nearMiss`, `TUNE.stallTicks`)                                                                                                                |
| Sim rate                                          | 60 Hz                                                                                                         | Repo convention (fixed tick, input log per tick)                                                                                                           |
| Telegraph                                         | 28 to 46 ticks per move, ×1.5 when out of gas, ×0.75 with momentum                                            | Design, per move in `graph.ts`; tuned by CPU-vs-CPU runs                                                                                                   |
| Timing window                                     | 36 ticks, beat at tick 26, ±14 ticks of credit                                                                | Design (`TUNE` in `sim.ts`)                                                                                                                                |
| Gas                                               | grip costs 0.04/s, regen 0.06/s, breathing 0.17/s, squeezing 0.07/s                                           | Tuned over 40 seeds per belt pairing so CPUs do not spend the roll empty (see BRIEF.md)                                                                    |
| Submission                                        | squeeze 0.33/s at full grip and gas, escape +0.24 per perfect beat, a pulse every 42 ticks                    | Tuned so equal belts trade escapes and taps, median 6 to 8 s per submission                                                                                |
| CPU belts                                         | reaction 26-48 / 16-32 / 8-20 ticks, read accuracy 42 / 68 / 86 %                                             | Design (`BELT_PARAMS` in `cpu.ts`); tests check a black belt beats a white belt on 15 or more of 20 seeds                                                  |

## What it shows off

- A deterministic sim over a data-driven position graph; a replay of the finish re-simulated from the input log, with the state hash checked against the live roll.
- Hand-keyed poses on primitive-built mannequins with a position-based rig: two-bone IK for hands and feet, grips anchored on the partner's joints, eased blends with anticipation, an arc for the body that ends on top and an overshoot settle, and a capsule contact resolver that keeps the two bodies from passing through each other (checked in Node for every keyed pose).
- The renderer's depth of field on submissions (opt-in with `dof=1`), a fixed pool of warm point lights in a studio scene, and a DOM HUD.
- CPU partners at three belts that read telegraphs with belt-dependent speed and accuracy, and a skippable guided tutorial.

## Known issues

- Poses are keyed for one layout per position; transitions blend between them with an arc, which reads well for passes and sweeps but is a stylised, stop-motion take, not a simulated scramble.
- Grips and wraps may rest up to 3 cm (limbs) or 5 cm (gripping hands) into the partner's gi, and knees up to 3 cm into the mat; `test/contacts.test.ts` enforces this on every pose, every telegraph and every transition blend sample. When a pose cannot be met by re-bending limbs, the resolver slides the upper body clear, so a body can sit a little high rather than pass through.
- Half guard and the triangle are the least convincing poses from some camera angles.
- Gamepad input is not supported (out of scope in the brief).
- Some WebGL drivers print a GL driver performance message (`Running out of reserved outsideRenderPass queueSerial`) once per page on the WebGL backend. It is a driver note, not an error, and other demos in this repo print it on the same drivers. The capture script allows exactly that message on its WebGL shot; WebGPU captures have an empty console.
