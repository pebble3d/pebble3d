import type { GaussianSplat } from "three/addons/objects/GaussianSplat.js";
import { dot, Fn, mix, uniform, vec3, vec4 } from "three/tsl";
import { Color, type Node } from "three/webgpu";
import type { ToonSettings } from "../types.ts";

const LUMA = vec3(0.2126, 0.7152, 0.0722);

/** `hex` as linear RGB scaled to unit luminance (a pure hue/temperature tint). */
export function unitTint(hex: string): Color {
	const c = new Color(hex);
	const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
	return l > 0 ? c.multiplyScalar(1 / l) : new Color(1, 1, 1);
}

/** CPU mirror of the posterise step: perceptual lightness `l` in [0, 1] to the centre of its band. */
export function posterize(l: number, levels: number): number {
	const x = Math.min(1, Math.max(0, l));
	return (Math.min(Math.floor(x * levels), levels - 1) + 0.5) / levels;
}

/**
 * Painterly grade of a splat to sit with toon-shaded meshes, per splat (colour stage, so it
 * costs nothing per pixel): the lightness is posterised into `levels` flat values (in a
 * gamma-2 perceptual space) while hue and chroma are kept, saturation is pushed, and a
 * split tone runs from a cool `shadowTint` to a warm `highlightTint`. `strength` blends the
 * whole grade with the source colour. Overlapping splats then read as broad flat strokes.
 */
export function applySplatGrade(
	splat: GaussianSplat,
	g: ToonSettings["splat"],
): void {
	const material = splat.material;
	const source = material.colorNode as Node<"vec4">;
	const levels = uniform(Math.max(2, g.levels));
	const sat = uniform(g.saturation);
	const strength = uniform(g.strength);
	const shadow = uniform(unitTint(g.shadowTint));
	const high = uniform(unitTint(g.highlightTint));
	material.colorNode = Fn(() => {
		const c = source.toVar("splatGraded");
		const rgb = c.rgb.max(0);
		const l = dot(rgb, LUMA).max(1e-5);
		// Gamma-2 perceptual space (sqrt / square: no pow per fragment; splats overdraw a lot).
		const lp = l.sqrt().clamp();
		// bin centres: each band keeps its mean lightness (rounding to edges lifted dark scenes)
		const lq = lp.mul(levels).floor().min(levels.sub(1)).add(0.5).div(levels);
		const poster = rgb.mul(lq.mul(lq).div(l));
		const grey = dot(poster, LUMA);
		const toned = mix(vec3(grey), poster, sat).mul(
			mix(shadow, high, lp.clamp(0.15, 0.85).sub(0.15).div(0.7)),
		);
		return vec4(mix(rgb, toned, strength), c.a);
	})();
	material.needsUpdate = true;
}
