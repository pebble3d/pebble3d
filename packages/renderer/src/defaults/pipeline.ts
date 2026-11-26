import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import {
	builtinAOContext,
	context,
	float,
	getViewPosition,
	max,
	mrt,
	normalView,
	pass,
	renderOutput,
	rtt,
	screenUV,
	select,
	sRGBTransferEOTF,
	sRGBTransferOETF,
	uniform,
	vec4,
} from "three/tsl";
import {
	ACESFilmicToneMapping,
	AgXToneMapping,
	type Node,
	NoToneMapping,
	type PerspectiveCamera,
	RenderPipeline,
	type Scene,
	type ToneMapping,
	type WebGPURenderer,
} from "three/webgpu";
import { toonInk } from "../style/outline.ts";
import { TOON_INK_CONTEXT } from "../style/toon.ts";
import type { RenderSettings } from "../types.ts";

/**
 * Splats live on this camera layer (meshes stay on layer 0). The main camera enables it; the
 * env-from-splat cube camera enables it; `?debug=splatOnly` renders only it. The AO prepass
 * leaves splats out by skipping transparent objects (see createPipeline).
 */
export const SPLAT_LAYER = 1;
export const AO_RESOLUTION_SCALE = 0.5;
export const AO_DENOISE_SCALE = 0.5;
export const BLOOM_RADIUS = 0.3;

export function toneMappingOf(
	name: RenderSettings["toneMapping"],
): ToneMapping {
	switch (name) {
		case "agx":
			return AgXToneMapping;
		case "aces":
			return ACESFilmicToneMapping;
		default:
			return NoToneMapping;
	}
}

/**
 * Single-composite design: one scene pass holds meshes and splats (splats depth-test,
 * no depth write). Ambient occlusion: GTAO at half resolution from a mesh-only MRT normal+depth
 * prepass (splat layer masked out), fed into the scene pass lighting through
 * `builtinAOContext`, never as a post multiply. Then bloom, then tone mapping + output colour
 * space via an explicit `renderOutput` node (from `renderer.toneMapping` /
 * `toneMappingExposure`), then SMAA last so it filters display-referred colour.
 * `outputColorTransform` is disabled so tone mapping happens exactly once.
 */
export function createPipeline(
	renderer: WebGPURenderer,
	scene: Scene,
	camera: PerspectiveCamera,
	settings: RenderSettings,
	opts: { splatOnly?: boolean } = {},
): RenderPipeline {
	return buildPipeline(renderer, scene, camera, settings, opts).pipeline;
}

/**
 * Opt-in depth of field (photo modes). Off by default and free while off: the DOF chain is
 * built the first time `enabled` is set and the pipeline output swaps between the plain and
 * the DOF chain when `enabled` changes (`EngineRenderer.render` applies it).
 *
 * Splats write no depth, so a pixel with no mesh depth gets a proxy distance: where the view
 * ray hits the capture floor (`floorY`) that hit distance, else (sky, walls, far backdrop)
 * `backdrop` metres. Ground splats then blur with their real distance.
 */
export interface DepthOfFieldControls {
	enabled: boolean;
	/** Focus distance, metres along the view direction. */
	focus: { value: number };
	/** Metres from the focal plane to full blur. */
	range: { value: number };
	/** Bokeh size (unitless). */
	bokeh: { value: number };
	/** Proxy distance (metres) of depthless pixels whose view ray misses the floor. Every
	 * pixel without depth is treated this way, including transparent meshes that do not
	 * write depth (additive glows, particles): they blur like the floor or backdrop behind
	 * them even when their own distance is in focus. */
	backdrop: { value: number };
}

export const DOF_DEFAULTS = {
	focus: 5,
	range: 3,
	bokeh: 1,
	backdrop: 30,
} as const;

/**
 * View-space z (negative, metres) of the floor-plane proxy for a depthless pixel. `dirView`
 * is the view-space ray, `dirWorldY` its world y, both for the same (unnormalised) ray from
 * the camera at world height `camY`. CPU mirror of the TSL node in `buildPipeline` (tests).
 */
