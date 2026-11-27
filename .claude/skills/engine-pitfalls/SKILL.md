---
name: engine-pitfalls
description: Use when building gameplay with Pebble3D, and whenever something renders black, throws, times out in a capture, or behaves differently in Node and the browser. Known engine traps as "if you see X, do Y", each linked to the full fix.
---

# Engine pitfalls

Traps that cost the demo builders hours. Read the whole list once before the build step of [make-a-game](../make-a-game/SKILL.md), then come back by symptom. Each line says what to do; the link has the cause and the full fix in [docs/troubleshooting.md](../../../docs/troubleshooting.md). Do not debug from scratch before checking here.

## Rendering

- **`BackendUnavailable: webgpu`** → the browser has no WebGPU. Open with `?webglFallback=1` or `?backend=webgl`, or launch Chromium with the WebGPU flags; check `chrome://gpu`. [Fix](../../../docs/troubleshooting.md#backendunavailable-webgpu)
- **Outdoor scene black or white on WebGL only** → load HDRIs through the engine's environment loader, not your own PMREM. [Fix](../../../docs/troubleshooting.md#webgl-outdoor-scene-is-black-or-white)
- **Your camera drifts when the mouse drags or scrolls** → dispose the default orbit controller after boot and set it to null. [Fix](../../../docs/troubleshooting.md#the-orbit-camera-fights-your-camera)
- **A second character slides in its bind pose** → only the player gets an animated view; attach the others yourself. Entity order picks the player. [Fix](../../../docs/troubleshooting.md#other-characters-do-not-animate)
- **A teleported static body's mesh stays put** → anything that moves must be `"kinematic"`. [Fix](../../../docs/troubleshooting.md#a-static-mesh-does-not-move)
- **Night or interior scene looks like daylight** → lower the scene's `environmentIntensity` and add a fixed pool of three.js point lights; the schema has only a sun. [Fix](../../../docs/troubleshooting.md#a-night-scene-is-too-bright)
- **Draw calls jump with each character** → shadow casters draw once per cascade; turn shadows off for props, crowds and decals. [Fix](../../../docs/troubleshooting.md#draw-calls-climb-with-each-character)
- **Toon ink lines around decals on a splat floor** → make the decals transparent materials. [Fix](../../../docs/troubleshooting.md#decals-on-a-splat-floor-get-ink-outlines)
- **Two captures of the same tick differ by a few pixels** → normal GPU noise; compare `stateHash`, not bytes. [Fix](../../../docs/troubleshooting.md#two-identical-shots-differ-slightly)

## Physics and sim

- **`world.setVelocity is not a function`, or a feature silently does nothing after a pull** → stale wasm: `pnpm build:wasm`, restart the dev server. [Fix](../../../docs/troubleshooting.md#stale-wasm-setvelocity-is-not-a-function)
- **Determinism hash mismatch** → stale wasm first, then `Math.random`/`Date`/wall-clock `dt` in the sim, then the `fast` build. [Fix](../../../docs/troubleshooting.md#determinism-hash-mismatch)
- **Node test hash differs from the browser at the same tick** → mirror the browser tick order exactly: physics step, refresh views, bot, rules. [Fix](../../../docs/troubleshooting.md#headless-hash-differs-from-the-browser)
- **Bot or rules input ignored on high-refresh displays** → re-send your character input at the end of every frame, after the tick loop. [Fix](../../../docs/troubleshooting.md#your-setcharacterinput-is-overwritten)
- **Reads return zeros after a spawn** → a spawn detached the views; call `views.refresh()` and read through the views object. [Fix](../../../docs/troubleshooting.md#state-views-read-zeros-after-a-spawn)
- **Raycast misses on a world you just built** → step once before the first query. [Fix](../../../docs/troubleshooting.md#raycasts-miss-on-a-new-world)
- **You want collision callbacks** → there are none; detect contacts in your rules from distances and velocities. [Fix](../../../docs/troubleshooting.md#there-are-no-contact-events)
- **A ball rolls forever** → set `angularDamping` on rolling bodies. [Fix](../../../docs/troubleshooting.md#spheres-roll-forever)
- **The game crawls under heavy physics** → cap ticks per frame, consider the `fast` build or a worker. [Fix](../../../docs/troubleshooting.md#heavy-physics-makes-the-game-crawl)
- **You need a per-tick hook or runtime spawns** → `createGame` has neither; advance your own sim in `onFrame` or boot like Rockfall. [Fix](../../../docs/troubleshooting.md#creategame-has-no-per-tick-hook)
- **Level switch leaves the old game running** → one game per page; new worlds inside it, or reload with new params. [Fix](../../../docs/troubleshooting.md#a-second-game-on-the-same-page)
- **Scene errors appear one per run** → validate with `SceneSchema.safeParse` and print every issue. [Fix](../../../docs/troubleshooting.md#only-the-first-scene-error-is-reported)
- **`TS2352` on an imported scene JSON** → cast through `unknown`. [Fix](../../../docs/troubleshooting.md#ts2352-when-passing-an-imported-scene-json)

## Assets and hosting

- **404 for `/favicon.ico` or an asset fails a capture** → add the favicon link, run `pnpm fetch-assets`, copy a demo's `vite.config.ts`. [Fix](../../../docs/troubleshooting.md#shot-fails-on-a-404)
- **Assets, transcoder or wasm 404 under a sub-path** → keep URLs root-absolute and pass hand-loaded ones through `renderer.assetUrl`. [Fix](../../../docs/troubleshooting.md#assets-404-under-a-sub-path)
- **`fetch-assets` hash mismatch or failed avatar** → check the download; the avatar build is linux-x64 only. [Fix](../../../docs/troubleshooting.md#fetch-assets-hash-mismatch-or-failed-avatar)

## Captures, benches and toolchain

- **Shot times out on `__pebble3d.done`** → read `mode` and `ticks` from the URL and pass `stopAtTick`; catch boot errors into `__pebble3d.error`. [Fix](../../../docs/troubleshooting.md#shot-times-out-waiting-for-__pebble3ddone)
- **Shot refuses a SwiftShader adapter** → run where a real GPU and a display exist, or `--headed`; a custom boot must report its adapter. [Fix](../../../docs/troubleshooting.md#shot-refuses-a-swiftshader-adapter)
- **`--out must be inside` the capture folder** → omit `--out`, or keep it under the default capture folder. [Fix](../../../docs/troubleshooting.md#shot---out-rejected)
- **Sidecar `stateHash` never changes** → point `__pebble3d.stateHash` at the world your game really runs. [Fix](../../../docs/troubleshooting.md#the-shot-statehash-never-changes)
- **Fixed-mode captures flaky with a worker sim** → run the sim inline in fixed mode, the worker only in realtime. [Fix](../../../docs/troubleshooting.md#fixed-mode-captures-with-a-worker-sim)
- **fps looks good headless, or only WebGL was measured** → confirm a real GPU renderer string and measure both backends. [Fix](../../../docs/troubleshooting.md#fps-from-a-headless-or-webgl-run-is-misleading)
- **Low or swinging fps** → another process is using the GPU; measure on an idle one. [Fix](../../../docs/troubleshooting.md#fps-numbers-are-low-or-noisy)
- **A copied fps bench measures the wrong thing** → change its port, query string and polled phases. [Fix](../../../docs/troubleshooting.md#a-copied-fps-bench-measures-the-wrong-thing)
- **`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` in a Node script** → no constructor parameter properties or `enum` in code Node imports. [Fix](../../../docs/troubleshooting.md#parameter-properties-fail-in-a-node-script)
- **A new app's tests never run** → add its `vitest.config.ts` and register it in the root `projects` list. [Fix](../../../docs/troubleshooting.md#a-new-apps-tests-never-run)
- **`pnpm docs` does nothing** → it is a pnpm builtin; use `pnpm docs:gen`. [Fix](../../../docs/troubleshooting.md#pnpm-docs-does-nothing-useful)
- **`scene.schema.json` stale or in a merge conflict** → never hand-merge; regenerate it. [Fix](../../../docs/troubleshooting.md#sceneschemajson-is-stale)
- **`!important` vanished after a lint fix** → never run biome `--unsafe` over CSS. [Fix](../../../docs/troubleshooting.md#biome---unsafe-removed-important)

## Before you invent a workaround

The demos in `apps/` hit most of these and solved them; [docs/examples.md](../../../docs/examples.md) says which demo shows what, and the cookbook in [docs/cookbook/](../../../docs/cookbook/README.md) has the patterns. If the fix needs an engine change, stop and tell the developer instead of editing `packages/` or `crates/`. Then prove the fix with [verify-your-work](../verify-your-work/SKILL.md).
