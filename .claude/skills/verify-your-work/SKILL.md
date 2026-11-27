---
name: verify-your-work
description: Use when a Pebble3D game or app change looks finished, at the end of every make-a-game step from scaffold on, or before telling anyone a game works. Defines done: tests, captures, sidecars, looking at every image, both backends.
---

# Verify your work

This skill is the definition of done. A game is not done because it compiles or because a capture exited 0. It is done when the checks below pass and you have looked at what the player will see. Never report done without it.

The reference for every command and flag is [docs/verification.md](../../../docs/verification.md). The demo bot and capture script pattern is [docs/cookbook/demo-bot-and-captures.md](../../../docs/cookbook/demo-bot-and-captures.md). Any failure: look it up in [docs/troubleshooting.md](../../../docs/troubleshooting.md) before debugging from scratch.

`<name>` below is the app folder under `apps/`.

## Quick checks (end of every step)

Run these at the end of every [make-a-game](../make-a-game/SKILL.md) step from scaffold on. They take a minute and catch most regressions.

```bash
npx vitest run --project <name>
pnpm shot --app <name> --param demo=1 --ticks 600 --name check
```

1. The tests pass, and the output shows your test files ran (not "No test files found").
2. The shot exits 0. Its last line names the backend, adapter, tick and `stateHash`.
3. Open the `.json` sidecar next to the PNG and read it (next section).
4. Open the PNG whose path the shot prints, and look at it (the section after).

A step whose capture you have not opened is not finished.

## Read the sidecar

Every capture writes a `.json` sidecar beside the PNG. Check each field; a capture that exits 0 can still be wrong.

