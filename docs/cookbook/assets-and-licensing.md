# Assets and licensing

Goal: add a model, HDRI, splat or texture that every app can load, without committing the file and with its licence recorded.

Large assets live in `apps/playground/public/assets/` (gitignored) and are fetched by `pnpm fetch-assets` from `apps/playground/assets.manifest.json`. Add an entry:

```json
{
	"id": "character-robot-expressive",
	"url": "https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/RobotExpressive/RobotExpressive.glb",
	"sha256": "047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319",
	"license": "CC0 1.0",
	"attribution": "RobotExpressive by Tomás Laulhé (Quaternius, https://quaternius.com); modifications by Don McCurdy; distributed with three.js r170 examples",
	"file": "RobotExpressive.glb"
}
```

(one element of the manifest's `assets` array; it is not a scene). Then:

```bash
pnpm fetch-assets --update-hashes   # download what is missing, record every file's sha256 in the manifest
pnpm fetch-assets                   # verify every file; regenerates public/assets/LICENSES.md
```

Reference it from a scene as `"/assets/RobotExpressive.glb"` (`mesh.gltf.url`, `environment.hdri`, `environment.splat.url`). Commit the manifest and `LICENSES.md`, never the asset.

| Gotcha | Detail |
| --- | --- |
| Licences | Only licences that allow commercial use: CC0, CC BY, MIT. CC BY-NC captures were rejected. Put the author, source and every modification in `attribution`. |
| Pin the URL | Use a commit- or release-pinned URL (`raw.githubusercontent.com/.../<sha>/...`) so the sha256 stays valid. |
| Hash mismatch | `--update-hashes` trusts whatever is on disk, so review the manifest diff: only your new entry should change. A cached file that does not match is re-fetched; if it still does not, it is deleted and the command fails. See [troubleshooting.md](../troubleshooting.md#fetch-assets-hash-mismatch-or-failed-avatar). |
| Derived assets | An entry with `derive` builds the file from `url` (checked against `sourceSha256`) with a pinned tool: `splat-transform` for splats (decimate under the 1.5M budget, convert to `.spz`), `scripts/assets/build-rocketbox.mjs` for the Rocketbox avatars. `sha256` is then the derived file's hash. |
| Every app sees them | Apps set `publicDir: "../playground/public"` in `vite.config.ts`, so `/assets/...` resolves in all of them. |
| Textures | glTF textures may be KTX2; the renderer's loader handles them with the Basis transcoder served at `/basis/` (copy an app's `vite.config.ts`). Load app-managed models with `game.renderer.loadGltf(url)`: cached per url and counted in `stats().textureMB`. |
| Serving under a sub-path | Root-absolute URLs (`/assets/...`, `/basis/`) in the scene, in `renderer.loadGltf` and in the transcoder path are prefixed with the asset base: `createGame({ assetBase })`, else `VITE_PEBBLE3D_ASSET_BASE` at build time, else Vite's `--base`, else `/` (unchanged). `vite build --base /x/` alone works because the public dir is copied under `/x/`; the public site shares one copy with `VITE_PEBBLE3D_ASSET_BASE=/pebble3d/`. For other app-loaded files use `renderer.assetUrl(url)`; `attachSound` does not resolve its URL, so pass it `renderer.assetUrl(url)`. |
| No file needed | Procedural geometry (Ronin Outpost's katana, `apps/katana-defense/src/game/view/katana.ts`) and synthesised audio need no manifest entry. |

See it in: [apps/playground/assets.manifest.json](../../apps/playground/assets.manifest.json), [apps/playground/public/assets/LICENSES.md](../../apps/playground/public/assets/LICENSES.md), [scripts/fetch-assets.mjs](../../scripts/fetch-assets.mjs), [apps/rockfall/vite.config.ts](../../apps/rockfall/vite.config.ts).
