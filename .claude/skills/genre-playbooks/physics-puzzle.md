# Physics puzzle

The player arranges a few parts, presses run, and a rigid-body chain reaction decides the result. Part of [genre-playbooks](SKILL.md).

## Demo to study

[Chain Reaction](../../../apps/chain-reaction/README.md), a contraption puzzle with levels as JSON and a headless verifier.

- [level.ts](../../../apps/chain-reaction/src/puzzle/level.ts): the level schema (parts, goal, par).
- [sim.ts](../../../apps/chain-reaction/src/puzzle/sim.ts): the run simulation shared by browser and Node.
- [verify.ts](../../../apps/chain-reaction/src/cli/verify.ts): the headless solver check.
- [levels.test.ts](../../../apps/chain-reaction/test/levels.test.ts): every level proven solvable.

## Core systems

- Levels as declarative data: the fixed scenery, the parts the player may place, the goal and the par.
- A grid or snap placement with a green and red ghost preview showing where a part can go.
- Run and reset: reset keeps the player's parts so they can iterate quickly.
- A deterministic run: the same parts always give the same result, so a machine can solve the game.
- A scoring rule based on parts used, shown as stars.

## Feel points

- Iteration speed is the game: reset and re-run must take one key press.
- Each part has a distinct sound and a small motion cue when it triggers.
- The goal reacting (lights, a burst, a chime) is the payoff; spend polish here.
- Slow the last second of a success so the player sees what happened. See [game-feel](../game-feel/SKILL.md).
- Show the failure cause (ball left the board, ball stopped) instead of a bare "failed".

## Verification

- Every level has a reference solution that reaches the goal with its stored state hash, the level composes into a scene the schema accepts, and it does not solve itself with no parts ([levels.test.ts](../../../apps/chain-reaction/test/levels.test.ts)).
- Honest par: the same file checks that no single-part solution exists where par is above one.
- Determinism: a level is deterministic and independent of placement order (same file); the browser matches Node per the agreement check in the README.
- The headless verifier checks every level and fails with a non-zero exit when a candidate does not solve ([verify.ts](../../../apps/chain-reaction/src/cli/verify.ts)).
- A machine that comes to rest fails the run instead of hanging ([sim.test.ts](../../../apps/chain-reaction/test/sim.test.ts)).
- The `?demo=1` autoplayer places a solution through the same placement path the mouse uses.