export function floorProxyViewZ(
	dirViewZ: number,
	dirWorldY: number,
	camY: number,
	floorY: number,
	backdrop: number,
): number {
	if (dirWorldY > -1e-4) return -backdrop;
	const t = (floorY - camY) / dirWorldY;
	if (t <= 0) return -backdrop;
	return Math.max(dirViewZ * t, -backdrop);
}

export interface BuiltPipeline {
	pipeline: RenderPipeline;
	dof: DepthOfFieldControls;
	/** Applies a changed `dof.enabled` (call once per frame before rendering). */
	applyDof(): void;
	/** Disposes the pipeline and, if it was ever built, the DOF chain. */
	dispose(): void;
}

export function buildPipeline(
	renderer: WebGPURenderer,
	scene: Scene,
	camera: PerspectiveCamera,
	settings: RenderSettings,
	opts: { splatOnly?: boolean } = {},
): BuiltPipeline {
	const dofControls: DepthOfFieldControls = {
		enabled: false,
		focus: uniform(DOF_DEFAULTS.focus),
		range: uniform(DOF_DEFAULTS.range),
		bokeh: uniform(DOF_DEFAULTS.bokeh),
		backdrop: uniform(DOF_DEFAULTS.backdrop),
	};
	if (opts.splatOnly) {
		const pipeline = createSplatOnlyPipeline(renderer, scene, camera);
		return {
			pipeline,
			dof: dofControls,
			applyDof: () => {},
			dispose: () => pipeline.dispose(),
		};
	}
	renderer.toneMapping = toneMappingOf(settings.toneMapping);
	renderer.toneMappingExposure = settings.exposure;
	camera.layers.enable(SPLAT_LAYER);

	const scenePass = pass(scene, camera);

	// Mesh-only normal + depth prepass: feeds GTAO and, in the toon style, the ink outlines.
	const outline = settings.toon?.outline.enabled ? settings.toon.outline : null;
	let prePass: ReturnType<typeof pass> | null = null;
	if (settings.ao.enabled || outline) {
		prePass = pass(scene, camera);
		// The prepass draws opaque meshes only. Splats (transparent, no depth write) must not
		// feed GTAO, and neither should other transparents. Masking the splat layer with
		// `prePass.setLayers()` instead made the splat vanish from the scene pass that shares
		// this camera (three 0.187), so the transparent list is skipped instead.
		prePass.transparent = false;
		prePass.setMRT(mrt({ output: normalView }));
	}

	if (settings.ao.enabled && prePass) {
		const aoPass = ao(
			prePass.getTextureNode("depth"),
			prePass.getTextureNode(),
			camera,
		);
		aoPass.resolutionScale = AO_RESOLUTION_SCALE;
		aoPass.radius.value = settings.ao.radius;
		// GTAO's per-pixel noise reads as a speckled ring on curved silhouettes. A depth- and
		// normal-aware denoise, baked to a texture at AO_DENOISE_SCALE, removes it.
		const aoDenoised = rtt(
			denoise(
				aoPass.getTextureNode(),
				prePass.getTextureNode("depth"),
				prePass.getTextureNode(),
				camera,
			),
		).setResolutionScale(AO_DENOISE_SCALE);
		scenePass.contextNode = builtinAOContext(aoDenoised.sample(screenUV).r);
	}
	if (outline && prePass) {
		// Toon ink: the opaque ToonNodeMaterials of the scene pass ink themselves from the
		// prepass (so transparent effects drawn later cover the lines, not the reverse).
		const ink = toonInk(
			prePass.getTextureNode("depth"),
			prePass.getTextureNode(),
			camera,
			() => renderer.getPixelRatio(),
			outline,
		);
		// (null node: a pure context, as builtinAOContext builds; merged with the AO context)
		// The prepass is rendered on demand from inside the scene pass, under its context:
		// materials drawn into the prepass itself must not sample it.
		const preTarget = prePass.renderTarget;
		scenePass.contextNode = context(scenePass.contextNode as unknown as Node, {
			[TOON_INK_CONTEXT]: () =>
				renderer.getRenderTarget() === preTarget ? null : ink,
		});
	}

	const color = scenePass.getTextureNode();
	let out: Node = color;
	if (settings.bloom.enabled) {
		out = color.add(
			bloom(
				color,
				settings.bloom.strength,
				BLOOM_RADIUS,
				settings.bloom.threshold,
			),
		);
	}
	// The final display chain (tone mapped, display-referred; toon ink is already in the scene
	// colour). Depth of field wraps `display`, so it blurs the styled image; SMAA stays last.
	const display: Node = renderOutput(out);
	const plain = smaa(display);
	const pipeline = new RenderPipeline(renderer, plain);
	pipeline.outputColorTransform = false;

	let withDof: Node | null = null;
	let applied = false;
	const applyDof = (): void => {
		if (dofControls.enabled === applied) return;
		applied = dofControls.enabled;
		if (applied && !withDof)
			withDof = smaa(
				depthOfField(
					display,
					scenePass,
					camera,
					settings.splat?.floorY ?? 0,
					dofControls,
				),
			);
		pipeline.outputNode = applied && withDof ? withDof : plain;
		pipeline.needsUpdate = true;
	};
	const dispose = (): void => {
		// RenderPipeline.dispose only frees its quad material: the DOF chain's render targets
		// (built on first enable) are freed here.
		withDof?.traverse((n) => (n as { dispose?: () => void }).dispose?.());
		withDof = null;
		pipeline.dispose();
	};
	return { pipeline, dof: dofControls, applyDof, dispose };
}

