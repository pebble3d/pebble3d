import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin, searchForWorkspaceRoot } from "vite";

// KTX2 textures need the Basis transcoder (MIT, ships with three) at `/basis/`, the
// renderer's default `transcoderPath`. It is copied from the pinned `three` package, never
// committed: served from node_modules in dev and emitted into dist/basis/ on build.
const BASIS_DIR = join(
	dirname(createRequire(import.meta.url).resolve("three")),
	"../examples/jsm/libs/basis",
);
const BASIS_FILES: Record<string, string> = {
	"basis_transcoder.js": "text/javascript",
	"basis_transcoder.wasm": "application/wasm",
};
function basisTranscoder(): Plugin {
	return {
		name: "pebble3d-basis-transcoder",
		configureServer(server) {
			server.middlewares.use("/basis/", (req, res, next) => {
				const name: string =
					(req.url ?? "").replace(/^\//, "").split("?")[0] ?? "";
				const type = BASIS_FILES[name];
				if (!type) return next();
				res.setHeader("Content-Type", type);
				res.end(readFileSync(join(BASIS_DIR, name)));
			});
		},
		generateBundle() {
			for (const name of Object.keys(BASIS_FILES))
				this.emitFile({
					type: "asset",
					fileName: `basis/${name}`,
					source: readFileSync(join(BASIS_DIR, name)),
				});
		},
	};
}

// The sdk's wasm-bindgen glue and `_bg.wasm` files live in packages/sdk/wasm, outside this
// app. `main.ts` imports the `.wasm` files with `?url`, so Vite serves (dev) or emits
// (build) them as assets with the `application/wasm` MIME type that
// `WebAssembly.instantiateStreaming` needs. Workspace packages are linked source, so they
// are not pre-bundled and the glue's `import.meta.url` stays intact.
//
// `appType: "mpa"`: the app is one page driven by query params, with no client-side
// routes, so the SPA fallback (index.html with status 200 for any unknown path) only hides
// missing assets. A missing splat or HDRI must be a real 404 so the loaders report it.
// Assets (splat, HDRI, robot) are fetched once into the playground's public dir by
// `pnpm fetch-assets`; this app serves the same directory instead of duplicating them.
// Sub-path hosting: `PEBBLE_BASE=/pebble3d/play/pebble-garden/ pnpm build` (a `--base` flag
// on the CLI still wins). Everything the app builds itself is relative to this base.
export default defineConfig({
	base: process.env.PEBBLE_BASE ?? "/",
	publicDir: "../playground/public",
	appType: "mpa",
	plugins: [basisTranscoder()],
	server: {
		fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
	},
	build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
