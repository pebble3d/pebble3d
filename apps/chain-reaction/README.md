# Chain Reaction

A contraption puzzle on a studio pegboard, built with Pebble3D. Each level gives you a few parts: ramps, dominoes, springs, fans and see-saws. Place them on the grid, press Run, and watch the chain play out. The goal is to get the red ball into the glowing cup using as few parts as possible.

Every run is a deterministic engine simulation. The same parts always produce the same run, down to the last bit of the engine's state hash. Because of that, a machine can solve the game without a browser.

## The engine capability it shows: AI-first levels

- **Levels are declarative JSON.**
  - Each file in `levels/*.json` holds the puzzle data: the grid, the ball, starter marbles, the goal, the inventory, par and a reference solution. It also holds a partial `@pebble3d/sdk` scene with the level's own blocks.
  - The scene is merged over `levels/base.json`, which holds the studio environment, the lights, the post-processing and one prefab per part.
  - Placed parts become prefab entities. The whole scene then goes through the SDK's zod `parseScene` and `expandScene`, like any other engine scene.
  - `level.schema.json` is the JSON Schema for the level files (`pnpm --filter chain-reaction schema`).
- **A headless verifier.** `pnpm --filter chain-reaction verify` loads the same deterministic wasm Rapier build in Node and runs each level's reference solution through the same `PuzzleSim` code the browser uses. For every level it checks that the ball reaches the goal, that the reference solution doesn't use more parts than par, and that the final engine state hash equals the `expect` hash stored in the level.
- **Browser and Node agree.** `node apps/chain-reaction/bench/agree.mjs` runs every reference solution inside headless Chromium (the real app bundle, `?agree=1`) and again in Node, then compares the hashes. All 6 levels match. In the game, the result card shows "identical to the Node verifier" when your run is the reference solution, because the hash the browser just computed equals the one Node stored.
- **An agent can author and check levels.**
  - `verify <level> --placements '<json>'` tests any candidate solution.
  - `verify --file new-level.json` checks a level that isn't in the campaign.
  - `verify --update` writes the `expect` hashes.
  - `bench/search.ts` is a small brute-force solver. It was used to design the levels and to check par: no level with par ≥ 2 has a one-part solution, and the tests re-check this.

## Run it

```bash
pnpm install && pnpm build:wasm
pnpm --filter chain-reaction dev        # http://localhost:5250/
pnpm --filter chain-reaction verify     # headless check of every level
pnpm --filter chain-reaction test       # vitest: levels, sim, CLI
```

The game uses no downloaded assets. Every part is procedural geometry, and every sound is WebAudio synthesis.

| URL                          | What you get                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/`                          | Title and level select, with level 6's machine looping behind the menu                                                        |
| `/?demo=1`                   | The autoplayer: for each level it places the reference parts one by one, runs the level, shows the result card, then moves on |
| `/?level=4`                  | Start on level 4 in the editor                                                                                                |
| `/?level=4&solution=1&run=1` | Level 4 with its reference solution placed and running                                                                        |
| `/?agree=1`                  | Runs all reference solutions in the browser at startup (read by `bench/agree.mjs`)                                            |
| `mode=fixed&ticks=N`         | One tick per frame for captures; `hud=0`, `mute=1`                                                                            |

## Controls

- **Choose a part:** click it in the tray, or press 1–5.
- **Rotate or flip a part:** R or the mouse wheel. A ramp descends left or right. A spring fires up, up-left or up-right. A fan blows left, right or up. A see-saw starts with its left or right end down.
- **Place a part:** left-click a cell. A ghost previews the part in green, or red where it can't go. Dominoes need a floor under them.
- **Remove a part:** left-click or right-click a placed part.
- **Run and reset:** Space or the Run button runs the machine. Space or Esc resets it. Reset keeps your parts.
- **Score:** stars depend on how many parts you used. At or under par you get 3, at par + 1 you get 2, and above that 1.

## The levels

| #   | Level             | Idea                                                                                                                    | Par |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- | --- |
| 1   | First Drop        | Ramps turn a fall into a roll.                                                                                          | 1   |
| 2   | Bounce House      | Chain two springs up the steps to a high cup.                                                                           | 2   |
| 3   | Crosswind         | Fans push the ball over a wall. The airflow is drawn on the board.                                                      | 2   |
| 4   | Knock-On          | A marble starts a row of dominoes. A fence stops the marble and only a toppling domino can reach the ball on its ledge. | 4   |
| 5   | Catapult          | A see-saw lobs the ball when the heavy marble lands on the high end.                                                    | 1   |
| 6   | Grand Contraption | Get over a pillar and up onto a tower using wind, ramps and springs.                                                    | 2   |

Captures come from `bash apps/chain-reaction/bench/capture-final.sh` (fixed tick).

## Known issues

- **Physics, not rules.** Parts are real rigid bodies, so solutions other than the reference exist. Par is set to the best solution the brute-force search found for small part counts; that isn't a proof of optimality.
- **The see-saw has no hinge.** It's a dynamic plank resting on a static wedge with high friction. The engine has no joints. A violent hit can make the plank slide along the wedge.
- **Spring and fan behaviour is gameplay code.** It applies impulses through `World.applyImpulse` before each tick. A spring sets the launch velocity exactly, whatever speed the ball lands with, and spins don't carry over.
- **Hover and placement are tested by hand only.** The captures come from the autoplayer, which uses the same `place()` path the mouse does.
- **Audio** is synthesised and starts on the first click or key.
