import {
	dot,
	float,
	materialColor,
	mix,
	saturation,
	sin,
	smoothstep,
	uniform,
	uv,
	vec3,
	vec4,
} from "three/tsl";
import { Color, type Node } from "three/webgpu";

/** The zombie treatment (`src/data/zombies.json` `look`). */
export interface ZombieLook {
	saturation: number;
	envIntensity: number;
	/** Sickly skin ramp: `skinShadow` (dark) to `skinTint` (light) by source luminance. */
	skinTint: string;
	skinShadow: string;
	skinGain: number;
	skinMix: number;
	clothDesat: number;
	clothDarken: number;
	grime: string;
	grimeMix: number;
	/** Toon: clothes pulled toward one muted tint, and flat albedo steps (0 = off). */
	clothTint: string;
	clothTintMix: number;
	/** Ragged rot: dark stains and tears over the clothes (0 = off). */
	rot: number;
	flatLevels: number;
}

/** A constant linear-space colour from a CSS hex string. */
function col(hex: string): Node<"vec3"> {
	const c = new Color(hex);
	return vec3(c.r, c.g, c.b);
}

/**
 * A TSL colour node that turns a Rocketbox texture into a zombie: skin, detected by hue
 * (red > green > blue with enough red, but not a saturated red), becomes a sickly grey-green
 * ramp; clothes and hair are desaturated, darkened, dirtied toward a grime colour, pulled
 * toward one dark cloth tint and blotched with rot stains; the result is posterised into `flatLevels` flat albedo steps (toon). Built once
 * and shared by every zombie material (the parameters are uniforms).
 */
export function zombieColorNode(look: ZombieLook): Node<"vec4"> {
	const base = materialColor as unknown as Node<"vec4">;
	const c = saturation(base.rgb, look.saturation);
	const lum = dot(base.rgb, vec3(0.299, 0.587, 0.114));
	const r = base.r;
	const g = base.g;
	const b = base.b;
	const skin = smoothstep(0.008, 0.05, r.sub(g))
		.mul(smoothstep(0.04, 0.14, r.sub(b)))
		.mul(smoothstep(0.06, 0.18, r))
		// skin keeps some green (g/r ~0.3-0.6 linear); saturated red cloth does not
		.mul(smoothstep(0.17, 0.28, g.div(r.max(1e-3))))
		.mul(uniform(look.skinMix));
	const skinCol = mix(
		col(look.skinShadow),
		col(look.skinTint),
		smoothstep(0.02, 0.4, lum.mul(uniform(look.skinGain))),
	);
	const cloth = mix(c, vec3(lum), uniform(look.clothDesat))
		.mul(uniform(look.clothDarken))
		.toVar();
	const dirty = mix(
		cloth,
		col(look.grime).mul(lum.mul(1.6).add(0.2)),
		uniform(look.grimeMix),
	);
	const tinted = mix(
		dirty,
		col(look.clothTint).mul(lum.max(0).sqrt().mul(1.3).add(0.5)),
		uniform(look.clothTintMix),
	);
	// rot: interfering sines over the texture atlas give organic blotches (stains, tears)
	const t = uv();
	const blot = sin(t.x.mul(43.1).add(sin(t.y.mul(17.3)).mul(2.1)))
		.mul(sin(t.y.mul(37.7).add(sin(t.x.mul(23.9)).mul(2.3))))
		.toVar();
	// tears: rotten flesh shows through the rags; the rims around them are grimier
	const tear = smoothstep(0.42, 0.5, blot).mul(uniform(look.rot));
	const rim = smoothstep(0.2, 0.34, blot).mul(uniform(look.rot)).mul(0.6);
	const ragged = mix(
		mix(tinted, col(look.grime).mul(0.3), rim),
		skinCol.mul(0.8),
		tear,
	);
	const rgb = mix(ragged, skinCol, skin).toVar();
	if (look.flatLevels <= 0) return vec4(rgb, base.a);
	// Flat toon albedo: the luminance in a few steps (perceptual), hue kept.
	const l = dot(rgb, vec3(0.2126, 0.7152, 0.0722)).max(1e-4);
	const n = uniform(look.flatLevels);
	const lq = l
		.pow(1 / 2.2)
		.mul(n)
		.round()
		.div(n)
		.max(float(0.5).div(n))
		.pow(2.2);
	return vec4(rgb.mul(lq.div(l)), base.a);
}
