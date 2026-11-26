import {
	abs,
	dot,
	Fn,
	float,
	materialColor,
	mix,
	positionGeometry,
	select,
	smoothstep,
	vec3,
	vec4,
} from "three/tsl";
import { Color, type Node } from "three/webgpu";

/**
 * The ninja outfit, painted over the Rocketbox swordsman's textures by bind-pose region
 * (mesh space: centimetres, Z up, -Y forward). The source texture only survives as a soft
 * luminance detail on cloth, and as-is on the eyes and fingers.
 */
export const NINJA_PALETTE = {
	gi: "#2b3150",
	giInner: "#4a1a26",
	hakama: "#22263a",
	sash: "#b3192c",
	sashFold: "#6e0f1c",
	wrap: "#d9d0b8",
	wrapLine: "#7d735e",
	shin: "#4b5064",
	shinLine: "#2a2d3a",
	tabi: "#1a1b22",
	glove: "#1e2130",
	hood: "#262b45",
	mask: "#1b1e2c",
	headband: "#d0202f",
} as const;

/** Bind-pose landmarks (cm), from the skin's inverse bind matrices. */
const SHOULDER = [21, 2.5, 142.8] as const;
const ELBOW = [41.6, 1.9, 123] as const;
const WRIST = [58.8, -8.1, 104.6] as const;
/** Head bands (cm): eye slit and headband, measured at the face. */
export const HEAD_BANDS = {
	eyeLo: 166.5,
	eyeHi: 170.4,
	bandLo: 170.6,
	bandHi: 174.2,
};

function col(hex: string): Node<"vec3"> {
	const c = new Color(hex);
	return vec3(c.r, c.g, c.b);
}
const f = (n: unknown): Node<"float"> => n as Node<"float">;
const v3 = (n: unknown): Node<"vec3"> => n as Node<"vec3">;

/** Parameter of `p` along segment a -> b (0 at a, 1 at b). */
function along(
	p: Node<"vec3">,
	a: readonly number[],
	b: readonly number[],
): Node<"float"> {
	const ab = vec3(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0).sub(
		vec3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0),
	);
	return f(
		dot(p.sub(vec3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0)), ab).div(dot(ab, ab)),
	);
}

/** Soft fabric detail from the source texture's luminance (keeps folds and seams). */
function detail(base: Node<"vec3">, k: number): Node<"float"> {
	const lum = f(dot(base, vec3(0.2126, 0.7152, 0.0722)));
	return f(mix(float(1), f(lum.max(0).sqrt()).mul(2.1).clamp(0.55, 1.35), k));
}

/** Wrapped-cloth stripes along `t` (bands per unit), 1 on the cloth, 0 in the seams. */
function stripes(t: Node<"float">, bands: number): Node<"float"> {
	const s = f(t.mul(bands).fract());
	return f(smoothstep(0.0, 0.12, s).mul(smoothstep(1.0, 0.86, s)));
}

/** Colour node for the body material (gi, sash, wraps, gloves, tabi). */
export function ninjaBodyColor(): Node<"vec4"> {
	return Fn(() => {
		const base = materialColor as unknown as Node<"vec4">;
		const p = v3(positionGeometry);
		const ax = f(abs(p.x));
		const ap = vec3(ax, p.y, p.z);
		const d = detail(base.rgb, 0.35);
		const z = f(p.z);

		// torso + trousers
		const gi = col(NINJA_PALETTE.gi).mul(d);
		// crossed collar: a band from the left shoulder down to the right of the sash, front only
		const lapel = f(abs(z.sub(150).add(p.x.add(9).mul(1.9))))
			.lessThan(2.6)
			.and(z.greaterThan(104))
			.and(p.y.lessThan(-2));
		const torso = select(lapel, col(NINJA_PALETTE.giInner), gi);
		const sashBand = f(
			smoothstep(87.5, 88.5, z).mul(smoothstep(100.5, 99.5, z)),
		);
		const sashCol = mix(
			col(NINJA_PALETTE.sashFold),
			col(NINJA_PALETTE.sash),
			stripes(z.add(p.x.mul(0.18)), 0.42)
				.mul(0.6)
				.add(0.4),
		).mul(d);
		const hakama = col(NINJA_PALETTE.hakama).mul(d);
		const shinT = f(z.add(ax.mul(0.6)).add(p.y.mul(0.3)));
		const shin = mix(
			col(NINJA_PALETTE.shinLine),
			col(NINJA_PALETTE.shin),
			stripes(shinT, 0.33),
		);
		const tabi = col(NINJA_PALETTE.tabi).mul(d);
		const legs = select(
			z.lessThan(13),
			tabi,
			select(z.lessThan(47), shin, hakama),
		);
		const trunk = select(
			z.greaterThan(99.5),
			torso,
			select(z.greaterThan(87.5), torso, legs),
		);
		const body = mix(trunk, sashCol, sashBand);

		// arms (A-pose: beyond the chest's width)
		const tFore = along(ap, ELBOW, WRIST);
		const tUpper = along(ap, SHOULDER, ELBOW);
		const wrapCol = mix(
			col(NINJA_PALETTE.wrapLine),
			col(NINJA_PALETTE.wrap),
			stripes(tFore.add(p.y.mul(0.012)), 7.5),
		);
		const arm = select(
			tUpper.lessThan(0.92),
			gi,
			select(
				tFore.lessThan(0.88),
				wrapCol,
				select(tFore.lessThan(1.32), col(NINJA_PALETTE.glove).mul(d), base.rgb),
			),
		);
		const isArm = ax.greaterThan(23).and(z.greaterThan(90));
		// neck under the hood
		const neck = z.greaterThan(145);
		const rgb = select(neck, col(NINJA_PALETTE.mask), select(isArm, arm, body));
		return vec4(rgb, base.a);
	})();
}

/** Colour node for the head material: hood, mask, eye slit, headband. */
export function ninjaHeadColor(): Node<"vec4"> {
	return Fn(() => {
		const base = materialColor as unknown as Node<"vec4">;
		const p = v3(positionGeometry);
		const d = detail(base.rgb, 0.2);
		// the band dips toward the back of the head
		const zb = f(p.z.add(p.y.mul(0.12)));
		const z = f(p.z);
		const front = f(smoothstep(-2, -6, p.y));
		const eye = f(smoothstep(HEAD_BANDS.eyeLo - 0.4, HEAD_BANDS.eyeLo + 0.4, z))
			.mul(smoothstep(HEAD_BANDS.eyeHi + 0.4, HEAD_BANDS.eyeHi - 0.4, z))
			.mul(front)
			.mul(smoothstep(7.2, 6.2, abs(p.x)));
		const band = f(
			smoothstep(HEAD_BANDS.bandLo - 0.3, HEAD_BANDS.bandLo + 0.3, zb),
		).mul(smoothstep(HEAD_BANDS.bandHi + 0.3, HEAD_BANDS.bandHi - 0.3, zb));
		const cloth = select(
			z.lessThan(HEAD_BANDS.eyeLo),
			col(NINJA_PALETTE.mask).mul(d),
			col(NINJA_PALETTE.hood).mul(d),
		);
		const withBand = mix(cloth, col(NINJA_PALETTE.headband).mul(d), band);
		return vec4(mix(withBand, base.rgb, eye), base.a);
	})();
}
