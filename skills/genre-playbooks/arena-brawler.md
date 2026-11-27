# Arena brawler

Local multiplayer or bot rivals shoving each other in a shrinking arena. There is no online play; the engine has no netcode. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Ringout](../../apps/ringout/README.md), a sumo arena with a collapsing floor and a hash-proved replay.

- [sim.ts](../../apps/ringout/src/game/sim.ts): the fixed-step round logic.
- [match.ts](../../apps/ringout/src/game/match.ts): rounds, scoring and the end of a match.
- [bot.ts](../../apps/ringout/src/game/bot.ts): bots that fill empty seats.
- [arena.ts](../../apps/ringout/src/game/arena.ts): the arena and its collapse order.

## Core systems

- Fighters as dynamic bodies moved by impulses, with a speed cap so the drive cannot add endless speed.
- A dash with a cooldown, and a stagger on a hard hit, so contact has consequences.
- A hazard that forces action: the arena collapses so that waiting stops being safe.
- Seats: one keyboard split between two people, bots for the rest, and the same input interface for both.
- A round defined entirely by its seed and the input log, which makes replays free.
- A match wrapper: rounds, scores, a winner and a rematch.

## Feel points

- Hits need hit-stop, a camera shake scaled by impulse and a spark burst at the contact point.
- Make each fighter readable: distinct colours, a name tag and a ring on the floor under each.
- Warn before a tile drops (shake, colour) so a fall always feels fair.
- A knock-out deserves a short slow-motion beat and a stinger. See [game-feel](../game-feel/SKILL.md).
- Keep the camera framed on all living fighters at once.

## Verification

- Replay proof: re-simulating a round from its input log reproduces the live state hash exactly, and changing one input changes the hash. This is the `replay` block in [sim.test.ts](../../apps/ringout/test/sim.test.ts).
- The same file checks that the arena is a pure function of the seed, that the floor collapses ring by ring with no one driving, that a dash is a burst with a cooldown, and that bots knock each other out and decide a winner.
- Match flow: a best-of series ends when a seat reaches the wins needed (same file).
- Balance is not tested. The demo has a manual, opt-in exploration script ([explore.test.ts](../../apps/ringout/test/explore.test.ts), skipped unless the `EXPLORE` environment variable is set) that plays bot rounds and prints win counts without asserting anything; you read its output. A real balance test must assert on the win distribution across seeds.
- Two keyboard seats working at once without key ghosting is a manual check; do it on the real bindings.
