import type { LightingModelDirectInput } from "three/src/nodes/core/LightingModel.js";
import {
	BRDF_Lambert,
	diffuseContribution,
	float,
	fwidth,
	materialReference,
	metalness,
	mix,
	normalView,
	positionViewDirection,
	roughness,
	smoothstep,
	specularColor,
	uniform,
	vec3,
} from "three/tsl";
import {
	LightingModel,
	type Material,
	type Mesh,
	MeshStandardNodeMaterial,
	type Node,
	type NodeBuilder,
	type Object3D,
	type PhysicalLightingModel,
} from "three/webgpu";
import type { ToonSettings } from "../types.ts";
import type { ToonInk } from "./outline.ts";

/** TSL typing escape hatch: the @types node unions do not narrow through the maths. */
const f = (n: unknown): Node<"float"> => n as Node<"float">;
const v3 = (n: unknown): Node<"vec3"> => n as Node<"vec3">;

/**
 * Toon style (opt-in, `post.style: "toon"`): cel-banded mesh lighting, ink outlines (see
 * `style/outline.ts`) and a posterised splat grade (see `style/splat-grade.ts`).
 *
 * Mesh lighting lives in `ToonNodeMaterial`, a `MeshStandardNodeMaterial` whose lighting
 * model quantises the sun term into `bands` tones, adds a stepped (hard-edged) specular and
 * a sun-side rim. Everything else (maps, skinning, colorNode, emissive, env irradiance, AO,
 * shadows, fog) is the standard material's, so a game can swap the class without changing
 * how it drives its materials.
 *
 * The style parameters are page-global uniforms (`TOON`), set from the scene by the renderer
 * and live-tweakable; per-material `toonRim` / `toonSpecular` scale them. One toon style per
 * page: a second renderer's `createRenderer` overwrites them.
 */
export const TOON = {
	bands: uniform(3),
	shadowTone: uniform(0),
	terminator: uniform(0),
	rim: uniform(0.35),
	rimWidth: uniform(0.3),
	specular: uniform(0.6),
};

/** Defaults of `post.toon` (mirrored by the scene schema). */
export const TOON_DEFAULTS: ToonSettings = {
	bands: 3,
	shadowTone: 0,
	terminator: 0,
	rim: 0.35,
	rimWidth: 0.3,
	specular: 0.6,
	outline: {
		enabled: true,
		width: 1,
		color: "#1a1418",
		opacity: 1,
		depthThreshold: 0.04,
		normalThreshold: 0.35,
	},
	splat: {
		levels: 5,
		saturation: 1.15,
		strength: 1,
		shadowTint: "#4a5662",
		highlightTint: "#fff2df",
	},
};

/** Pushes `s` into the global `TOON` uniforms. */
export function setToonUniforms(s: ToonSettings): void {
	TOON.bands.value = Math.max(2, Math.round(s.bands));
	TOON.shadowTone.value = s.shadowTone;
	TOON.terminator.value = s.terminator;
	TOON.rim.value = s.rim;
	TOON.rimWidth.value = s.rimWidth;
	TOON.specular.value = s.specular;
}

/**
 * `x` in [0, 1] quantised into `n` tones (0, 1/(n-1), ..., 1), each step antialiased over
 * one screen-space derivative. Exported for tests of the band count maths.
 */
export function bandsOf(x: Node<"float">, n: Node<"float">): Node<"float"> {
	const y = f(x.clamp().mul(n));
	const w = f(fwidth(y)).clamp(1e-4, 0.5);
	const stairs = f(y.floor()).add(
		f(smoothstep(float(1).sub(w), float(1), y.fract())),
	);
	return f(stairs.min(n.sub(1)).div(n.sub(1)));
}

/** CPU mirror of `bandsOf` without the antialiasing (tests, docs). */
export function bandOf(x: number, n: number): number {
	const y = Math.min(1, Math.max(0, x)) * n;
	return Math.min(Math.floor(y), n - 1) / (n - 1);
}

