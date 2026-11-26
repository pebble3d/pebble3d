import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import {
	cameraPosition,
	color,
	equirectUV,
	fog,
	mix,
	normalWorldGeometry,
	positionWorld,
	rangeFogFactor,
	smoothstep,
	texture,
	vec3,
} from "three/tsl";
import {
	Box3,
	Color,
	CubeCamera,
	CubeRenderTarget,
	DataUtils,
	DirectionalLight,
	EquirectangularReflectionMapping,
	FloatType,
	HalfFloatType,
	type Node,
	type PerspectiveCamera,
	PMREMGenerator,
	type RenderTarget,
	type Scene,
	type Texture,
	type WebGPURenderer,
} from "three/webgpu";
import type { RenderSettings } from "../types.ts";
import { SPLAT_LAYER } from "./pipeline.ts";

/** Cascaded shadow map settings: 3 cascades, maxFar 120, practical splits, lightMargin 20. */
export const CSM_CASCADES = 3;
export const CSM_MAX_FAR = 120;
export const CSM_LIGHT_MARGIN = 20;
/** Distance of the sun from its target along `settings.sun.direction`. */
const SUN_DISTANCE = 100;

/**
 * The sun: a DirectionalLight placed along `settings.sun.direction` (scene -> sun), shadowing
 * through a `CSMShadowNode`. The caller adds `light` and `light.target` to the scene.
 * The CSM binds to the camera the scene pass renders with on first build; `camera` is used
 * here only to size the shadow depth range against its far plane.
 */
export function createSun(
	settings: RenderSettings,
	camera: PerspectiveCamera,
): { light: DirectionalLight; csm: CSMShadowNode } {
	const { direction, intensity, color } = settings.sun;
	const light = new DirectionalLight(new Color(color), intensity);
	const len = Math.hypot(direction[0], direction[1], direction[2]) || 1;
	light.position.set(
		(direction[0] / len) * SUN_DISTANCE,
		(direction[1] / len) * SUN_DISTANCE,
		(direction[2] / len) * SUN_DISTANCE,
	);
	light.target.position.set(0, 0, 0);
	light.castShadow = true;
	light.shadow.mapSize.set(2048, 2048);
	light.shadow.bias = -0.0004;
	light.shadow.normalBias = 0.02;
	light.shadow.camera.near = 0.5;
	light.shadow.camera.far =
		Math.max(camera.far, CSM_MAX_FAR) + 2 * CSM_LIGHT_MARGIN;
	const csm = new CSMShadowNode(light, {
		cascades: CSM_CASCADES,
		maxFar: CSM_MAX_FAR,
		mode: "practical",
		lightMargin: CSM_LIGHT_MARGIN,
	});
	csm.fade = true;
	light.shadow.shadowNode = csm;
	return { light, csm };
}

/** Safe to call before the first render: the CSM binds its camera lazily on first build. */
export function updateCsmFrustums(csm: CSMShadowNode): void {
	if (csm.camera !== null) csm.updateFrustums();
}

export interface LoadedEnvironment {
	/** PMREM texture for `scene.environment`. */
	environment: Texture;
	/** `scene.environmentIntensity`. */
	environmentIntensity: number;
	/** `scene.background`: the equirect HDRI for `outdoor`; null for `studio` (it uses `backgroundNode`). */
	background: Texture | Color | null;
	/** `scene.backgroundNode`: the studio's vertical-gradient backdrop. */
	backgroundNode: Node | null;
	/**
	 * `scene.fogNode`: a range fog in the backdrop's horizon colour, so the floor fades into the
	 * backdrop (studio) or into the sky's horizon haze (outdoor) instead of ending in a hard line.
	 */
	fogNode: Node | null;
	dispose(): void;
}

/**
 * Studio look: a photo-studio "infinite cyclorama". The backdrop is a vertical gradient
 * (`STUDIO_HORIZON` at and below eye level, darkening to `STUDIO_ZENITH` overhead) and a
 * view-depth fog in exactly the horizon colour swallows the floor's far edge, so floor and
 * backdrop meet without a seam. Both are linear-space colours fed to the same tone mapping
 * as the scene, which is what makes the join invisible. RoomEnvironment is bright, so it is
 * dimmed to keep white materials below the bloom threshold and leave the sun as the key.
 */
