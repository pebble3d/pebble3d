---
name: genre-playbooks
description: Use when a Pebble3D game request fits a known genre (racer, platformer, tower defence, physics puzzle, stealth, sandbox, arena brawler, horde action, demolition), at the build step of make-a-game, to reuse the shipped demo that already does that genre well.
---

# Genre playbooks

Each shipped demo in `apps/` is a worked answer to one genre. A playbook points you at that demo, names the systems the genre needs, the feel points that matter, and the checks that prove the genre works. It does not replace the demo: open it, read its README, and copy its structure before inventing your own.

Load this at the build step of [make-a-game](../make-a-game/SKILL.md), after [engine-pitfalls](../engine-pitfalls/SKILL.md). Polish comes later from [game-feel](../game-feel/SKILL.md) and the definition of done from [verify-your-work](../verify-your-work/SKILL.md); the playbooks only add what is specific to the genre.

## Pick the closest playbook

Read the brief (`apps/<name>/BRIEF.md`) and match the core verb, not the theme. A game about cats racing across rooftops is a platformer or a racer depending on whether the player steers a path or beats a clock.

| The player mainly...                                        | Playbook                            | Demo to study                               |
| ----------------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| Steers a vehicle against a clock or a ghost                 | [racer](racer.md)                   | [drift-drone](../../apps/drift-drone)       |
| Runs and jumps across platforms                             | [platformer](platformer.md)         | [skyrun](../../apps/skyrun)                 |
| Places defences and watches waves hit them                  | [tower defence](tower-defence.md)   | [swarm-siege](../../apps/swarm-siege)       |
| Sets up parts, then runs a machine                          | [physics puzzle](physics-puzzle.md) | [chain-reaction](../../apps/chain-reaction) |
| Sneaks past watchers to a goal                              | [stealth](stealth.md)               | [lanternfall](../../apps/lanternfall)       |
| Builds and edits freely with physics                        | [sandbox](sandbox.md)               | [pebble-garden](../../apps/pebble-garden)   |
| Shoves rivals in a shared arena (local multiplayer or bots) | [arena brawler](arena-brawler.md)   | [ringout](../../apps/ringout)               |
| Fights a crowd of melee enemies in waves                    | [horde action](horde-action.md)     | [katana-defense](../../apps/katana-defense) |
| Breaks structures with projectiles                          | [demolition](demolition.md)         | [breakpoint](../../apps/breakpoint)         |

Games often blend two genres. Pick the one that owns the core verb as the base and borrow single systems from the second (for example, a racer with a tower-defence-style upgrade screen).

## When none fits

There is no playbook for fighters, online multiplayer or any genre without a shipped demo. Do not invent one. Use the nearest playbook for structure and the cookbook in [docs/cookbook/](../../docs/cookbook/README.md) for single techniques, and say so: add a line to the assumptions in `BRIEF.md` such as "No playbook for this genre; built on the arena-brawler structure". Tell the developer in your first progress message too.

## How to use a playbook

1. Read the demo README end to end, then the cited source files.
2. Copy the sim/presentation split. The sim is deterministic and seeded; the view only reads it. Every playbook assumes this.
3. Build the genre's core systems first and cover them with sim tests before any art.
4. Before the feel pass, run the genre-specific checks in the playbook. They are in addition to the checks in [verify-your-work](../verify-your-work/SKILL.md), not instead of them.
