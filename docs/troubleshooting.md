# Troubleshooting

Error messages and symptoms seen while building Pebble3D and its showcase games, each with the cause and the fix.

| Symptom | Jump to |
| --- | --- |
| `BackendUnavailable: webgpu (WebGPURenderer fell back to WebGL)` | [BackendUnavailable: webgpu](#backendunavailable-webgpu) |
| Outdoor (HDRI) scene renders all black (fog on) or all white (fog off) on `--backend webgl` only | [WebGL outdoor black/white](#webgl-outdoor-scene-is-black-or-white) |
| `TypeError: world.setVelocity is not a function` (or `applyImpulse`, `linearVelocity`, ...) | [Stale wasm](#stale-wasm-setvelocity-is-not-a-function) |
| `shot: FAIL --out must be inside artifacts/` | [Shot --out rejected](#shot---out-rejected) |
| `shot: FAIL software/fallback adapter (SwiftShader) refused` | [SwiftShader adapter](#shot-refuses-a-swiftshader-adapter) |
| `determinism mismatch: expected 2d76d9927e780425, got ...` | [Determinism hash mismatch](#determinism-hash-mismatch) |
| `shot: FAIL console error not allowlisted: Failed to load resource: ... 404` | [404 in the console](#shot-fails-on-a-404) |
| Shot hangs, then times out waiting for `__pebble3d.done` | [Shot timeout](#shot-times-out-waiting-for-__pebble3ddone) |
| `TS2352: Conversion of type ... to type ... may be a mistake` on a scene import | [Scene JSON import types](#ts2352-when-passing-an-imported-scene-json) |
| fps far below 60 in a bench, or numbers that swing between runs | [GPU contention](#fps-numbers-are-low-or-noisy) |
| The game slows to a crawl under heavy physics | [Too many ticks per frame](#heavy-physics-makes-the-game-crawl) |
| `fetch-assets` reports a sha256 mismatch or a failed avatar | [Assets](#fetch-assets-hash-mismatch-or-failed-avatar) |
| `pnpm docs` does not regenerate the docs | [pnpm docs](#pnpm-docs-does-nothing-useful) |
| `scene.schema.json` test fails, or conflicts in a merge | [Schema JSON](#sceneschemajson-is-stale) |
| Two screenshots of the same tick differ by a few pixels | [Pixel noise](#two-identical-shots-differ-slightly) |
| No per-tick hook or spawn callback in `createGame` | [Custom boot](#creategame-has-no-per-tick-hook) |
| A second game on the same page misbehaves | [One game per page](#a-second-game-on-the-same-page) |
| `No projects were found ... The filter matched no projects: <app>`, or `No test files found, exiting with code 0` for a new app | [App tests not registered](#a-new-apps-tests-never-run) |
| A headless (Node) run's `stateHash` differs from the browser's at the same tick | [Headless hash differs](#headless-hash-differs-from-the-browser) |

## BackendUnavailable: webgpu

**Symptom:** `BackendUnavailable: webgpu (WebGPURenderer fell back to WebGL)` on the page, in `__pebble3d.error`, or as a `pnpm shot` failure.

**Cause:** the browser exposed no usable WebGPU adapter, so three's `WebGPURenderer` fell back to WebGL, and `createRenderer` (`packages/renderer/src/create.ts`) throws when `webgpu` was requested. On Linux, Chromium ships with WebGPU off.

**Fix:**
- Start Chromium with `chromium --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`. `pnpm shot` already passes these (plus `--ignore-gpu-blocklist`).
- Or use the WebGL fallback: `?backend=webgl` in the URL, `--backend webgl` for `pnpm shot`.
- Or opt in to the automatic fallback: `createGame({ ..., webglFallback: true })` (or `createRenderer`'s `webglFallback`), a build with `VITE_PEBBLE3D_WEBGL_FALLBACK=1`, or `?webglFallback=1` in the URL. The renderer then keeps WebGL on the same canvas and shows a small dismissible notice. It is off by default so a missing WebGPU fails loudly. The public demo builds turn it on.
- The playground falls back by itself only when no `backend` param is given (`apps/playground/src/main.ts`, `isBackendUnavailable`). Your own app must do the same if it wants a fallback, and must retry on a fresh canvas, because a canvas keeps its first context type:

```ts
const fresh = canvas.cloneNode() as HTMLCanvasElement;
canvas.replaceWith(fresh);
game = await createGame({ ...opts, canvas: fresh, backend: "webgl" });
```

## WebGL outdoor scene is black or white

**Symptom:** on the WebGL fallback (`?backend=webgl`, Firefox/Safari), an `outdoor` scene with an HDRI renders almost entirely black with fog on, or blown-out white with fog off. The sky itself may still be visible with bloom off. WebGPU, and the `studio` preset, look fine.

**Cause:** `HDRLoader` decodes to half floats, so the sun of a bright HDRI (Poly Haven's `qwantani_noon_puresky_2k.hdr`) is stored as 65504, the half-float maximum. In three 0.187 both backends run the same `PMREMGenerator` with half-float targets, but empirically only the WebGL backend's PMREM overflows to +Inf on these fp16-max peaks (the exact step is unconfirmed). Every IBL-lit fragment then shades to +Inf (white after tone mapping), the range fog's `mix` turns that into NaN (black), and bloom spreads either over the frame. Measured on WebGL with a plain clamp: 32768 renders correctly, 60000 does not.

**Fix:** handled in `loadEnvironment` (`packages/renderer/src/defaults/lighting.ts`): on WebGL only, `spreadEquirectPeaks` caps HDRI texels at `WEBGL_HDR_MAX_RADIANCE` (16384, validated on WebGL with spreading) by scattering the excess into neighbouring texels, which conserves the sun's energy, so diffuse IBL matches WebGPU. The same capped HDRI is the WebGL background, so there the sun disc in the sky and in reflections is slightly wider and its peak lower (it still tone-maps to white). Non-finite texels are clamped, not spread. WebGPU loads the HDRI unchanged. If you load your own HDRI into a PMREM on WebGL outside `loadEnvironment`, run it through `spreadEquirectPeaks` first.

## Stale wasm: setVelocity is not a function

**Symptom:** `TypeError: world.setVelocity is not a function` (or `applyImpulse`, `linearVelocity`, `applyTorqueImpulse`, `setKinematicPose`), a scene feature that silently does nothing after a merge, or the sdk test `expect(h.world.scratchLen()).toBe(SCRATCH_LEN)` failing.

**Cause:** `packages/sdk/wasm/` is gitignored. A pull, merge or branch switch updates the Rust source and the TypeScript that calls it, but not the compiled wasm, so the JS calls methods the old binary lacks. In a fresh clone or worktree the folder is missing entirely and imports of `packages/sdk/wasm/det/engine_core_det.js` fail.

**Fix:** `pnpm build:wasm` (Rust, the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.130; `scripts/build-wasm.sh` checks the version). Run it after every Rust change or merge, then restart the dev server.

## Shot --out rejected

**Symptom:** `shot: FAIL --out must be inside artifacts/`.

**Cause:** `scripts/shot/shot.mjs` resolves `--out` against the repo root and refuses any directory outside `artifacts/` (gitignored), so shots never land in source folders.

**Fix:** `--out artifacts/<something>`, for example `pnpm shot --app rockfall --param demo=1 --out artifacts/rockfall-check`. Omit `--out` for the default `artifacts/shots/`.

## Shot refuses a SwiftShader adapter

**Symptom:** `shot: headless got a software adapter; retrying headed`, then `shot: FAIL software/fallback adapter (SwiftShader) refused: {...}`.

**Cause:** Chromium ran on its CPU rasteriser (SwiftShader) or a fallback adapter instead of the GPU. Timings and some rendering paths are meaningless there, so the shot refuses it. Headless Chromium reaches the real GPU only with `--use-angle=vulkan`; with a display available the shot retries headed once.

**Fix:**
- Run on a machine with a GPU and working Vulkan drivers, from a session with `DISPLAY` or `WAYLAND_DISPLAY` set (or pass `--headed`).
- An app with its own boot must report real adapter strings on `__pebble3d.adapterInfo`, or the check cannot work. Copy `adapterInfoOf` from `packages/sdk/src/game.ts`, as `apps/rockfall/src/main.ts` does; it reads the unmasked WebGL renderer string so `--backend webgl` on SwiftShader is still caught.

## Determinism hash mismatch

**Symptom:** `determinism mismatch: expected 2d76d9927e780425, got <other>` from `packages/sdk/test/determinism.mjs`, a shot sidecar `stateHash` that differs from the fixture at tick 1000, `pnpm --filter chain-reaction verify` failing a level, or a game's Node determinism test failing.

**Cause (check in this order):**
1. Stale wasm (see above): the binary is older or newer than the source.
2. An engine change that is not opt-in: it altered a default, the spawn order, or solver settings.
3. The sim reads `Math.random`, `Date`, wall-clock `dt` or DOM state.
4. The run used the `fast` build. It is deterministic only for the same binary on the same machine; the fixture is for `deterministic`.
5. Realtime mode ran 2+ ticks in one frame while game logic ran once per frame (input applied at a different tick). Fixed mode runs exactly one tick per frame.

**Fix:** `pnpm build:wasm`, then rerun the script. If it still differs, make the change opt-in so the defaults reproduce the old state. Move randomness to a seeded generator (`apps/rockfall/src/game/rng.ts`). Never run `determinism.mjs --write` to accept a new hash unless the change is meant to alter default behaviour and that has been agreed.

## Shot fails on a 404

**Symptom:** `shot: FAIL console error not allowlisted: Failed to load resource: the server responded with a status of 404 (Not Found)`.

**Cause:** something requested a missing file. Two common ones:
- No `<link rel="icon">` in `index.html`, so the browser asks for `/favicon.ico`.
- A missing asset: `pnpm fetch-assets` was not run, or the app does not serve the playground's `public/`. Apps use `appType: "mpa"` in `vite.config.ts` so missing assets are real 404s, not a silent `index.html`.

**Fix:** add `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`; run `pnpm fetch-assets`; copy `vite.config.ts` from an existing app (`publicDir: "../playground/public"`). Rerun with `--headed` to see which URL failed in the network tab.

## Shot times out waiting for `__pebble3d.done`

**Symptom:** the shot waits for the full `--timeout` (default 60 s) and fails on `__pebble3d.done` (or `__pebble3d.ready`).

**Cause:**
- The app ignores `?mode=fixed&ticks=<n>`, so nothing sets `done`. `createGame` sets it only when it was given `mode: "fixed"` and `stopAtTick`.
- A custom boot (no `createGame`) never sets `window.__pebble3d.done`.
- `main()` threw before the first frame.

**Fix:** pass `mode` and `stopAtTick` from the URL to `createGame` ([getting-started.md](getting-started.md#srcmaints-boot-input-probes)). A custom boot sets `hook.done = true` once `tick >= stopAtTick` in fixed mode (`apps/rockfall/src/main.ts`). Catch boot errors into `window.__pebble3d.error` and `console.error` so the failure is visible.

## TS2352 when passing an imported scene JSON

**Symptom:** `error TS2352: Conversion of type '{ version: number; ... }' to type '...' may be a mistake ... Type 'number[]' is not comparable to type '[number, number, number]'.`

**Cause:** a JSON import widens `[0, 3, 8]` to `number[]`, which does not match the schema's tuple types.

**Fix:** cast through `unknown`; `createGame` validates the scene with zod at runtime anyway:

```ts
import sceneJson from "../scenes/court.json";
const scene = sceneJson as unknown as SceneInput;
```

## fps numbers are low or noisy

**Symptom:** a bench reports 20-50 fps, or results swing between runs, for a scene that should hold 60.

**Cause:** another process is using the GPU. Other GPU-heavy apps (browsers, video, builds, compositors) can drag fps well below what the scene really holds, so measure on an idle GPU.

**Fix:** check `/sys/class/drm/*/gpu_busy_percent` (Linux, AMD) before measuring, close other GPU users, and compare builds back to back in the same window. Use `BENCH_VSYNC=1` for the capped number players see ([verification.md](verification.md#benches-and-capture-scripts)).

## Heavy physics makes the game crawl

**Symptom:** with 1,000+ awake bodies each frame gets later and later, or the frame rate collapses.

**Cause:** in realtime mode `FixedStepLoop` catches up with up to 5 ticks per frame by default. When one tick costs more than a frame, each frame runs more ticks, which makes the next frame later still.

**Fix:**
- Cap catch-up: `new FixedStepLoop({ mode, maxTicksPerFrame: 2 })` (`apps/rockfall/src/main.ts`). The game slows down instead of spiralling.
- Use the `fast` build when you only need same-machine determinism: `"sim": { "build": "fast" }` halved Breakpoint's tick cost (about 26 ms to 13 ms at 1,300 awake bodies; `apps/breakpoint/scenes/site.json`).
- Move the sim to a Web Worker (`apps/breakpoint/src/game/sim.worker.ts`). Bound its message queue and pause on `visibilitychange`, or a hidden tab queues ticks without limit.

## fetch-assets hash mismatch or failed avatar

**Symptom:** `pnpm fetch-assets` prints `<url>: sha256 mismatch (expected ..., got ...)`, or reports the human avatar `rocketbox-male-adult-16.glb` as failed.

**Cause:** the derived splat hash was verified on one machine only. The avatar build needs the pinned KTX-Software binary, which is linux-x64 only.

**Fix:** for the avatar on other platforms, use `/?scene=showcase-robot`. For a hash mismatch, check the source download first; `node scripts/fetch-assets.mjs --update-hashes` rewrites hashes in the manifest, so use it only for assets you are adding.

## `pnpm docs` does nothing useful

**Symptom:** `pnpm docs` does not regenerate `docs/`.

**Cause:** `docs` is a pnpm builtin command, which shadows a script of that name.

**Fix:** `pnpm docs:gen`. `pnpm docs:gen --check` exits 1 when generated files are stale.

## scene.schema.json is stale

**Symptom:** the sdk test `scene-schema-json.test.ts` fails, the docs drift test reports `generated docs are current` failing, or two branches conflict in `packages/sdk/scene.schema.json`.

**Cause:** `packages/sdk/scene.schema.json` and `docs/scene-reference.md` are generated from `packages/sdk/src/schema.ts`.

**Fix:** never hand-merge them. Resolve `schema.ts`, then `pnpm --filter @pebble3d/sdk schema && pnpm docs:gen`.

## Two identical shots differ slightly

**Symptom:** two captures of the same tick are not byte-identical.

**Cause:** GPU rasterisation noise. Two runs of identical code measured 36 px over a 2% fuzz at about 53 dB PSNR on the showcase scene; screenshots repeat to RMSE < 0.002, not byte for byte.

**Fix:** compare `stateHash` and `tick` in the sidecars for logic, and a fuzzy image diff against a measured noise floor for rendering.

## createGame has no per-tick hook

**Symptom:** you need code to run exactly once per sim tick, or to see bodies that spawners created at runtime, and `createGame` offers only `onFrame`.

**Cause:** `createGame` steps the world itself and consumes `drainSpawned()` for the scene's spawners. There is no `onTick` or `onSpawned` callback yet.

**Fix:** for light rules, advance your own sim inside `onFrame` until it reaches `world.tick()` ([getting-started.md](getting-started.md#3-a-minimal-game-app)). For full control, boot like `apps/rockfall/src/main.ts`: `createRenderer` + `loadSim` + `FixedStepLoop`, your own `sim.step(input)` per tick, and your own `window.__pebble3d` hook. Or keep `createGame` for rendering and run your sim in separate worlds from the same wasm module (`engineFrom` in `apps/chain-reaction/src/puzzle/sim.ts`).

## A new app's tests never run

**Symptom:** `npx vitest run --project my-app` fails with `No projects were found ... The filter matched no projects: my-app`; `npx vitest run apps/my-app/test` prints `No test files found, exiting with code 0`; `pnpm test` passes without running your tests.

**Cause:** the root `vitest.config.ts` lists every project explicitly in `test.projects`; a folder under `apps/` is not picked up by itself.

**Fix:** add `apps/my-app/vitest.config.ts` (`defineProject({ test: { name: "my-app", include: ["test/**/*.test.ts"], testTimeout: 60_000 } })`, as `apps/rockfall/vitest.config.ts`) and add `"apps/my-app"` to `projects` in the root `vitest.config.ts`. Details: [getting-started.md](getting-started.md#tests-in-node).

## Headless hash differs from the browser

**Symptom:** a Node test reproduces a run, but `world.stateHash()` after n ticks is not the `stateHash` in the `pnpm shot --ticks n` sidecar.

**Cause:** usually the order of rules and physics. `createGame` runs `world.step` and then `onFrame`, so rules run after physics each tick; a Node loop that runs `sim.step(input)` before `world.step(1)` shifts tick-keyed rules by one tick. Other causes: a different seed or gravity in `loadSim` (pass `scene.sim.seed` / `scene.sim.gravity`), spawning entries in a different order than `expandScene(scene).sim`, the `fast` build, or JS math that differs between engines.

**Fix:** mirror the browser loop exactly: `world.step(1); views.refresh(); bot.next(sim, input); sim.step(input);` per tick for a `createGame` app, or call the sim's own `step()` if the sim owns its world. See [getting-started.md](getting-started.md#tick-order).

## A second game on the same page

**Symptom:** you call `createGame` again on the same page (level switch, site change) and the old game is still wired up.

**Cause:** `Game.dispose` does not exist yet. `game.stop()` only cancels the frame loop; the renderer, the wasm `World`, the window key listeners, the `ResizeObserver` and `window.__pebble3d` stay.

**Fix:** one game per page. Switch levels inside one game (new `World`s, as Chain Reaction does per run) or reload the page with new URL params (Field Notes reloads to change site).
