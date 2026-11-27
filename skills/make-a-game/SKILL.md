---
name: make-a-game
description: Use when a developer asks for a game, a game prototype or a playable demo built with Pebble3D (for example "make me a game where...", "build a racing game", "prototype this idea"). Start here before writing any game code.
---

# Make a game

The front door for every game request in this repo. It fixes the order of work and the check that ends each step. The other skills hold the how; this one holds the sequence. Follow it in order and do not skip ahead to code.

Assumptions: you are in a clone of the Pebble3D monorepo, the game becomes a new app in `apps/<name>/` like the demos in `apps/`, and the repo is set up (`pnpm i && pnpm build:wasm`, see [docs/getting-started.md](../../docs/getting-started.md)). The working rules for the repo are in [AGENTS.md](../../AGENTS.md).

## The sequence

interview → brief → scaffold → build → game feel → art pass → complete loop → verify

| Step          | Load                                                                                                                      | Exit check before moving on                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interview     | [game-interview](../game-interview/SKILL.md)                                                                              | Every open question is answered, defaulted, or written down as an assumption.                                                                     |
| Brief         | [game-interview](../game-interview/SKILL.md) (its last section)                                                           | `apps/<name>/BRIEF.md` exists and the developer said yes to it (or, non-interactive, its assumptions are marked).                                 |
| Scaffold      | [start-a-game](../start-a-game/SKILL.md)                                                                                  | `pnpm --filter <name> dev` serves the scene, the first capture shows it (not black), zero console errors, `npx vitest run --project <name>` runs. |
| Build         | [engine-pitfalls](../engine-pitfalls/SKILL.md), then [genre-playbooks](../genre-playbooks/SKILL.md) for the closest genre | The core verbs from the brief work with the keyboard, the `?demo=1` bot performs them, and sim tests pass.                                        |
| Game feel     | [game-feel](../game-feel/SKILL.md)                                                                                        | Every player action has visible and audible feedback; a capture sequence shows it.                                                                |
| Art pass      | [art-direction](../art-direction/SKILL.md)                                                                                | Captures match the "look" section of the brief; palette, lighting and post are one committed style, not defaults.                                 |
| Complete loop | [complete-game-loop](../complete-game-loop/SKILL.md)                                                                      | Title → play → win or lose → results → restart works by keyboard and by the `?demo=1` bot; README lists controls and URL params.                  |
| Verify        | [verify-your-work](../verify-your-work/SKILL.md)                                                                          | Everything in that skill passes. **`verify-your-work` defines done; never report done without it.**                                               |

Load [verify-your-work](../verify-your-work/SKILL.md) early too: run its quick checks (a capture, the console, the tests) at the end of every step from scaffold on, not only at the end. A step whose capture you have not looked at is not finished.

Load [engine-pitfalls](../engine-pitfalls/SKILL.md) whenever something renders black, throws, times out in a capture, or behaves differently in Node and the browser. Look up the symptom there and in [docs/troubleshooting.md](../../docs/troubleshooting.md) before debugging from scratch.

## What the developer may skip

The developer decides; you do not skip on their behalf.

- **Interview**: "just build it", or a request that already answers what the player does, the look, controls, players and scope. You still write `BRIEF.md`, with the defaults listed under assumptions, and show it.
- **Developer approval of the brief**: only when they said not to wait. Then proceed on the assumptions and say so in your first progress message.
- **Game feel, art pass**: only for an explicitly throwaway prototype ("just the mechanic, grey boxes are fine"). Record the skip in `BRIEF.md` under out of scope.
- **Complete loop**: the same rule; a mechanic test may stop at "play". Keep the `?demo=1` bot anyway, because verification drives it.
- **Never skippable**: scaffold, build, and verify. A game that was not captured, looked at and tested is not delivered.

If the developer changes direction mid-way, update `BRIEF.md` first, then continue from the earliest step the change affects.

## Working habits

- One step at a time. Finish its exit check, tell the developer in one or two lines what now works, then load the next skill.
- Show, do not describe: when a step changes what is on screen, share the capture with the progress message.
- Study before inventing. The demos in `apps/` solve most problems a new game hits; [docs/examples.md](../../docs/examples.md) lists what each one shows, and the cookbook in [docs/cookbook/](../../docs/cookbook/README.md) has the recipes.
- Keep the repo invariants from [AGENTS.md](../../AGENTS.md): seeded randomness only in the sim (no `Math.random` or `Date`), no per-frame allocation, no engine changes. If the game needs an engine feature, tell the developer instead of editing `packages/` or `crates/`.
- Original work only: never name, copy or imitate an existing commercial game, its characters or its art.
- Online multiplayer is not available (the engine has no netcode). Offer local multiplayer on one keyboard or bot opponents, as `apps/ringout` does.

## Reporting done

Only after `verify-your-work` passes, report: what was built (link `BRIEF.md`), how to run it (`pnpm --filter <name> dev` and the URL), the controls, the captures you looked at, test results, and any assumption or skip still open.
