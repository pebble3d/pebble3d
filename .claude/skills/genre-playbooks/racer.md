# Racer

Time trials, lap racing and ghost chases: the player steers a vehicle through a course and beats a clock or their own best run. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Drift Drone](../../../apps/drift-drone/README.md), an FPV drone time trial with a re-simulated ghost.

- [sim.ts](../../../apps/drift-drone/src/game/sim.ts): the fixed-step drone sim, race phases and gates.
- [ghost.ts](../../../apps/drift-drone/src/game/ghost.ts): the best lap replayed from recorded inputs.
- [track.ts](../../../apps/drift-drone/src/game/track.ts): tracks and sites as data, validated on load.
- [camera-rig.ts](../../../apps/drift-drone/src/game/view/camera-rig.ts): chase and first-person cameras.

## Core systems

- A vehicle as a dynamic rigid body driven by forces and impulses each tick, not animated by hand.
- Gates or checkpoints that must be crossed in order, with a lap timer owned by the sim.
- Tracks as data, so a second track costs a JSON file and not code.
- A ghost: record the inputs of the best lap, then re-simulate them next to the player. Never record positions.
- A bot that races, used for captures and for the determinism test.

## Feel points

- Camera does most of the speed: widen the lens as speed rises and keep the horizon readable. See [game-feel](../game-feel/SKILL.md).
- A trail or streak behind the vehicle shows the line the player is taking.
- Gate passes need an instant cue (flash and tick); a missed gate needs a different one.
- Offer an assisted and a hard handling mode if the brief allows; the demo ships both.
- A slow-motion finish makes the end of a lap an event.

## Verification

- Determinism: the same inputs give the same state hash, and replaying the recorded log gives it again, so lap times repeat exactly ([sim.test.ts](../../../apps/drift-drone/test/sim.test.ts)).
- Ghost fidelity: the ghost flies the recorded lap tick for tick, and a tampered input log no longer reproduces the record ([ghost.test.ts](../../../apps/drift-drone/test/ghost.test.ts)).
- Pinned finish: the demo bot's race on each track ends on a fixed tick with a fixed hash in Node; the README says Chromium matches ([capture-ticks.test.ts](../../../apps/drift-drone/test/capture-ticks.test.ts)).
- Demo pilot: the `?demo=1` pilot flies every shipped track for three laps without a crash and improves each lap ([sim.test.ts](../../../apps/drift-drone/test/sim.test.ts), the `?demo=1 pilot` block).
- Tracks: every shipped track is valid and malformed gates (outside the site, through the ceiling) are rejected on load ([track.test.ts](../../../apps/drift-drone/test/track.test.ts)). If your tracks have shortcuts or off-course gates, write a test that a lap cannot skip a gate.
- The `?demo=1` bot completes a lap and shows the results.
