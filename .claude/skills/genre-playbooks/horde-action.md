# Horde action

A player fighter with a combo moveset holds a position against waves of enemies. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Ronin Outpost](../../../apps/katana-defense/README.md) (the app folder is `katana-defense`), a katana horde defence.

- [present.ts](../../../apps/katana-defense/src/game/present.ts): every sim event becomes feedback.
- [combo.ts](../../../apps/katana-defense/src/game/combat/combo.ts): the combo chain and input buffering.
- [hitbox.ts](../../../apps/katana-defense/src/game/combat/hitbox.ts): allocation-free arc, circle and line overlap tests against circular targets.
- [moves.ts](../../../apps/katana-defense/src/game/combat/moves.ts): the validated move list, with hit windows and invulnerable frames per move.
- [director.ts](../../../apps/katana-defense/src/game/waves/director.ts): wave pacing from data.
- [brain.ts](../../../apps/katana-defense/src/game/ai/brain.ts): enemy behaviour per archetype.

## Core systems

- A move table as data: each attack has frame windows (hit window, cancels, invulnerable frames), damage and reach.
- A combo state machine with input buffering, so a press during recovery still counts.
- Hitboxes tested in the sim, never read from animation.
- Enemy archetypes (fast, slow, heavy) with different telegraphs, so the player has something to read.
- A wave director that raises pressure over time and pauses for upgrades.
- Upgrades chosen between waves, so each run differs.
- Pooled enemies, because the crowd is the performance cost.

## Feel points

- This genre is feel. Layer hit-stop, impact flashes, shake, trails and decals on every landed cut, and load [game-feel](../game-feel/SKILL.md) in full.
- Telegraph every enemy attack long enough for a human to react; a faint glow is not enough in a crowd.
- Dodge and attack cancel windows should be forgiving; punish only clear mistakes.
- Corpses and blood should not pile up into noise: fade or sink them.
- A finisher move should look and sound distinct from the lights.

## Verification

- Combo timing: the buffer window, cancel windows, dodge cancels, the launcher route and the finisher ([combo.test.ts](../../../apps/katana-defense/test/combo.test.ts)).
- Hit geometry: arc, circle and line shapes hit in front and miss behind ([hitbox.test.ts](../../../apps/katana-defense/test/hitbox.test.ts)).
- Waves: the director emits exactly the listed composition at valid spawn points, is deterministic per seed, holds groups back and respects the live-enemy cap ([waves.test.ts](../../../apps/katana-defense/test/waves.test.ts)). That each wave can actually be cleared is a check to write; the sim test only shows the bot clearing the first few.
- Determinism: the same seed and input log give the same state hash ([sim.test.ts](../../../apps/katana-defense/test/sim.test.ts)). Presentation (particles, corpses) is allowed to differ.
- Crowd frame rate on the final wave: capture it and measure; do not assume.
