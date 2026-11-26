import { defineConfig, searchForWorkspaceRoot } from "vite";

// Derived from apps/rockfall/vite.config.ts, minus the Basis transcoder plugin: Drift Drone
// loads no KTX2/glTF (every mesh is procedural). The sdk's wasm-bindgen glue and `_bg.wasm`
// files live in packages/sdk/wasm; `main.ts` imports the `.wasm` files with `?url`, so Vite
// serves (dev) or emits (build) them as assets. `appType: "mpa"` makes a missing file a real
// 404. Shared assets and the favicon come from the playground's public dir.
//
// Sub-path hosting: `DRIFT_DRONE_BASE=/pebble3d/play/drift-drone/ pnpm --filter drift-drone build`
// (or `vite build --base <prefix>`, which overrides this).
export default defineConfig({
	base: process.env.DRIFT_DRONE_BASE ?? "/",
	publicDir: "../playground/public",
	appType: "mpa",
	server: {
		fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
	},
	build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
