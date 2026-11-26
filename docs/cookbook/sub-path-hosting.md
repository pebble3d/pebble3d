# Sub-path hosting

Goal: serve a game from a URL like `https://example.com/games/skyrun/` instead of the site root, with every asset, the Basis transcoder and the wasm still loading.

Scenes and apps write shared files as root-absolute paths: `/assets/qwantani_noon_puresky_2k.hdr`, `/assets/rocketbox-male-adult-16.glb`, `/basis/`. The renderer prefixes those paths with an **asset base**, so the JSON never changes between a dev server at `/` and a build under a sub-path.

```bash
# from apps/<app>: everything (page, wasm, public assets, basis/) under /games/skyrun/
pnpm exec vite build --base /games/skyrun/
```

That is the whole change for a standalone build. Vite's `--base` (or `base: "/games/skyrun/"` in `vite.config.ts`) sets `import.meta.env.BASE_URL`, the renderer uses it as the asset base, and the build already contains what the prefixed URLs point at:

| URL in code | Resolves to | Served from |
| --- | --- | --- |
| `/assets/x.hdr` (scene `environment.hdri`, `splat.url`, glTF `mesh.gltf.url`, `renderer.loadGltf(url)`) | `/games/skyrun/assets/x.hdr` | `dist/assets/`, copied from the shared `publicDir: "../playground/public"` |
| `/basis/` (KTX2 transcoder, `createRenderer`'s `transcoderPath` default) | `/games/skyrun/basis/` | `dist/basis/`, emitted by the `basisTranscoder()` plugin in the copied `vite.config.ts` |
| `import detWasmUrl from ".../engine_core_det_bg.wasm?url"` | `/games/skyrun/assets/engine_core_det_bg-<hash>.wasm` | Vite rewrites `?url` imports for the base itself |
| `new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" })` | under the base | Vite bundles the worker |

## Where the base comes from

First match wins (`packages/renderer/src/asset-base.ts`, `defaultAssetBase`):

1. `createGame({ assetBase })` or `createRenderer(canvas, settings, { assetBase })`.
2. `VITE_PEBBLE3D_ASSET_BASE`, an env var read at build time: the shared files live somewhere other than the game's own base.
3. Vite's `BASE_URL` (the `--base` the app was built with).
4. `"/"`: every URL is returned unchanged. Default builds and the dev server behave exactly as before.

`resolveAssetUrl(url, base)` (exported from `@pebble3d/renderer`) prefixes only root-absolute URLs. Relative URLs (`assets/x.glb`), protocol-relative `//host/x` and URLs with a scheme (`https:`, `data:`, `blob:`) pass through, and a URL that already starts with the base is not prefixed twice.

## Several games sharing one copy of the assets

`pnpm build:site` (`scripts/build-site.mjs`) builds every game in `site/src/data/games.json` this way:

```bash
VITE_PEBBLE3D_ASSET_BASE=/pebble3d/ VITE_PEBBLE3D_WEBGL_FALLBACK=1 \
  pnpm exec vite build --base /pebble3d/play/<id>/ --outDir site/dist/play/<id>
```

```text
site/dist/
  assets/          apps/playground/public/assets, copied once
  basis/           the Basis transcoder, kept once (LICENSE.txt added)
  play/<id>/       one game: index.html and its hashed bundles and wasm in assets/
```

The page, its JS and its wasm load from `/pebble3d/play/<id>/` (Vite's base); scene assets and the transcoder load from `/pebble3d/assets/` and `/pebble3d/basis/` (the asset base). After each game's build the script deletes that game's copies of the shared public files and of `basis/`, so the large splats and HDRIs exist once.

## What is not resolved for you

| You load | Do this |
| --- | --- |
| A file with your own `fetch`, `Audio`, `TextureLoader`, `HDRLoader` | Pass `renderer.assetUrl("/assets/x.ogg")` (the renderer's resolver with its base). |
| A sound through `attachSound` | It does not resolve its URL: `attachSound(..., renderer.assetUrl(url))`. |
| A glTF through your own `GLTFLoader` | Use `renderer.loadGltf(url)` instead: resolved, cached per url, KTX2-ready, counted in `stats().textureMB`. |
| A wasm URL posted to a Web Worker | Make it absolute first: `new URL(detWasmUrl, location.href).href`. A worker resolves a relative URL against its own script, not the page. |
| A link to another page of your site | `import.meta.env.BASE_URL + "other/"`. |

Without `createGame`, `createRenderer` applies the same default, so an app that boots itself (Skyrun, Swarm Siege) only needs root-absolute paths and the copied `vite.config.ts`.

## Check it

```bash
cd apps/<app>
pnpm exec vite build --base /x/   # into dist/ (gitignored)
ls dist                      # assets/ basis/ favicon.svg index.html
pnpm exec vite preview --base /x/ --port 5340   # open http://localhost:5340/x/
```

A 404 in the network tab names the URL that missed its base: usually a hand-written `fetch("/assets/...")` that should go through `renderer.assetUrl`.

| Gotcha | Detail |
| --- | --- |
| Keep paths root-absolute | Write `/assets/x.glb`, not `assets/x.glb` or `./assets/x.glb`: relative paths are never prefixed and break on pages that are not at the base root. |
| Copy `vite.config.ts` | It is what serves `/basis/` in dev and emits `dist/basis/` on build; without it KTX2 textures fail under any base. (`apps/ringout` and `apps/drift-drone` load no KTX2 glTF and leave the plugin out, so their builds have no `basis/`.) |
| Don't prefix by hand | Leave paths root-absolute and let the asset base do it. A path you prefixed with `BASE_URL` yourself is wrong as soon as `VITE_PEBBLE3D_ASSET_BASE` points somewhere else. |

See it in: [apps/skyrun/src/main.ts](../../apps/skyrun/src/main.ts) (root-absolute HDRI, transcoder and runner glTFs with `createRenderer` and `renderer.loadGltf`, lines 86-115), [apps/swarm-siege/src/main.ts](../../apps/swarm-siege/src/main.ts) (absolute wasm URL for the sim worker, lines 109-112), [scripts/build-site.mjs](../../scripts/build-site.mjs) (the shared-assets layout, lines 76-137), [packages/renderer/src/asset-base.ts](../../packages/renderer/src/asset-base.ts).