export const STUDIO_HORIZON = "#55504a";
export const STUDIO_ZENITH = "#141416";
export const STUDIO_FOG_NEAR = 14;
export const STUDIO_FOG_FAR = 42;
export const STUDIO_ENV_INTENSITY = 0.4;
/** Outdoor aerial haze: starts past typical play space, reaches full horizon colour by ~100 m. */
export const OUTDOOR_FOG_NEAR = 25;
export const OUTDOOR_FOG_FAR = 110;
// These constants are the renderer's fallbacks when `settings.fog` / `settings.backdrop` are
// absent; scenes override them via `environment.fog` / `environment.backdrop` (sdk ENV_DEFAULTS
// mirrors these values).

/** `settings.fog` resolved against the preset's fallback; null = fog disabled. */
function fogRange(
	settings: RenderSettings,
	near: number,
	far: number,
): { near: number; far: number; color?: string } | null {
	if (settings.fog === false) return null;
	return settings.fog ?? { near, far };
}

function studioBackdrop(settings: RenderSettings): {
	backgroundNode: Node;
	fogNode: Node | null;
} {
	const horizon = color(
		new Color(settings.backdrop?.horizon ?? STUDIO_HORIZON),
	);
	const zenith = color(new Color(settings.backdrop?.zenith ?? STUDIO_ZENITH));
	// The background sphere's normal is the world view direction.
	const t = smoothstep(-0.02, 0.25, normalWorldGeometry.y);
	const f = fogRange(settings, STUDIO_FOG_NEAR, STUDIO_FOG_FAR);
	return {
		backgroundNode: mix(horizon, zenith, t),
		fogNode: f
			? fog(
					f.color !== undefined ? color(new Color(f.color)) : horizon,
					rangeFogFactor(f.near, f.far),
				)
			: null,
	};
}

/**
 * Outdoor haze colour: the HDRI itself, sampled in the fragment's view direction with the
 * elevation clamped to just below the horizon (`OUTDOOR_HAZE_MIN_Y`). A fully fogged far
 * ground fragment therefore takes exactly the sky colour drawn next to it at that azimuth, so
 * the ground's edge disappears into the horizon from any camera angle. One texture sample.
 */
export const OUTDOOR_HAZE_MIN_Y = -0.03;

function outdoorHaze(hdr: Texture): Node {
	const d = positionWorld.sub(cameraPosition).normalize();
	const dir = vec3(d.x, d.y.max(OUTDOOR_HAZE_MIN_Y), d.z).normalize();
	return texture(hdr, equirectUV(dir)).rgb;
}

/**
 * WebGL fallback only: the brightest radiance an HDRI texel may keep before PMREM filtering.
 *
 * `HDRLoader` decodes to half floats, so a sun brighter than the half-float maximum is stored
 * as 65504 (Poly Haven's `qwantani_noon_puresky` has ~30 such texels). In three 0.187 both
 * backends run the same common `PMREMGenerator` with `HalfFloatType` targets, yet empirically
 * only the WebGL backend's PMREM overflows to +Inf on these fp16-max peaks (the exact step is
 * unconfirmed). The +Inf reaches every IBL-lit fragment: it tone-maps to white, the range
 * fog's `mix` turns it into NaN (black), and bloom smears either over the whole frame.
 * Measured on WebGL with a plain clamp: 32768 renders correctly, 60000 does not. This cap
 * (2x below the last good clamp) was validated on WebGL with `spreadEquirectPeaks`.
 */
export const WEBGL_HDR_MAX_RADIANCE = 16384;
const SPREAD_MAX_ITERATIONS = 64;

/** Minimal view of a decoded equirect `DataTexture` image (RGBA, half or 32-bit float). */
export interface EquirectImage {
	data: Uint16Array | Float32Array;
	width: number;
	height: number;
}

