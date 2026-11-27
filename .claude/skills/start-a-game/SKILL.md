---
name: start-a-game
description: Use when creating a new game app under apps/ in the Pebble3D repo, before writing gameplay code, to scaffold it the way the demos are laid out and prove it boots, captures and runs its tests.
---

# Start a game

Scaffold `apps/<name>/` so it builds, serves, captures and tests like the demos do, before any gameplay exists. `<name>` is the app name from `apps/<name>/BRIEF.md`. Next: build the game (`make-a-game` says which skill).

The full walkthrough with every file is [docs/getting-started.md](../../../docs/getting-started.md) (section "A minimal game app"). This skill is the checklist and the template to copy.

## Template: Ringout

Copy the layout of `apps/ringout`, a small, complete game (title, play, results, rematch, bot, captures). Read these before copying:

| File                                                                | Take from it                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [package.json](../../../apps/ringout/package.json)                     | Scripts `dev` (with `--port <n> --strictPort`), `build`, `preview`, `test`, `typecheck`; deps `@pebble3d/sdk`, `@pebble3d/renderer` (`workspace:*`) and the pinned `three`. Change `name` and the port.                                                                             |
| [vite.config.ts](../../../apps/ringout/vite.config.ts)                 | `publicDir: "../playground/public"`, `appType: "mpa"`, `server.fs.allow`, the env var for the build base. Rename the env var. If the game loads glTF or KTX2, copy [apps/rockfall/vite.config.ts](../../../apps/rockfall/vite.config.ts) instead: it adds the Basis transcoder plugin. |
| [index.html](../../../apps/ringout/index.html)                         | `<canvas id="app">`, a HUD root, the favicon link, the module script.                                                                                                                                                                                                               |
| [src/main.ts](../../../apps/ringout/src/main.ts)                       | URL params documented in the top comment and parsed strictly; `createGame` with both wasm `?url` imports, `mode`, `backend`, `stopAtTick`; `window.__pebble3d` probes; `main().catch` writing `__pebble3d.error`.                                                                   |
| [README.md](../../../apps/ringout/README.md)                           | Sections: what it is, Run it (commands and a URL param table), Controls, What it shows off, Known issues.                                                                                                                                                                           |
| [bench/capture-final.sh](../../../apps/ringout/bench/capture-final.sh) | Build once, then one `pnpm shot` per moment with `--no-build`, a fixed `--port`, `--param demo=1`; stops on the first failure.                                                                                                                                                      |

Also copy `tsconfig.json` and `vitest.config.ts` from `apps/ringout/` (change the project `name`). Keep game code under `src/game/` (sim, bot, input, UI) and scenes under `scenes/`. Start with the smallest scene that shows something: a ground, a light preset, one player body.

## Checklist

1. **Folder and files.** Create the files above in `apps/<name>/`. `BRIEF.md` is already there from `game-interview`; do not overwrite it.
2. **Pick an unused port.** List the ports in use:

   ```bash
   grep -rhoE -- '--port[ =][[:digit:]]+' apps/*/package.json apps/*/bench | sort -u
   ```

   Pick a free one for `dev` (keep `--strictPort`, so a clash fails loudly instead of moving), and a different free one for the capture script's `--port`. Ringout uses 5270 for dev and 5271 for captures. Note the default playground dev server uses 5173.
3. **Register the tests.** Add `"apps/<name>"` to the `projects` array in the root `vitest.config.ts`, next to the other apps. Without it the app's tests never run and `--project <name>` matches nothing.
4. **Demo mode.** Parse `?demo=1` in `src/main.ts` and drive the game with a bot that writes the same input a player produces. At this stage the bot can be trivial (press start, move toward something); it grows with the game. See [docs/cookbook/demo-bot-and-captures.md](../../../docs/cookbook/demo-bot-and-captures.md).
5. **Fixed-tick mode.** Read `mode` and `ticks` and pass `stopAtTick`, or every `pnpm shot` times out.
6. **WebGL fallback.** `createGame` already honours `?webglFallback=1` (see [docs/troubleshooting.md](../../../docs/troubleshooting.md)): do not pass `webglFallback: false`, and support `?backend=webgl` like Ringout does. Check both URLs load.
7. **Sub-path builds.** Keep asset URLs root-absolute (`/assets/...`) and build URLs in code from `import.meta.env.BASE_URL`, so the game can be hosted under a sub-path: [docs/cookbook/sub-path-hosting.md](../../../docs/cookbook/sub-path-hosting.md).
8. **Install.** Run `pnpm install` at the repo root so pnpm links the workspace packages.
9. **A first test.** One Node test in `test/` that loads the scene and steps the sim with the real wasm (pattern in [docs/getting-started.md](../../../docs/getting-started.md), "Tests in Node").

## Exit check

All of these, before any gameplay work. The dev server never exits, so start it in the background or a second terminal (not in the same shell before the other commands, which would block), and leave it running while you open the pages:

```bash
npx vitest run --project <name>          # runs your test (not "No projects were found")
pnpm --filter <name> typecheck
pnpm shot --app <name> --param demo=1 --ticks 120 --name first
pnpm --filter <name> dev &               # background; open http://localhost:<port>/ and /?demo=1
```

- The shot exits 0, its `.json` sidecar has an empty `console` array, and you opened the PNG whose path the shot prints: the scene is visible, not black or empty.
- `?webglFallback=1` and `?backend=webgl` load without errors.
- `pnpm lint` is clean for the new files.

If the shot fails or the frame is black, look up the symptom in [docs/troubleshooting.md](../../../docs/troubleshooting.md) (stale wasm after a pull is the usual cause: `pnpm build:wasm`).
