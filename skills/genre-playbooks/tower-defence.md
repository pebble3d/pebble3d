# Tower defence

Waves of enemies follow a path while the player places and upgrades defences. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Swarm Siege](../../apps/swarm-siege/README.md), a top-down defence with thousands of instanced enemies and the sim in a worker.

- [waves.ts](../../apps/swarm-siege/src/game/waves.ts): wave composition as data.
- [defs.ts](../../apps/swarm-siege/src/game/defs.ts): tower and enemy definitions.
- [path.ts](../../apps/swarm-siege/src/game/path.ts): lanes that merge into one route to the goal.
- [swarm-view.ts](../../apps/swarm-siege/src/game/view/swarm-view.ts): one instanced mesh per enemy kind.

## Core systems

- A path (or lanes) from spawn to the goal, with build pads beside it.
- Towers with range, rate and damage; upgrades with a clear cost curve.
- Wave definitions as data: kind, count, spacing and the reward for finishing.
- Enemies as pooled agents in plain code, not physics bodies, so the count can climb.
- An economy: income per kill and per wave, so the player always has a decision to make.
- Picking: the cursor ray chooses pads and towers.

## Feel points

- Every tower shot needs a muzzle flash, a travelling tracer and a hit spark; at scale, these are the whole game.
- Enemy deaths pop in batches with a short sound, capped so a big wave does not become noise.
- Show range rings on hover and a clear ghost of the tower before placing.
- A wave banner and a rising music layer sell the final wave.
- The goal taking damage needs shake and a red edge, not only a number.

## Verification

- Determinism: the same seed and bot give the same hash, and another seed differs ([sim.test.ts](../../apps/swarm-siege/test/sim.test.ts)).
- Map: every path reaches the core, and build cells keep off the lanes. Placing a tower on a pad and then casting a camera ray picks that tower ([sim.test.ts](../../apps/swarm-siege/test/sim.test.ts)).
- Balance by bot: an undefended core falls and the demo bot holds the beacon through several waves (the same file); the capture-tick test pins a final-wave victory and an undefended defeat ([capture-ticks.test.ts](../../apps/swarm-siege/test/capture-ticks.test.ts)). Tune your own waves until a sensible bot wins and no towers loses.
- Worker and inline stepping agree: batch sizes give the same hash as plain stepping, and coalescing snapshots does not change the sim ([host.test.ts](../../apps/swarm-siege/test/host.test.ts)).
- Frame rate on the largest wave stays steady. The demo ships a bench script (see its README); capture and measure your own.
