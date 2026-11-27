# Demolition

The player fires projectiles at a structure and is scored on what falls. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Breakpoint](../../../apps/breakpoint/README.md), a siege-cannon game over generated stone structures.

- [levels.ts](../../../apps/breakpoint/src/game/levels.ts): sites generated from a seed.
- [blocks.ts](../../../apps/breakpoint/src/game/blocks.ts): stone block layout and mass.
- [session.ts](../../../apps/breakpoint/src/game/session.ts): shots, scoring and the report.
- [impacts.ts](../../../apps/breakpoint/src/game/view/impacts.ts): impact effects derived from physics state.
- [host.ts](../../../apps/breakpoint/src/game/host.ts): the sim in a worker, mirrored on the main thread.

## Core systems

- A seeded structure builder that lays interlocking courses with small gaps, so collapses look believable and stay stable until hit.
- A projectile launcher with aim preview, a charge meter and a limited shot count.
- A score from a measurable rule: mass moved past a visible line, so the player can see the target.
- The sim in a worker with the main thread rendering interpolated body states, because collapses wake many bodies.
- Sleeping bodies by default; only touched bodies run.
- Replay from the fire tick of the best shot.

## Feel points

- Impact feedback comes from physics state alone: a body whose speed drops sharply has hit something, so spawn dust, chips, shake and a knock sound.
- Charge needs a rising whine and a visible meter; release needs recoil and a muzzle burst.
- Slow the camera to follow the first impact, then return it for the collapse.
- A collapse rumble that scales with the number of moving bodies sells the weight.
- Show the aim arc, and turn it red when the shot cannot reach.

## Verification

- Level generation is deterministic per seed and differs across seeds, every level has the expected block counts, and no two blocks interpenetrate or sit below the ground ([levels.test.ts](../../../apps/breakpoint/test/levels.test.ts)).
- Shots: a demo run reaches the end with a score deterministically, a rebuilt site fed the same shots reproduces every shot's end hash, and the replay keeper replays the best shot bit-identically ([session.test.ts](../../../apps/breakpoint/test/session.test.ts)).
- Aim: the low arc passes through the target ([aim.test.ts](../../../apps/breakpoint/test/aim.test.ts)), and picking hits a block's face, else the ground, else nothing ([pick.test.ts](../../../apps/breakpoint/test/pick.test.ts)).
- Not tested in the demo, so write them for your own sites: every structure stands still before the first shot (no body moves while settling), and each site can be cleared within the shot limit (for example, a headless search for shots that clear it).
- Frame rate during the biggest collapse: capture it and read the numbers.
