# Copilot instructions

This repo's rules for coding agents are in [AGENTS.md](../AGENTS.md). Read it before you change anything, and follow its "Before you finish" checklist.

- Scenes are JSON validated by `packages/sdk/scene.schema.json`; every field is in `docs/scene-reference.md`.
- Engine changes are opt-in with defaults unchanged. The determinism hash must stay `2d76d9927e780425`.
- No `Math.random` or `Date` in sim code; no per-frame allocation in hot paths.
- Verify with `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm shot` for anything visual (it needs a real GPU).
- Docs index: `llms.txt`. Recipes: `docs/cookbook/`.