| Field         | Pass when                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `console`     | An empty array. Never allowlist your own errors to get there; fix them. A warning counts too: fix it, or explain it in the README's known issues with the reason. Never leave one silent.                                       |
| `adapterInfo` | `backend` is the one you asked for, and the device names a real GPU, not SwiftShader or llvmpipe.                                                                                                                               |
| `tick`        | The tick you asked for with `--ticks`.                                                                                                                                                                                          |
| `stateHash`   | Different between captures of different moments in a game that moves. The same hash everywhere means the hook reports an idle world: [stateHash never changes](../../../docs/troubleshooting.md#the-shot-statehash-never-changes). |
| `game`        | Your `__pebble3d.game` probes read what the frame should show: the phase (title, playing, results), the bot's current action, score.                                                                                            |

Run the same capture twice: the `stateHash` must match. If it does not, the sim is not deterministic: [determinism hash mismatch](../../../docs/troubleshooting.md#determinism-hash-mismatch).

## Look at every image

Open every PNG (and the animated WebP from a `--sequence`) with your image viewer or file reader. Exit 0 only means nothing errored. For each one, check and write down:

- **Not blank.** Not black, not white, not a flat sky with nothing in it. A black or white frame on WebGL only: [WebGL outdoor black/white](../../../docs/troubleshooting.md#webgl-outdoor-scene-is-black-or-white).
- **The subject is in frame.** The player, the goal and the threat are visible and readable at a glance, not hidden behind scenery or off screen.
- **The moment is the one you meant.** The title capture shows the title, the results capture shows results. If not, move the tick (scout it headless, as the cookbook's "Scout ticks headless" row explains).
- **The HUD is readable.** Text not clipped or overlapping, contrast against the scene, numbers that make sense.
- **It matches the brief.** The palette, lighting and mood in the "look" section of `apps/<name>/BRIEF.md`, not engine defaults.
- **No rendering faults.** Flickering or z-fighting surfaces, stretched textures, floating or sunken objects, characters in a bind pose.

Describe what you saw in one line per image in your report. If you cannot describe it, you did not look. Reading the `.json` sidecar is not looking: the sidecar cannot show a black frame, a clipped HUD or the wrong moment. Every PNG and WebP you captured gets opened and gets its own line, including the ones from the capture script and the WebGL run.

## The full check (before reporting done)

All of these pass, in this order.

1. **Unit and sim tests.** `npx vitest run --project <name>`. The app has a determinism test written like `apps/rockfall/test/sim.test.ts`: the same seed and input log run twice give the same `world.stateHash()`, and one changed input gives a different one.
2. **Types and lint.** `pnpm typecheck` and `pnpm lint`. Lint must add no new warnings for your files.
3. **The capture script.** `bash apps/<name>/bench/capture-final.sh` exits 0. It covers at least title, mid-play, a win or loss, the results screen and one `--sequence` of the core action, all driven by the `?demo=1` bot. Read every sidecar and look at every image, as above.
4. **The demo bot plays the whole loop.** The captures and the `game` probes show it reaching results and restarting, with the same input type a player produces.
5. **The WebGL path.** WebGPU is not everywhere: Firefox, Safari and many Linux Chromium builds get WebGL. Capture with `--backend webgl` and look at it; it must exit 0 and look like the WebGPU capture. Then load the game with `?webglFallback=1`, headed (the dev server in a browser) or headless (`pnpm shot --app <name> --param webglFallback=1 --param demo=1 --name fallback`), and check it boots and plays with no console errors; do the same for `/?backend=webgl`. `createGame` reads `webglFallback` from the URL by itself; never pass `webglFallback: false`.
6. **Performance, when you claim it.** Build, then run the app's fps bench on an idle GPU, on both backends, in a browser that reached the real GPU. Numbers from a headless run on SwiftShader, or from one backend only, prove nothing: [misleading fps](../../../docs/troubleshooting.md#fps-from-a-headless-or-webgl-run-is-misleading) and [low or noisy fps](../../../docs/troubleshooting.md#fps-numbers-are-low-or-noisy). The target is 60 fps.
7. **Engine determinism, only if engine code changed.** Games should not change `packages/` or `crates/`. If something did change there, run `pnpm build:wasm` and the determinism script from [AGENTS.md](../../../AGENTS.md); it must print `2d76d9927e780425`.
8. **The README.** `apps/<name>/README.md` lists how to run it, the controls and every URL param the game reads (including `demo`, `seed`, `mode`, `ticks`, `backend`), and a known-issues section for any console warning you could not fix, each with its reason.

### Exit lines for the full check

Each of these is a line you can write truthfully in your report, or the check is not done:

- **Every capture opened.** I opened every PNG and WebP I captured (not only the sidecars), and my report has one line per capture saying what it shows.
- **WebGL fallback loaded.** I loaded the game with `?webglFallback=1` (headed or headless) and it booted and played with no console errors.
- **No silent console messages.** Every console error and warning from every capture and page load is fixed, or listed in the README's known issues with the reason.

## When headless WebGPU has no adapter

The right action depends on the symptom.

1. **`software/fallback adapter (SwiftShader) refused`** (often after `shot: headless got a software adapter; retrying headed`). Only this case retries: `pnpm shot` tries once more in a visible window, and only with a display (`DISPLAY` or `WAYLAND_DISPLAY` set). Pass `--headed` to go straight there. Details: [SwiftShader adapter](../../../docs/troubleshooting.md#shot-refuses-a-swiftshader-adapter).
2. **`BackendUnavailable: webgpu (WebGPURenderer fell back to WebGL)` or `requested backend webgpu but the page ran webgl`.** The shot does not retry these; headed alone will not help. Open `chrome://gpu` in the same Chromium and read the WebGPU line. On Linux, WebGPU is often off: launch with `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan` (`pnpm shot` already does). Details: [BackendUnavailable: webgpu](../../../docs/troubleshooting.md#backendunavailable-webgpu). To check the fallback itself rather than WebGPU, capture with `--param webglFallback=1` or `--backend webgl`; that is a WebGL check and does not stand in for the WebGPU capture.
3. **Your own boot must report the adapter.** A custom boot without `createGame` has to fill `__pebble3d.adapterInfo`, or the software check cannot work: [SwiftShader adapter](../../../docs/troubleshooting.md#shot-refuses-a-swiftshader-adapter).
4. **No GPU at all** (a container, a remote shell without a display): you cannot verify rendering there. Still run the Node tests, typecheck and lint, then tell the developer plainly that no capture was taken and why, and ask them to run the capture script on a machine with a GPU. Do not switch to WebGL on SwiftShader, allowlist the error, or describe images you did not see.

## Reporting done

Report only after the full check passes:

- What was built, with a link to `apps/<name>/BRIEF.md`.
- How to run it: `pnpm --filter <name> dev` and the URL, plus the controls.
- Test, typecheck and lint results, as the commands printed them.
- The captures you looked at, each with the PNG path the shot printed and your one-line description of it.
- Which backends you checked, and fps only if you measured it as above.
- Anything skipped or still open, and every assumption from the brief that the developer has not confirmed.

If any check failed and you could not fix it, say which one and what you saw. A precise "not done yet" is worth more than a false "done".