class CelLightingModel extends LightingModel {
	override direct(
		{ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput,
		_builder: NodeBuilder,
	): void {
		const L = v3(lightDirection);
		const color = v3(lightColor);
		const albedo = v3(BRDF_Lambert({ diffuseColor: diffuseContribution }));
		const dotNL = f(normalView.dot(L));
		const tone = bandsOf(f(dotNL.add(TOON.terminator)), f(TOON.bands));
		const shadowTone = f(TOON.shadowTone);
		const lit = shadowTone.add(shadowTone.oneMinus().mul(tone));
		v3(reflectedLight.directDiffuse).addAssign(color.mul(lit).mul(albedo));

		// Stepped Blinn highlight: one hard-edged blob, larger on rough surfaces.
		const h = L.add(positionViewDirection).normalize();
		const nh = f(normalView.dot(h)).clamp();
		const rough = f(roughness);
		const shin = f(float(2).pow(rough.oneMinus().mul(9).add(2)));
		const s = f(nh.pow(shin));
		const sw = f(fwidth(s)).clamp(1e-4, 0.25);
		const spec = f(smoothstep(float(0.5).sub(sw), float(0.5).add(sw), s))
			.mul(rough.oneMinus())
			.mul(f(TOON.specular))
			.mul(f(materialReference("toonSpecular", "float")))
			.mul(f(smoothstep(0, 0.05, dotNL)));
		v3(reflectedLight.directSpecular).addAssign(color.mul(spec));

		// Sun-side rim: a crisp edge where the silhouette turns away from the viewer.
		const fres = f(normalView.dot(positionViewDirection)).clamp().oneMinus();
		const edge = f(TOON.rimWidth).oneMinus();
		const fw = f(fwidth(fres)).clamp(1e-4, 0.25);
		const rim = f(smoothstep(edge.sub(fw), edge.add(fw), fres))
			.mul(f(smoothstep(-0.1, 0.25, dotNL)))
			.mul(f(TOON.rim))
			.mul(f(materialReference("toonRim", "float")));
		v3(reflectedLight.directDiffuse).addAssign(
			color.mul(rim).mul(vec3(0.25).add(diffuseContribution)).mul(0.25),
		);
	}

	override indirect(builder: NodeBuilder): void {
		const ctx = (
			builder as unknown as {
				context: {
					irradiance: Node<"vec3">;
					iblIrradiance: Node<"vec3">;
					radiance: Node<"vec3">;
					ambientOcclusion: Node<"float">;
					reflectedLight: {
						indirectDiffuse: Node<"vec3">;
						indirectSpecular: Node<"vec3">;
					};
				};
			}
		).context;
		const { reflectedLight: out, ambientOcclusion: occ } = ctx;
		// Ambient: probe/hemisphere irradiance plus the environment's (IBL) irradiance.
		out.indirectDiffuse.addAssign(
			ctx.irradiance
				.add(ctx.iblIrradiance)
				.mul(v3(BRDF_Lambert({ diffuseColor: diffuseContribution }))),
		);
		out.indirectDiffuse.mulAssign(occ);
		// Metals keep a posterised environment reflection (dielectrics get none: no sheen).
		const lum = f(ctx.radiance.dot(vec3(0.2126, 0.7152, 0.0722))).max(1e-4);
		// Reinhard-compressed lightness in [0, 1), banded at twice the sun bands, expanded back.
		const q = bandsOf(f(lum.div(lum.add(1))), f(f(TOON.bands).mul(2)));
		const stepped = q.div(q.oneMinus().max(0.1));
		out.indirectSpecular.addAssign(
			ctx.radiance
				.mul(stepped.div(lum))
				.mul(v3(specularColor))
				.mul(f(metalness))
				.mul(occ),
		);
	}
}

/**
 * A standard (metal/rough) node material lit by the cel model. Drop-in for
 * `MeshStandardNodeMaterial`: same parameters, plus `toonRim` / `toonSpecular` multipliers
 * (default 1) of the global rim and highlight strength.
 */
/** Scene-pass context key under which the pipeline hands `ToonInk` to toon materials. */
export const TOON_INK_CONTEXT = "getToonInk";

export class ToonNodeMaterial extends MeshStandardNodeMaterial {
	static override get type(): string {
		return "ToonNodeMaterial";
	}
	readonly isToonNodeMaterial = true;
	toonRim = 1;
	toonSpecular = 1;