/**
 * Caps every texel of an equirect RGBA image at `cap` (on its brightest channel) without
 * losing energy: the excess of an over-cap texel is scattered to its 3x3 neighbourhood,
 * weighted by texel solid angle (cos latitude), and repeated until nothing exceeds `cap`. A
 * point sun becomes a slightly wider disc of the same total power, so diffuse IBL and the
 * specular highlight's energy match the unclamped map; texels away from the peaks are
 * untouched. Non-finite input is not spread (that would smear NaN): +Inf becomes `cap`,
 * -Inf and NaN become 0. `half` says the data is half-float bits. Mutates in place; returns
 * how many texels it changed (0 = nothing exceeded `cap`) and whether every texel ended at or
 * below `cap` (false only if `SPREAD_MAX_ITERATIONS` ran out).
 */
export function spreadEquirectPeaks(
	img: EquirectImage,
	cap: number,
	half: boolean,
): { changed: number; converged: boolean } {
	const { data, width: W, height: H } = img;
	const read = half
		? (i: number) => DataUtils.fromHalfFloat(data[i] as number)
		: (i: number) => data[i] as number;
	const weight = (y: number) => Math.sin((Math.PI * (y + 0.5)) / H);
	// Touched texels live in 32-bit scratch until the end: half floats would clip the
	// accumulating peaks at 65504 and lose energy.
	const work = new Map<number, [number, number, number]>();
	const texel = (t: number): [number, number, number] => {
		let v = work.get(t);
		if (!v) {
			v = [read(t * 4), read(t * 4 + 1), read(t * 4 + 2)];
			for (let c = 0; c < 3; c++) {
				const x = v[c] as number;
				if (!Number.isFinite(x))
					v[c] = x === Number.POSITIVE_INFINITY ? cap : 0;
			}
			work.set(t, v);
		}
		return v;
	};
	const peak = (v: [number, number, number]) => Math.max(v[0], v[1], v[2]);
	let hot: number[] = [];
	for (let t = 0; t < W * H; t++) {
		const o = t * 4;
		const r = read(o);
		const g = read(o + 1);
		const b = read(o + 2);
		if (Math.max(r, g, b) > cap) hot.push(t);
		else if (!Number.isFinite(r + g + b)) texel(t); // -Inf / NaN: sanitised only
	}
	for (let it = 0; it < SPREAD_MAX_ITERATIONS && hot.length > 0; it++) {
		const next = new Set<number>();
		for (const t of hot) {
			const v = texel(t);
			const m = peak(v);
			if (m <= cap) continue;
			const x = t % W;
			const y = (t - x) / W;
			const wy = weight(y);
			const keep = cap / m;
			const k = ((1 - keep) * wy) / 9;
			const [sr, sg, sb] = [v[0] * k, v[1] * k, v[2] * k];
			v[0] *= keep;
			v[1] *= keep;
			v[2] *= keep;
			for (let dy = -1; dy <= 1; dy++) {
				// Past a pole the share stays in this row, so energy is conserved.
				const ny = y + dy < 0 || y + dy >= H ? y : y + dy;
				const wn = weight(ny);
				for (let dx = -1; dx <= 1; dx++) {
					const n = ny * W + ((x + dx + W) % W);
					const nv = texel(n);
					nv[0] += sr / wn;
					nv[1] += sg / wn;
					nv[2] += sb / wn;
					next.add(n);
				}
			}
		}
		hot = [...next].filter((n) => peak(texel(n)) > cap);
	}
	for (const [t, v] of work)
		v.forEach((x, c) => {
			data[t * 4 + c] = half ? DataUtils.toHalfFloat(x) : x;
		});
	return { changed: work.size, converged: hot.length === 0 };
}

/**
 * `outdoor`: `HDRLoader` + `PMREMGenerator` from `settings.hdri`, plus a horizon-coloured haze.
 * `studio` (or an outdoor scene with no `hdri`): dimmed `RoomEnvironment` through PMREM and the
 * gradient-cyclorama backdrop with matched fog.
 * Requires `await renderer.init()` first. Rejects if the HDRI fails to load.
 */