/**
 * Depth of field over a display node: self-contained, takes the final display chain and
 * returns it blurred by distance. Mesh pixels use the scene pass depth; depthless (splat)
 * pixels use where the view ray hits the capture floor at `floorY`, else `backdrop` metres
 * (CPU mirror: `floorProxyViewZ`).
 */
export function depthOfField(
	display: Node,
	scenePass: ReturnType<typeof pass>,
	camera: PerspectiveCamera,
	floorY: number,
	c: DepthOfFieldControls,
): Node {
	// Uniforms over the scene camera's own matrices: inside the post quad the camera nodes
	// would describe the quad's camera.
	const projInv = uniform(camera.projectionMatrixInverse);
	const camWorld = uniform(camera.matrixWorld);
	const depth = scenePass.getTextureNode("depth").sample(screenUV).r;
	const dirView = getViewPosition(screenUV, float(1), projInv);
	const dirWorldY = camWorld.mul(vec4(dirView, 0)).y;
	const camY = camWorld.mul(vec4(0, 0, 0, 1)).y;
	const t = uniform(floorY).sub(camY).div(dirWorldY.min(-1e-4));
	const backdrop = c.backdrop as unknown as Node<"float">;
	const hit = max(dirView.z.mul(t), backdrop.negate());
	const proxyZ = select(
		dirWorldY.lessThan(-1e-4).and(t.greaterThan(0)),
		hit,
		backdrop.negate(),
	);
	const viewZ = select(
		depth.lessThan(0.999999),
		scenePass.getViewZNode(),
		proxyZ,
	);
	// `display` is display-referred (tone mapped, sRGB-encoded): blur in linear light so
	// highlights spread and out-of-focus edges do not darken, then re-encode.
	const blurred = dof(
		sRGBTransferEOTF(display as Node<"vec4">),
		viewZ,
		c.focus as unknown as Node<"float">,
		c.range as unknown as Node<"float">,
		c.bokeh as unknown as Node<"float">,
	);
	const b = blurred as unknown as Node<"vec4">;
	return vec4(sRGBTransferOETF(b.rgb) as Node<"vec3">, b.a);
}

/**
 * `?debug=splatOnly` colour reference: the camera sees only the splat layer (and the
 * background), with no AO, bloom, SMAA or tone mapping, just the sRGB output encode. With the
 * splat's exposure/saturation at 1 this shows the captured colours as stored.
 */
function createSplatOnlyPipeline(
	renderer: WebGPURenderer,
	scene: Scene,
	camera: PerspectiveCamera,
): RenderPipeline {
	renderer.toneMapping = NoToneMapping;
	renderer.toneMappingExposure = 1;
	camera.layers.set(SPLAT_LAYER);
	return new RenderPipeline(renderer, pass(scene, camera).getTextureNode());
}
