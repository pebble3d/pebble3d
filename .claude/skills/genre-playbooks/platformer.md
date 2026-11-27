# Platformer

Running, jumping and riding across a course with a character controller. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Skyrun](../../../apps/skyrun/README.md), a third-person parkour time trial with moving platforms and a re-simulated ghost.

- [sim.ts](../../../apps/skyrun/src/game/sim.ts): the kinematic character controller (with `ridePlatforms`), moving platforms, checkpoints, shards and the run clock.
- [physics.ts](../../../apps/skyrun/src/game/physics.ts): separate physics worlds for the live run and each ghost, made from the loaded deterministic module.
- [course.ts](../../../apps/skyrun/src/game/course.ts): courses as validated JSON.
- [camera-rig.ts](../../../apps/skyrun/src/game/view/camera-rig.ts): the spring-arm camera.

## Core systems

- A kinematic character controller with grounded and airborne states, slopes, steps and moving platforms (the engine's opt-in platform riding).
- Forgiveness built into the controller: coyote time and jump buffering. Input latency is the genre's main complaint.
- Courses as data: islands, movers, checkpoints, collectibles and the bot's route.
- Checkpoints that respawn the player without resetting the clock.
- A spring-arm third-person camera whose ray sees only static geometry.

## Feel points

- Blend animations (idle, run, jump, fall) with speed-matched playback rather than snapping between clips.
- Landing needs a puff, a squash and a sound scaled by fall height. See [techniques.md](../game-feel/techniques.md).
- A dust trail while running and a clear shadow under the character make height readable.
- Collectibles chime on a rising pitch so a chain feels rewarding.
- Never let the camera clip into a wall; test the corners of every course.

## Verification

- Determinism: a run replays bit-exactly from its input log, which is also what makes the ghost trustworthy ([sim.test.ts](../../../apps/skyrun/test/sim.test.ts)).
- Every shipped course parses through its schema, and the demo bot finishes each one through every checkpoint without falling ([sim.test.ts](../../../apps/skyrun/test/sim.test.ts)).
- Falling off respawns at the last checkpoint and keeps the clock running, and the runner rides a moving platform (the ferry test), both in the same file. Standing on each mover for a full cycle and respawn-on-solid-ground are checks you must write for your own courses.
- Slope limits are tested: a gentle ramp is walkable and a steep slab is not. Write the equivalent for your own step and slope values.
- Capture the hardest jump from the side so the arc and the camera are both visible.