export async function loadEnvironment(
	renderer: WebGPURenderer,
	settings: RenderSettings,
): Promise<LoadedEnvironment> {
	const pmrem = new PMREMGenerator(renderer);
	try {
		if (settings.preset === "outdoor" && settings.hdri) {
			const hdr = await new HDRLoader().loadAsync(settings.hdri);
			hdr.mapping = EquirectangularReflectionMapping;
			if (!isWebGPUBackend(renderer)) {
				// WebGL fallback only (WebGPU output is untouched): see WEBGL_HDR_MAX_RADIANCE.
				const spread = spreadEquirectPeaks(
					hdr.image as EquirectImage,
					WEBGL_HDR_MAX_RADIANCE,
					hdr.type !== FloatType,
				);
				// debug, not warn: `pnpm shot` fails on console warnings.
				if (!spread.converged)
					console.debug(
						`spreadEquirectPeaks: ${settings.hdri} still has texels above ${WEBGL_HDR_MAX_RADIANCE}`,
					);
			}
			const target = pmrem.fromEquirectangular(hdr);
			const f = fogRange(settings, OUTDOOR_FOG_NEAR, OUTDOOR_FOG_FAR);
			return {
				environment: target.texture,
				environmentIntensity: 1,
				background: hdr,
				backgroundNode: null,
				fogNode: f
					? fog(
							f.color !== undefined
								? color(new Color(f.color))
								: outdoorHaze(hdr),
							rangeFogFactor(f.near, f.far),
						)
					: null,
				dispose() {
					target.dispose();
					hdr.dispose();
				},
			};
		}
		const room = new RoomEnvironment();
		const target = pmrem.fromScene(room, 0.04);
		room.dispose();
		return {
			environment: target.texture,
			environmentIntensity: STUDIO_ENV_INTENSITY,
			background: null,
			...studioBackdrop(settings),
			dispose() {
				target.dispose();
			},
		};
	} finally {
		pmrem.dispose();
	}
}

function isWebGPUBackend(renderer: WebGPURenderer): boolean {
	return (
		(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
	);
}

export async function createEnvironment(
	renderer: WebGPURenderer,
	settings: RenderSettings,
): Promise<Texture> {
	return (await loadEnvironment(renderer, settings)).environment;
}

/** Cube face size of the env-from-splat capture (task brief: 256 px). */
export const SPLAT_ENV_CUBE_SIZE = 256;
const SPLAT_ENV_NEAR = 0.05;
const SPLAT_ENV_FAR = 1000;

/**
 * Image-based lighting from a splat capture: a 256 px cube capture of the scene (splat plus the
 * current background, so the sky above the capture still lights from above) from the splat's
 * world bounding-box centre, PMREM-filtered once. Run at load, before meshes are added, so only
 * the capture and sky are seen. The splat must already be in `scene`. The caller owns (and
 * disposes) the returned PMREM target; its `.texture` goes to `scene.environment`.
 */
export function envFromSplat(
	renderer: WebGPURenderer,
	scene: Scene,
	splat: GaussianSplat,
): RenderTarget {
	splat.updateMatrixWorld(true);
	const geometry = splat.splatGeometry;
	if (geometry.boundingBox === null) geometry.computeBoundingBox();
	const box = (geometry.boundingBox ?? new Box3())
		.clone()
		.applyMatrix4(splat.matrixWorld);
	const cubeTarget = new CubeRenderTarget(SPLAT_ENV_CUBE_SIZE, {
		type: HalfFloatType,
	});
	const cubeCamera = new CubeCamera(SPLAT_ENV_NEAR, SPLAT_ENV_FAR, cubeTarget);
	// The six face cameras share the CubeCamera's layers: see meshes (0) and splats.
	cubeCamera.layers.enable(SPLAT_LAYER);
	box.getCenter(cubeCamera.position);
	cubeCamera.updateMatrixWorld(true);
	const pmrem = new PMREMGenerator(renderer);
	try {
		cubeCamera.update(renderer, scene);
		return pmrem.fromCubemap(cubeTarget.texture);
	} finally {
		pmrem.dispose();
		cubeTarget.dispose();
	}
}
