# Cookbook

One task per page: the goal, a snippet that works, the gotchas, and the files in the repo that do it for real. JSON blocks with a `"version"` key are complete scenes (a test validates them); others are labelled fragments.

| Recipe | Use it for |
| --- | --- |
| [scene-basics.md](scene-basics.md) | A valid scene: ground, bounds, static and dynamic props, camera presets. |
| [prefabs-and-spawners.md](prefabs-and-spawners.md) | Reusable entity templates; seeded streams of spawned bodies. |
| [bodies-impulses-velocity.md](bodies-impulses-velocity.md) | Impulses, velocity, teleport, runtime spawn; reading pose and velocity. |
| [raycasts.md](raycasts.md) | Ground probes, line of sight, picking; the three filters. |
| [character-and-camera.md](character-and-camera.md) | A player character with `accel`, clips matched to speed, the third-person camera. |
| [splat-environments.md](splat-environments.md) | A Gaussian-splat capture as the level, with colliders and shadows. |
| [post-and-toon-style.md](post-and-toon-style.md) | Exposure, bloom, AO; the opt-in `post.style: "toon"`. |
| [depth-of-field.md](depth-of-field.md) | Photo-mode blur with `renderer.dof`. |
| [deterministic-game-loop.md](deterministic-game-loop.md) | Fixed-tick rules, input logs, replays and ghosts. |
| [demo-bot-and-captures.md](demo-bot-and-captures.md) | A `?demo=1` autoplayer and a reproducible capture script. |
| [instanced-crowds-and-perf.md](instanced-crowds-and-perf.md) | Instancing, crowds, workers, the `fast` build, budgets. |
| [audio-sfx.md](audio-sfx.md) | Synthesised WebAudio cues without autoplay warnings. |
| [json-levels-and-headless-verify.md](json-levels-and-headless-verify.md) | Levels as data, proven in Node with `pnpm --filter chain-reaction verify`. |
| [assets-and-licensing.md](assets-and-licensing.md) | Adding a model, HDRI or splat through the asset manifest. |

Start from [getting-started.md](../getting-started.md) if you have no app yet. API details: [api-reference.md](../api-reference.md). Feature-to-file index: [examples.md](../examples.md).