	override setupLightingModel(): PhysicalLightingModel {
		// Typed as the base class's model; the cel model implements the same hooks.
		return new CelLightingModel() as unknown as PhysicalLightingModel;
	}

	/** Lit colour, then the pipeline's ink (scene pass only; opaque materials only). */
	override setupLighting(builder: NodeBuilder): Node {
		const lit = super.setupLighting(builder);
		const get = (builder as unknown as { context: Record<string, unknown> })
			.context[TOON_INK_CONTEXT] as (() => ToonInk | null) | undefined;
		if (!get || this.transparent) return lit;
		// null while this material is drawn into the prepass the ink samples
		const ink = get();
		if (!ink) return lit;
		return mix(v3(lit), ink.color, ink.edge);
	}

	override copy(source: ToonNodeMaterial): this {
		super.copy(source);
		this.toonRim = source.toonRim ?? 1;
		this.toonSpecular = source.toonSpecular ?? 1;
		return this;
	}
}

/** True for materials `toonMaterialFrom` converts (lit metal/rough, classic or node). */
function isConvertible(m: Material): boolean {
	const x = m as {
		isMeshStandardMaterial?: boolean;
		isMeshStandardNodeMaterial?: boolean;
		isToonNodeMaterial?: boolean;
		transmission?: number;
	};
	// Glass keeps its transmission (physical PBR); it has no cel equivalent.
	return (
		x.isToonNodeMaterial !== true &&
		!((x.transmission ?? 0) > 0) &&
		(x.isMeshStandardMaterial === true || x.isMeshStandardNodeMaterial === true)
	);
}

/**
 * A `ToonNodeMaterial` copy of a standard / physical material (classic or node), copied key
 * by key as WebGPURenderer converts classic materials (value objects cloned, textures and
 * nodes shared). Other materials (basic, shadow, already toon) come back unchanged.
 */
export function toonMaterialFrom(src: Material): Material {
	if (!isConvertible(src)) return src;
	const out = new ToonNodeMaterial();
	if ((src as { isNodeMaterial?: boolean }).isNodeMaterial === true) {
		// Node source: NodeMaterial.copy carries the nodes and every material parameter.
		out.copy(src as ToonNodeMaterial);
	} else {
		// Classic source: key by key, as NodeLibrary.fromMaterial does (value objects such
		// as Color are cloned; textures stay shared, one GPU upload per glTF).
		const from = src as unknown as Record<string, unknown>;
		const to = out as unknown as Record<string, unknown>;
		for (const key in from) {
			if (key === "uuid" || key === "id" || key === "type") continue;
			// flags, and the source's event listeners (never shared with the copy)
			if (key.startsWith("is") || key === "_listeners") continue;
			const v = from[key] as { clone?: () => unknown; isTexture?: boolean };
			if (typeof v === "function") continue;
			to[key] =
				v && typeof v.clone === "function" && v.isTexture !== true
					? v.clone()
					: v;
		}
	}
	out.needsUpdate = true;
	return out;
}

/**
 * Swaps every convertible mesh material under `root` for its toon copy (one copy per source
 * material, so sharing is kept). Call before taking references to the materials.
 */
export function stylizeToon(root: Object3D): void {
	const copies = new Map<Material, Material>();
	const swap = (m: Material): Material => {
		let c = copies.get(m);
		if (!c) {
			c = toonMaterialFrom(m);
			copies.set(m, c);
		}
		return c;
	};
	root.traverse((o) => {
		const mesh = o as Mesh;
		if (!mesh.isMesh) return;
		mesh.material = Array.isArray(mesh.material)
			? mesh.material.map(swap)
			: swap(mesh.material);
	});
}
