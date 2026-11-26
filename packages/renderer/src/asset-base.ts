/**
 * Asset-base resolution: scenes and apps write shared assets as root-absolute paths
 * (`/assets/scene.spz`, `/basis/`). When a game is served under a sub-path (for example
 * `vite build --base /pebble3d/play/breakpoint/`), those paths must be prefixed with the
 * URL where the shared files actually live.
 *
 * The base is opt-in. With no base (or `"/"`) every URL is returned unchanged.
 */

/** The bits of Vite's `import.meta.env` the engine reads (absent outside Vite). */
interface EngineEnv {
	readonly BASE_URL?: string;
	readonly VITE_PEBBLE3D_ASSET_BASE?: string;
	readonly VITE_PEBBLE3D_WEBGL_FALLBACK?: string;
}

/**
 * Vite statically replaces `import.meta.env` in app builds (workspace packages are linked
 * source, so this file is transformed too). In plain Node it is undefined.
 */
function engineEnv(): EngineEnv {
	try {
		return (import.meta as unknown as { env?: EngineEnv }).env ?? {};
	} catch {
		return {};
	}
}

/**
 * Prefixes a root-absolute `url` (`/assets/x.glb`) with `base` (`/pebble3d/` gives
 * `/pebble3d/assets/x.glb`). Relative URLs, protocol-relative `//host` URLs, and URLs with
 * a scheme (`https:`, `data:`, `blob:`) are returned unchanged, as is everything when
 * `base` is empty or `"/"`. Already-prefixed URLs are not prefixed twice.
 */
export function resolveAssetUrl(url: string, base: string | undefined): string {
	if (!base || base === "/") return url;
	if (!url.startsWith("/") || url.startsWith("//")) return url;
	const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
	if (url === prefix || url.startsWith(`${prefix}/`)) return url;
	return `${prefix}${url}`;
}

/**
 * The asset base used when `createRenderer` / `createGame` get no `assetBase` option:
 * `VITE_PEBBLE3D_ASSET_BASE` if the app was built with it, else Vite's `BASE_URL` (the
 * `--base` the app was built with, `"/"` by default), else `"/"`. Default builds therefore
 * resolve every URL unchanged.
 */
export function defaultAssetBase(): string {
	const env = engineEnv();
	return env.VITE_PEBBLE3D_ASSET_BASE || env.BASE_URL || "/";
}

/**
 * Whether the opt-in automatic WebGL fallback is on when `createRenderer` gets no
 * `webglFallback` option: the app was built with `VITE_PEBBLE3D_WEBGL_FALLBACK=1`, or the
 * page URL has `?webglFallback=1`. Off by default, so an unavailable WebGPU still fails
 * loudly (`pnpm shot` relies on that).
 */
export function defaultWebglFallback(
	search: string | undefined = globalThis.location?.search,
): boolean {
	if (engineEnv().VITE_PEBBLE3D_WEBGL_FALLBACK === "1") return true;
	if (!search) return false;
	return new URLSearchParams(search).get("webglFallback") === "1";
}
