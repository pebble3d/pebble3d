# AGENTS.md

Working rules for coding agents in the Pebble3D repo: where things are, the commands, the invariants you must not break, and what to run before you finish.

Pebble3D is a browser 3D engine: JSON scenes validated by a zod schema, rendered by three.js 0.187 (WebGPU, WebGL fallback), simulated by Rapier compiled from Rust to WebAssembly. New here? Read [docs/getting-started.md](docs/getting-started.md) first.

## Repo map

| Path                                         | What it is                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/engine-core`                         | Rust Rapier world compiled to wasm (`World`): spawn, step, state buffers, raycast, body control, state hash. Two builds: `deterministic` (default) and `fast` (SIMD).            |
| `packages/sdk`                               | `@pebble3d/sdk`: scene schema (`src/schema.ts`), `expandScene`, `loadSim`/`StateViews`, `FixedStepLoop`, `createGame`. Prebuilt wasm lands in `packages/sdk/wasm/` (gitignored). |
| `packages/renderer`                          | `@pebble3d/renderer`: `createRenderer`, PBR/toon pipeline, splats, glTF, characters, camera controllers.                                                                         |
| `packages/studio-overlay`                    | `@pebble3d/studio-overlay`: the stats overlay (`mountOverlay`), toggled with the backtick key.                                                                                   |
| `packages/mcp-server`                        | Placeholder, not implemented.                                                                                                                                                    |
| `apps/playground`                            | Loads any scene in `apps/playground/scenes/` via `/?scene=<name>`; owns `public/assets/` that every app serves.                                                                  |
| `apps/katana-defense`                        | Ronin Outpost (port 5180): toon horde defence, skinned crowds, IK.                                                                                                               |
| `apps/breakpoint`                            | Breakpoint (5210): physics demolition, sim in a Web Worker, `fast` build.                                                                                                        |
| `apps/ghostline`                             | Ghostline (5220): marble time trials, ghosts re-simulated from inputs.                                                                                                           |
| `apps/field-notes`                           | Field Notes (5231): photography in Gaussian-splat captures, depth of field.                                                                                                      |
| `apps/rockfall`                              | Rockfall (5240): survival under spawner-driven rock waves; boots renderer and sim itself.                                                                                        |
| `apps/chain-reaction`                        | Chain Reaction (5250): JSON-level puzzle, headless Node verifier.                                                                                                                |
| `scripts/shot`                               | `pnpm shot`: build, serve, render in Chromium, write PNG + JSON sidecar.                                                                                                         |
| `scripts/docs`                               | `pnpm docs:gen`: regenerates the reference docs and `llms-full.txt`; drift-guard tests.                                                                                          |
| `scripts/fetch-assets.mjs`, `scripts/assets` | Download and derive large assets per `apps/playground/assets.manifest.json`.                                                                                                     |
| `scripts/build-wasm.sh`                      | `pnpm build:wasm`: builds both wasm flavours with `wasm-bindgen-cli` 0.2.130.                                                                                                    |

## Commands

| Task                                               | Command                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Install                                            | `pnpm i`                                                                                                                      |
| Build wasm (after any Rust change or merge)        | `pnpm build:wasm`                                                                                                             |
| Fetch assets (HDRI, splats, avatars)               | `pnpm fetch-assets`                                                                                                           |
| Playground dev server (port 5173)                  | `pnpm dev`, then `/?scene=showcase`                                                                                           |
| One app's dev server                               | `pnpm --filter <app> dev` (for example `pnpm --filter rockfall dev`)                                                          |
| All TS tests                                       | `pnpm test` (root vitest, every project) or `pnpm -r test`                                                                    |
| One project's tests                                | `npx vitest run --project rockfall` (a project must be listed in the root `vitest.config.ts`)                                 |
| Typecheck                                          | `pnpm typecheck`                                                                                                              |
| Lint (biome)                                       | `pnpm lint`; auto-fix with `npx biome check --write <paths>` (never `--unsafe` on CSS: it deletes `!important`)               |
| Rust tests, both builds                            | `cargo test -p engine-core --features deterministic` and `cargo test -p engine-core --no-default-features --features fast`    |
| Determinism (Node)                                 | `node --experimental-strip-types packages/sdk/test/determinism.mjs --expect "$(cat packages/sdk/test/fixtures/det-hash.txt)"` |
| Screenshot                                         | `pnpm shot --scene showcase --cam hero` or `pnpm shot --app rockfall --param demo=1 --ticks 600`                              |
| Regenerate docs                                    | `pnpm docs:gen` (not `pnpm docs`, which is a pnpm builtin); `pnpm docs:gen --check` exits 1 if stale                          |
| Regenerate `scene.schema.json` after a schema edit | `pnpm --filter @pebble3d/sdk schema`                                                                                          |
| Chain Reaction headless verify                     | `pnpm --filter chain-reaction verify`                                                                                         |

Details: [docs/verification.md](docs/verification.md).

## Adding a new app

1. `apps/<name>/package.json` (scripts `dev`, `build`, `test: "vitest run"`, `typecheck`; deps `@pebble3d/sdk`, `@pebble3d/renderer` as `workspace:*`, `three` 0.187.0), `index.html` with `<link rel="icon" href="/favicon.svg">`.
2. Copy `apps/rockfall/vite.config.ts` and `apps/rockfall/tsconfig.json` unchanged.
3. Register its tests, or they never run: `apps/<name>/vitest.config.ts` with `defineProject({ test: { name: "<name>", include: ["test/**/*.test.ts"] } })`, **and** an `"apps/<name>"` entry in the root `vitest.config.ts` `projects` list.
4. `pnpm i`, then `npx vitest run --project <name>`.
5. Node tests that must match the browser use the browser's tick order: with `createGame`, `world.step(1)` then the rules each tick.

Walkthrough with every file: [docs/getting-started.md](docs/getting-started.md#3-a-minimal-game-app).

## Invariants

- The determinism hash is `2d76d9927e780425`, from `packages/sdk/test/fixtures/det-hash.txt`.
- No `Math.random` or `Date` in sim paths.
- No per-frame allocation in hot paths.
- Engine changes must be opt-in, with defaults unchanged.
- Run `pnpm build:wasm` after any Rust change or merge.
- `pnpm shot --out` must be inside `artifacts/`.
- Linux Chromium needs `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`.

What they mean in practice:

| Rule                    | How the repo does it                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Determinism             | Sims draw randomness from a seeded generator (`apps/rockfall/src/game/rng.ts`). A random seed may be picked at boot outside the sim (`apps/rockfall/src/main.ts` uses `Date.now()` only in realtime mode; fixed mode uses seed 7). Never use `--write` on `determinism.mjs` to "fix" a mismatch.                                                                                                         |
| No per-frame allocation | Preallocate and reuse: event rings (`apps/chain-reaction/src/puzzle/sim.ts`), scratch reads via `game.views.scratch`. `world.bodyCounts()`, `world.transformOf()`, `__pebble3d.player()` and `position()` allocate: stats or debug only.                                                                                                                                                                 |
| Opt-in engine changes   | New features default off (`post.style` defaults to `"pbr"`, `fixInternalEdges` defaults to false, `renderer.dof` starts disabled). The determinism hash and existing scenes must not change.                                                                                                                                                                                                             |
| Stale wasm              | `packages/sdk/wasm/` is gitignored, so a pull or merge never updates it. See [docs/troubleshooting.md](docs/troubleshooting.md).                                                                                                                                                                                                                                                                         |
| Assets                  | Large files are not committed. Add them to `apps/playground/assets.manifest.json` with a sha256 and licence, then `pnpm fetch-assets` (it regenerates `apps/playground/public/assets/LICENSES.md`). Only licences that allow commercial use (CC0, CC BY, MIT); CC BY-NC captures were rejected. Apps serve the playground's `public/` via `publicDir: "../playground/public"` in their `vite.config.ts`. |

## Before you finish

- [ ] `pnpm test` passes (and `cargo test` for both builds if you touched Rust).
- [ ] `pnpm typecheck` and `pnpm lint` are clean.
- [ ] The determinism script still prints `2d76d9927e780425`.
- [ ] Rust changed: `pnpm build:wasm` ran, and the change is opt-in.
- [ ] Schema changed: `pnpm --filter @pebble3d/sdk schema` and `pnpm docs:gen` ran, and their output is committed.
- [ ] Rendering changed: a `pnpm shot` exits 0 with an empty console, and you looked at the PNG.
- [ ] Game changed: its `?demo=1` bot still plays a full loop, and its `bench/capture-final.sh` still exits 0.
- [ ] No `Math.random`/`Date` added to a sim, no allocation added to a per-frame path.

## Docs

| Page                                               | Use it for                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| [docs/getting-started.md](docs/getting-started.md) | A first scene, then a minimal game app.                                     |
| [docs/scene-reference.md](docs/scene-reference.md) | Every scene JSON field (generated).                                         |
| [docs/api-reference.md](docs/api-reference.md)     | `@pebble3d/sdk`, `@pebble3d/renderer` and wasm `World` members (generated). |
| [docs/verification.md](docs/verification.md)       | `pnpm shot`, determinism checks, demo bots, fps benches.                    |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Error message or symptom, cause, fix.                                       |
