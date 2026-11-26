# site/: the Pebble3D public website

Astro + Starlight, deployed to GitHub Pages by `.github/workflows/pages.yml`.
Published at https://pebble3d.github.io/pebble3d/.

| Path                                       | What it is                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `site.config.mjs`                          | The site URL, the base path and the repo URL. `PEBBLE3D_SITE_URL` and `PEBBLE3D_SITE_BASE` override them (a custom domain is `PEBBLE3D_SITE_URL=https://pebble3d.com PEBBLE3D_SITE_BASE=/`).     |
| `src/data/games.json`                      | **The demos list.** Every demo page, the home grid and its "Test out N demos" heading, the sitemap, JSON-LD and `pnpm build:site` read it.                                                       |
| `src/data/agents.ts`                       | The Build with AI pages: setup steps, the shared prompt and the checks table.                                                                                                                    |
| `src/pages/`                               | Home, demos, Build with AI, Compare, License, Credits, robots.txt.                                                                                                                               |
| `src/content/docs/`                        | Generated: the repo's `docs/` and `AGENTS.md` as Starlight pages (gitignored).                                                                                                                   |
| `public/shots/<id>/`, `public/og/<id>.jpg` | Committed screenshots (WebP, 1280x720) and Open Graph images (JPEG, 1200x630).                                                                                                                   |
| `scripts/sync.mjs`                         | Runs before every build: docs to Starlight pages, raw `.md` twins in `public/docs/`, and `llms.txt`, `llms-full.txt`, `AGENTS.md`, `README.md`, `LICENSE`, `scene.schema.json` at the site root. |
| `scripts/serve.mjs`                        | Serves `dist/` under the base path, like Pages: `node site/scripts/serve.mjs 5320`.                                                                                                              |
| `scripts/check-links.mjs`                  | Fails on any broken internal link or anchor in `dist/`.                                                                                                                                          |
| `scripts/check-games.mjs`                  | Loads every game from the served site in Chromium (WebGPU); `--fallback` hides WebGPU and checks the WebGL fallback and its notice.                                                              |
| `scripts/screens.mjs`                      | Full-page screenshots at 1440 and 390 px into `artifacts/site/`.                                                                                                                                 |

## Build and check

```bash
pnpm i && pnpm build:wasm && pnpm fetch-assets   # once
pnpm build:site                                  # site + every game -> site/dist/
node site/scripts/serve.mjs 5320 &               # http://127.0.0.1:5320/pebble3d/
node site/scripts/check-links.mjs
node site/scripts/check-claims.mjs
node site/scripts/check-games.mjs                # and: --fallback
node site/scripts/screens.mjs
```

`pnpm --filter site dev` runs the Astro dev server on port 5320 (pages only; the games
under `play/` exist only after `pnpm build:site`).

`pnpm build:site` builds each game with `vite build --base <base>play/<id>/` and two
opt-in engine settings: `VITE_PEBBLE3D_ASSET_BASE=<base>`, so the game loads the shared
`/assets/...` files from `<base>assets/`, and `VITE_PEBBLE3D_WEBGL_FALLBACK=1`, so a
browser without WebGPU gets the WebGL fallback and a notice instead of an error. The
shared assets and the Basis transcoder are copied once, to `<base>assets/` and
`<base>basis/`.

## Add a game

1. The game is an app in `apps/<app>/` that already builds with `vite build`, serves the
   playground's `public/` (`publicDir: "../playground/public"`), loads shared files through
   scene URLs or `renderer.loadGltf` / `renderer.assetUrl` (so the asset base applies), and
   sets `window.__pebble3d.ready`.
2. The game has a committed `apps/<app>/README.md`: pitch, how to run, controls, what it
   shows off, key numbers and known issues. It is the source for the site copy: every
   number in the `games.json` entry must appear in it (`check-claims.mjs` enforces this),
   and the demo page links it.
3. Add an entry to `src/data/games.json` (order is the display order):
   - `id`: the URL slug, used for `demos/<id>/`, `play/<id>/`, `shots/<id>/` and `og/<id>.jpg`.
   - `name`, `app` (the directory under `apps/`), `blurb` (one sentence for cards),
     `tag` (a few mono keywords), `genre` (for JSON-LD), `pitch` (the demo page's intro),
     `caption` (used if it becomes the home hero).
   - `controls`: `{ "keys", "action" }` pairs. Check every one against the game's input code.
   - `features`: `{ "title", "text", "links": [{ "label", "href" }] }`. Each claim links to
     a doc page (`docs/cookbook/<recipe>/`, `docs/scene-reference/#post`, ...).
   - `screenshots`: about three `{ "file", "alt" }`; the first is the cover.
   - `webglFallback`: `false` if the game does not render correctly on the WebGL fallback
     (`node site/scripts/check-games.mjs --fallback`, then look at the PNG); the page says so.
4. Add the images, from the game's 1280x720 PNG captures:

   ```bash
   mkdir -p site/public/shots/<id>
   magick <capture>.png -resize 1280x720 -strip -quality 76 -define webp:method=6 site/public/shots/<id>/<name>.webp
   magick <cover>.png -resize 1200x675^ -gravity center -extent 1200x630 -strip -quality 66 -interlace JPEG site/public/og/<id>.jpg
   ```

   Keep each file under about 150 KB. Never commit the PNGs.
5. Run the checks above. The home heading, the demos index, the sitemap and the CI build
   pick the game up from the JSON; nothing else needs editing.

## Rules for the copy

- Only facts from the repo, its docs and the game READMEs (`apps/<app>/README.md`); no
  invented numbers.
- Every feature claim links to a demo or a doc.
- Other companies' products are named only to describe compatibility: no logos, and
  nothing that suggests endorsement.

## Changelog

### Review fixes (2026-11-25)

- Home: the agent line now reads "The engine and all 6 demos were built with AI coding
  agents." (the docs came after the games).
- Each game has a committed `apps/<app>/README.md`; `games.json` numbers are checked
  against it (`check-claims.mjs`, also in CI) and each demo page links it.
- Compare: every cell about three.js, Babylon.js and PlayCanvas cites the project's own
  docs or repository (sources list on the page, checked 2026-11-25). The agent-docs row now
  credits their llms.txt files and the PlayCanvas Editor MCP server; three.js physics and
  splat addons are listed; the uncited "maturity" row was dropped.
- Licences: `THIRD-PARTY-NOTICES.txt` at the site root and next to every game (three.js,
  zod, OFL fonts, Astro, Starlight, Pagefind, every Rust crate in the wasm including
  Rapier); Credits links it and the CC BY 4.0 / CC0 deeds.
- CI: derived assets cached; `fetch-assets --allow-derived-mismatch` (Pages workflow
  only) turns a derived-output hash mismatch into a warning with the observed hash; Rust
  pinned; typecheck and lint run; job timeouts; no run on forks.
- Minor: the home scene snippet is eight lines; play pages left out of the sitemap; full
  names for OpenAI Codex and GitHub Copilot; row headers and keyboard-scrollable tables;
  `attachSound` note in the assets recipe.
