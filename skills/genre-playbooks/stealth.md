# Stealth

Sneak past watchers to reach a goal and get out, with light, sight and sound deciding what is seen. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Lanternfall](../../apps/lanternfall/README.md), a heist in a keep generated from a seed.

- [sim.ts](../../apps/lanternfall/src/game/sim.ts): vision, alert states and the heist rules.
- [generate.ts](../../apps/lanternfall/src/gen/generate.ts): a seed becomes a schema-valid scene.
- [gen.test.ts](../../apps/lanternfall/test/gen.test.ts): the seed sweep with the flood-fill reachability check.
- [present.ts](../../apps/lanternfall/src/view/present.ts): sim events become feedback.

## Core systems

- Guards with a vision cone, a sight range that depends on light, and states: patrol, suspicious, chase, search.
- Light as a mechanic: lit areas make the player visible from far, shadow only from close.
- Cover and line-of-sight blockers the sim can query.
- A goal, an exit and a clear fail state; a replay of the same seed gives the same level.
- If levels are generated, a seeded generator that never uses `Math.random`.

## Feel points

- The player must always be able to read the threat: draw vision cones or a clear detection meter that fills before the alarm.
- Three distinct sounds for unaware, suspicious and alerted guards.
- Make safe moments quiet and tense moments loud; use the audio mix, not only the picture.
- Getting caught needs a beat of slow motion and a clear reason before the fail card.
- Camera should show the next threat ahead of the player, not only the player.

## Verification

- Every seed is reachable: the test rasterises each generated keep's exported JSON with the player's clearance and flood-fills from the spawn, across the whole live seed range. The spawn must reach the relic, the exit, every room and every piece of gold ([gen.test.ts](../../apps/lanternfall/test/gen.test.ts)). Copy this pattern for any generated level.
- The same test round-trips every scene through JSON text and the schema, checks patrol nodes sit on the floor and no patrol crosses the entrance room.
- Generation is deterministic per seed and varies across seeds (same file).
- Sim: the demo bot steals the relic and escapes the default keep, the run replays bit-exactly, a guard spots a thief standing in its view, and walls block sight while light pools extend it ([sim.test.ts](../../apps/lanternfall/test/sim.test.ts)).
- The bot is only tested on one seed. Running it on several seeds is a check you should add for your own generator.
