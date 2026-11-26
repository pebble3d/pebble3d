# Verification

How to prove a change works: screenshots with `pnpm shot`, determinism hashes, demo bots, fps benches and the console-error policy.

## `pnpm shot`

```bash
pnpm shot --scene showcase --cam hero --backend webgpu --overlay
pnpm shot --app rockfall --param demo=1 --param seed=7 --ticks 900 --out artifacts/check --name rockfall-900
```

It builds the app (default the playground), serves it with `vite preview` on a free port, opens it in Chromium in fixed-tick mode (`?mode=fixed&ticks=<n>`) and waits for `window.__pebble3d.done`. Output: `artifacts/shots/<scene>-<cam>-<backend>-<w>x<h>.png` plus a `.json` sidecar with `adapterInfo`, `stats`, `stateHash`, `tick`, `game` (the app's `__pebble3d.game` probes, when present) and `console`. Source: `scripts/shot/shot.mjs`. Needs a Chromium for Playwright once: `pnpm exec playwright install chromium`.

| Flag                                          | Meaning                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--scene <name>`                              | A file in `apps/playground/scenes/`. Required for the playground (the default app); optional with `--app`.                                                                                                                                                               |
| `--cam <preset>`                              | A camera preset, or `controller`. Default: the renderer's (`hero`, else the first preset).                                                                                                                                                                               |
| `--backend webgpu\|webgl`                     | Default `webgpu`. Fails if that backend is not the one that ran.                                                                                                                                                                                                         |
| `--size WxH` / `--resize WxH`                 | Viewport size (default 1280x720) / resize after load (not with `--sequence`).                                                                                                                                                                                            |
| `--ticks <n>`                                 | Sim ticks to run before capture (default 120).                                                                                                                                                                                                                           |
| `--script <name>`                             | Scripted player input: `walk-forward`, `walk-into-crates`, `walk-to-bounds`, `walk-side`, `sprint-side`, `jump`, `jump-side` (see `SCRIPTS` in `apps/playground/src/main.ts`).                                                                                           |
| `--sequence <n>[:<every>]`                    | Capture `n` frames, one every `<every>` ticks (default 1), from tick `--ticks`: `<name>-f000.png`... plus `<name>.webp`, an animated WebP (30 fps for every=1, else real time). `--fps <n>` / `--scale <f>` / `--no-frames` override the rate, downscale, drop the PNGs. |
| `--overlay`                                   | Show the stats overlay in the shot.                                                                                                                                                                                                                                      |
| `--splat <url>` / `--debug splatOnly`         | Override the splat / draw only the splat.                                                                                                                                                                                                                                |
| `--allow-console-error "<substring>[:count]"` | Permit an expected console error, optionally with an exact count.                                                                                                                                                                                                        |
| `--no-build` / `--headed`                     | Skip the build / show the browser.                                                                                                                                                                                                                                       |
| `--app <dir>` / `--param key=value`           | Capture another app under `apps/` (then `--scene` is optional) / pass extra URL params.                                                                                                                                                                                  |
| `--out <dir>` / `--name <basename>`           | Output directory (inside `artifacts/`) / file basename.                                                                                                                                                                                                                  |
| `--timeout <s>` / `--port <n>`                | Per-wait timeout (default 60) / serve the preview on a fixed port.                                                                                                                                                                                                       |

Exit 1 when:

| Condition | Typical fix |
| --- | --- |
| The requested backend is not the one that ran | WebGPU unavailable: see [troubleshooting.md](troubleshooting.md#backendunavailable-webgpu). |
| The adapter is SwiftShader or a fallback adapter (after one headed retry) | Real GPU needed; see [troubleshooting.md](troubleshooting.md#shot-refuses-a-swiftshader-adapter). |
| A console warning or error matches neither the allowlist nor `--allow-console-error` | Fix the cause; allowlist only benign lines. |
| An `--allow-console-error` count is not met exactly | Adjust the count. |
| Any uncaught page error | Always fails; cannot be allowlisted. |
| A wait (load, `__pebble3d.done`, each sequence frame) exceeds `--timeout` | The app ignores `mode`/`ticks`, or `main()` threw: read `__pebble3d.error` in the console tail. |

Always open the PNG and look at it; exit 0 only means nothing errored.

### Console-error policy

- Every capture must exit 0 with an empty `console` array in its sidecar. The showcase games' `bench/capture-final.sh` scripts stop on the first failure.
- `scripts/shot/console-allowlist.json` holds benign lines, each with a `pattern`, an optional `type` and a `justification`. It currently lists only Vite HMR `debug` lines, which are never checked.
- A one-off expected error goes on the command line: `--allow-console-error "GltfLoadError:1"`.
- Only `error` and `warning` messages are checked. `console.info` (for example the playground's "WebGPU unavailable, using the WebGL backend") passes.

## Determinism

The engine's `deterministic` build gives a bit-identical state hash across runs and between Node and Chromium (V8). The `fast` build is deterministic only for the same binary on the same machine.

| Check | Command | Pass |
| --- | --- | --- |
| Engine fixture in Node | `node --experimental-strip-types packages/sdk/test/determinism.mjs --expect "$(cat packages/sdk/test/fixtures/det-hash.txt)"` | Prints `{"hash":"2d76d9927e780425"}`, exit 0 |
| Same scene in the browser | `pnpm shot --scene det --cam hero --backend webgpu --ticks 1000` | Sidecar below |
| Browser equals Node | `node -e "const s=require('./artifacts/shots/det-hero-webgpu-1280x720.json'); const h=require('fs').readFileSync('packages/sdk/test/fixtures/det-hash.txt','utf8').trim(); process.exit(s.stateHash===h && s.tick===1000 ? 0 : 1)"` | Exit 0 |
| Chain Reaction levels in Node | `pnpm --filter chain-reaction verify` | `all 6 verified` |
| Chain Reaction, browser vs Node | `node apps/chain-reaction/bench/agree.mjs` | Exit 0 (prints `browser and Node agree on all N levels`) |
| Game sims in Node | `npx vitest run --project rockfall` (also `ghostline`, `breakpoint`, `chain-reaction`) | Determinism tests load the real wasm, for example `apps/rockfall/test/helpers.ts` (`nodeFactory`) and `apps/ghostline/test/determinism.test.ts` |
| An app capture repeats | Run the same `pnpm shot --app ... --ticks <n>` twice | Same `stateHash` both times |

Write your own game-sim determinism test the way `apps/rockfall/test/sim.test.ts` does: load the det wasm bytes with `loadSim("deterministic", bytes)`, run the same seed and input log twice, compare `world.stateHash()`, then change one input and expect a different hash.

## Demo bots

Every showcase game has a `?demo=1` autoplayer that plays the full loop with the same input type a player produces. Captures, fps benches and smoke tests drive it.

| App | Bot | Useful params with `demo=1` |
| --- | --- | --- |
| `katana-defense` | `apps/katana-defense/src/game/bot.ts` | `demoWaves=<n>`, `wave=<n>`, `seed=<n>` |
| `breakpoint` | `apps/breakpoint/src/game/bot.ts` | `level=<n>` (0-based), `seed=<n>` |
| `ghostline` | `apps/ghostline/src/game/bot.ts` | `course=sunfold\|lacquer\|undertow`, `bot=fast\|par\|slow` |
| `field-notes` | `apps/field-notes/src/game/bot.ts` | `site=yard\|courtyard`, `seed=<n>` |
| `rockfall` | `apps/rockfall/src/game/bot.ts` | `demoWaves=<n>`, `wave=<n>`, `rubble=<n>`, `god=1` |
| `chain-reaction` | `apps/chain-reaction/src/demo.ts` | `level=<n>` (1-based) |
| `lanternfall` | `apps/lanternfall/src/game/bot.ts` | `seed=<n>` (without it the bot tours keeps), `guards=<n>` |
| `ringout` | `apps/ringout/src/game/bot.ts` | `seats=bot,bot,bot,bot`, `bestOf=3\|5\|7`, `seed=<n>` |
| `skyrun` | `apps/skyrun/src/game/bot.ts` | `course=dawnsteps\|gale-spires`, `bot=fast\|steady`, `runner=human\|robot` |
| `pebble-garden` | `apps/pebble-garden/src/demo.ts` | builds, plays, rewinds and exports a contraption |
| `swarm-siege` | `apps/swarm-siege/src/game/bot.ts` | `wave=<n>`, `gold=<n>`, `seed=<n>` |
| `drift-drone` | `apps/drift-drone/src/game/bot.ts` | `track=hall-circuit\|needle-and-eaves`, `cam=chase\|fpv` |

In a shot: `pnpm shot --app rockfall --param demo=1 --ticks 900`. Each app's URL params are documented at the top of its `src/main.ts`.

## Benches and capture scripts

Each fps bench serves the built app with `vite preview`, opens `?demo=1` in realtime and samples `requestAnimationFrame` intervals. Build first: `pnpm --filter <app> build`.

| App | fps bench | Capture script (writes) |
| --- | --- | --- |
| `katana-defense` | `node apps/katana-defense/bench/fps.mjs [seconds=25]` | `bash apps/katana-defense/bench/capture-final.sh` (`artifacts/game/final/`) |
| `breakpoint` | `node apps/breakpoint/bench/fps.mjs [seconds=60] [level=0]` | `bash apps/breakpoint/bench/capture-final.sh` (`artifacts/games/breakpoint/`) |
| `ghostline` | `node apps/ghostline/bench/fps.mjs [course=sunfold] [seconds=20]` | `bash apps/ghostline/bench/capture-final.sh` (`artifacts/games/ghostline/`) |
| `field-notes` | `node apps/field-notes/bench/fps.mjs [seconds=30] [extra query]` | `bash apps/field-notes/bench/capture-final.sh` (`artifacts/games/field-notes/`) |
| `rockfall` | `node apps/rockfall/bench/fps.mjs [seconds=20] [full\|empty]` | `bash apps/rockfall/bench/capture-final.sh` (`artifacts/games/rockfall/`) |
| `chain-reaction` | `node apps/chain-reaction/bench/fps.mjs [seconds=30]` | `bash apps/chain-reaction/bench/capture-final.sh` (`artifacts/games/chain-reaction/`) |

| Setting | Effect |
| --- | --- |
| `BENCH_VSYNC=1` | Measure under the 60 Hz cap (default uncapped). All benches except rockfall. |
| `BENCH_UNCAPPED=1` | Rockfall only: its default is capped; this measures headroom. |
| Capture script argument | `bash apps/<app>/bench/capture-final.sh <name>` re-shoots one capture. |

Measure fps on an idle GPU. During the parallel game builds, other processes kept the GPU 55-100% busy and benches reported 20-50 fps for games that hold 60 fps on a quiet machine. Check `/sys/class/drm/*/gpu_busy_percent` (Linux, AMD) before trusting a number.

Headless (Node) benches:

| Command | Measures |
| --- | --- |
| `node --experimental-strip-types packages/sdk/test/bench.mjs` | Engine ticks per second, both builds, 100 and 500 bodies. |
| `pnpm --filter rockfall bench` | Bodies sustained per build within the tick budget. |
| `pnpm --filter breakpoint bench:physics` | ms per tick for every level after the first shot. |
| `pnpm --filter katana-defense bench:kcc` | Engine character controllers vs the game's JS kinematic path, 40 zombies. |

Smoke tests with real input: `node apps/ghostline/bench/smoke.mjs`, `node apps/field-notes/bench/live-smoke.mjs` (after a build).

## Test suites

| Command | Covers |
| --- | --- |
| `pnpm test` | Every vitest project listed in the root `vitest.config.ts` `projects`: sdk, renderer, every game, `scripts` (asset build, docs drift guards). A new app's tests run only after you add it there ([getting-started.md](getting-started.md#tests-in-node)). |
| `npx vitest run --project scripts scripts/docs` | Docs: generated files current, scene JSON examples valid, relative links resolve. |
| `pnpm typecheck` / `pnpm lint` | tsc in every package / biome. |
| `cargo test -p engine-core --features deterministic` and `--no-default-features --features fast` | Rust, both builds. |
