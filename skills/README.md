# Skills

Plain-markdown playbooks (`skills/<name>/SKILL.md`) that help a coding agent build a good game with this engine on the first try. Each is a short checklist that links to the engine docs for the details.

Start with `make-a-game`: it runs the others in order.

| Skill                | One line                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `make-a-game`        | Entry point: interview, brief, scaffold, build, game feel, art pass, complete loop, verify. |
| `game-interview`     | Turn a vague idea into a short design brief (with a non-interactive fallback).              |
| `start-a-game`       | Scaffold a new app from the repo template and get it running.                               |
| `verify-your-work`   | Prove the game runs: tests, headless checks and screenshots.                                |
| `engine-pitfalls`    | Known traps in the engine and how to avoid them.                                            |
| `game-feel`          | Input response, feedback and juice that make it fun to play.                                |
| `art-direction`      | Pick a coherent look and keep it consistent.                                                |
| `complete-game-loop` | Title, play, win/lose, restart: a game that has an end.                                     |
| `genre-playbooks`    | Per-genre recipes for common game types.                                                    |

## First-try results

Two fresh agents on the same model got the same request ("a one-screen arena game where you bounce enemies off the edge") and the same short answers to the interview questions. One followed these skills; the other had only `AGENTS.md` and the docs.

|                                             | With skills                                             | Without skills                            |
| ------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| Runs, clean console on WebGPU               | yes                                                     | yes                                       |
| Interview and an approved-style brief       | yes (palette, key moments, assumptions)                 | no                                        |
| README with controls                        | yes                                                     | no                                        |
| Game loop                                   | title, play, pause, results (win and lose), restart     | title, play, game over, restart; no pause |
| Hit-stop on impacts                         | yes                                                     | no                                        |
| Test files                                  | four                                                    | two                                       |
| Captures                                    | eleven, including an animated sequence and a WebGL shot | six                                       |
| Same state hash on WebGPU and WebGL checked | yes                                                     | no                                        |

What the skilled agent still missed, and what changed because of it: it skipped looking at some captures, never loaded the WebGL fallback page, left WebGL console warnings unexplained, and its demo bot lost on most seeds. `verify-your-work` and `complete-game-loop` now make each of those an explicit check.
