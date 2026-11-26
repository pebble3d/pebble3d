import { GaussianSplatPLYLoader } from "three/addons/loaders/GaussianSplatPLYLoader.js";
import { KSPLATLoader } from "three/addons/loaders/KSPLATLoader.js";
import { SPLATLoader } from "three/addons/loaders/SPLATLoader.js";
import { SPZLoader } from "three/addons/loaders/SPZLoader.js";
import { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import { Fn, saturation, sRGBTransferEOTF, uniform, vec4 } from "three/tsl";
import {
	type BufferGeometry,
	Color,
	Mesh,
	type Node,
	PlaneGeometry,
	ShadowNodeMaterial,
} from "three/webgpu";
import { SPLAT_LAYER } from "../defaults/pipeline.ts";
import type { RenderSettings } from "../types.ts";

export type SplatConfig = NonNullable<RenderSettings["splat"]>;

/** Soft splat budget: a scene above this many splats logs a warning. */
export const SPLAT_BUDGET = 1_500_000;

/**
 * Any failure to produce a splat from `url` (network, parse, unsupported extension).
 * `message` is exactly `SplatLoadError: <url>`; the underlying error is `cause`.
 */
export class SplatLoadError extends Error {
	readonly url: string;

	constructor(url: string, cause?: unknown) {
		super(`SplatLoadError: ${url}`, { cause });
		this.name = "SplatLoadError";
		this.url = url;
	}
}

export type SplatFormat = "spz" | "splat" | "ksplat" | "ply";

/** Something with `loadAsync(url) -> BufferGeometry` (the three splat loaders). */
export interface SplatGeometryLoader {
	loadAsync(url: string): Promise<BufferGeometry>;
}

export type SplatLoaderFactories = Record<
	SplatFormat,
	() => SplatGeometryLoader
>;

export const SPLAT_LOADERS: SplatLoaderFactories = {
	spz: () => new SPZLoader(),
	splat: () => new SPLATLoader(),
	ksplat: () => new KSPLATLoader(),
	ply: () => new GaussianSplatPLYLoader(),
};

/** The splat format of `url` from its extension (query and hash ignored), or null. */
export function splatFormatOf(url: string): SplatFormat | null {
	const path = url.split(/[?#]/, 1)[0] ?? "";
	const dot = path.lastIndexOf(".");
	if (dot < 0 || dot < path.lastIndexOf("/")) return null;
	const ext = path.slice(dot + 1).toLowerCase();
	return ext === "spz" || ext === "splat" || ext === "ksplat" || ext === "ply"
		? ext
		: null;
}

/** Loads the splat geometry with the loader for its extension; every failure is a `SplatLoadError`. */
export async function loadSplatGeometry(
	url: string,
	loaders: SplatLoaderFactories = SPLAT_LOADERS,
): Promise<BufferGeometry> {
	const format = splatFormatOf(url);
	if (format === null)
		throw new SplatLoadError(url, new Error("unsupported splat extension"));
	try {
		const geometry = await loaders[format]().loadAsync(url);
		if (!geometry?.getAttribute("position"))
			throw new Error("loader returned no splat geometry");
		return geometry;
	} catch (e) {
		throw new SplatLoadError(url, e);
	}
}

/** Per-splat colour controls, uniforms so `splatOnly` debug can bypass them at runtime. */
export interface SplatColorControls {
	exposure: { value: number };
	saturation: { value: number };
	/** Linear RGB multiplier applied after exposure (white = none); for time-of-day grading. */
	tint: { value: Color };
}

/**
 * Splat colours are stored display-referred (sRGB-encoded, as captured). The engine's working
 * space is linear and the pipeline encodes to sRGB once at the end, so the colour is decoded to
 * linear here; without this the splats are encoded twice and look washed out. Composite A then
 * tone-maps splats with the meshes (AgX compresses and slightly desaturates them), which the
 * per-splat `exposure` / `saturation` compensate for. Both are 1 for the raw reference.
 */
function linearizeSplatColor(
	splat: GaussianSplat,
	cfg: SplatConfig,
): SplatColorControls {
	const material = splat.material;
	const source = material.colorNode as Node<"vec4">;
	const exposure = uniform(cfg.exposure ?? 1);
	const sat = uniform(cfg.saturation ?? 1);
	const tint = uniform(new Color(1, 1, 1));
	material.colorNode = Fn(() => {
		const c = source.toVar("splatSource");
		const rgb = saturation(sRGBTransferEOTF(c.rgb), sat)
			.mul(exposure)
			.mul(tint);
		return vec4(rgb, c.a);
	})();
	material.needsUpdate = true;
	return { exposure, saturation: sat, tint };
}

export interface LoadedSplat {
	object: GaussianSplat;
	count: number;
	color: SplatColorControls;
}

/**
 * Loads `cfg.url` (loader by extension), wraps it in a `GaussianSplat` with the authored
 * transform on `SPLAT_LAYER`, and linearises its colour. Rejects with `SplatLoadError`.
 */
export async function loadSplat(
	cfg: SplatConfig,
	loaders: SplatLoaderFactories = SPLAT_LOADERS,
): Promise<LoadedSplat> {
	const geometry = await loadSplatGeometry(cfg.url, loaders);
	let object: GaussianSplat;
	try {
		object = new GaussianSplat(geometry);
	} catch (e) {
		geometry.dispose();
		throw new SplatLoadError(cfg.url, e);
	}
	const count = geometry.getAttribute("position").count;
	object.name = "splat";
	object.position.set(...cfg.position);
	object.quaternion.set(...cfg.rotation);
	object.scale.setScalar(cfg.scale);
	object.layers.set(SPLAT_LAYER);
	// The camera is normally inside the capture; per-object culling only costs a bounds pass.
	object.frustumCulled = false;
	object.castShadow = false;
	object.receiveShadow = false;
	object.updateMatrixWorld(true);
	const color = linearizeSplatColor(object, cfg);
	return { object, count, color };
}

/** Shadow tint over the splat floor: a cool near-black, like open-shade skylight. */
export const SHADOW_CATCHER_COLOR = "#0b0f1a";
export const SHADOW_CATCHER_OPACITY = 0.7;

/**
 * An invisible floor at `floorY` that only shows the shadows cast onto it (splats
 * neither cast nor receive shadows). It does not write depth, so splats just below the
 * floor are not cut, and draws after the splat (renderOrder) so the shadow darkens it.
 */
export function createShadowCatcher(floorY: number, size: number): Mesh {
	const geometry = new PlaneGeometry(size, size);
	geometry.rotateX(-Math.PI / 2);
	const material = new ShadowNodeMaterial({
		color: new Color(SHADOW_CATCHER_COLOR),
		opacity: SHADOW_CATCHER_OPACITY,
	});
	material.depthWrite = false;
	const mesh = new Mesh(geometry, material);
	mesh.name = "shadowCatcher";
	mesh.position.y = floorY;
	mesh.receiveShadow = true;
	mesh.castShadow = false;
	mesh.renderOrder = 1;
	return mesh;
}
