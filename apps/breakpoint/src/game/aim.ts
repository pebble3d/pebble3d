import { GRAVITY } from "./constants.ts";

type V3 = readonly [number, number, number];

/**
 * Launch velocity from `from` that hits `to` at `speed` on the low (flat) arc. When the target
 * is out of reach at that speed the ball goes out at 45° towards it (maximum range) and falls
 * short. Components are rounded to f32 so the shot replays bit-identically.
 */
export function aimVelocity(
	from: V3,
	to: V3,
	speed: number,
	out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
	const dx = to[0] - from[0];
	const dz = to[2] - from[2];
	const h = to[1] - from[1];
	const d = Math.hypot(dx, dz) || 1e-6;
	const v2 = speed * speed;
	const disc = v2 * v2 - GRAVITY * (GRAVITY * d * d + 2 * h * v2);
	const theta =
		disc >= 0 ? Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * d)) : Math.PI / 4;
	const c = Math.cos(theta);
	out[0] = Math.fround((speed * c * dx) / d);
	out[1] = Math.fround(speed * Math.sin(theta));
	out[2] = Math.fround((speed * c * dz) / d);
	return out;
}

/** Whether `to` is reachable from `from` at `speed`. */
export function reachable(from: V3, to: V3, speed: number): boolean {
	const d = Math.hypot(to[0] - from[0], to[2] - from[2]);
	const h = to[1] - from[1];
	const v2 = speed * speed;
	return v2 * v2 - GRAVITY * (GRAVITY * d * d + 2 * h * v2) >= 0;
}

/**
 * Samples the ballistic arc into `out` (xyz triples) every `dt` seconds until it drops below
 * y = 0 or `out` is full. Returns the number of points written. Allocation-free.
 */
export function sampleArc(
	from: V3,
	vel: V3,
	dt: number,
	out: Float32Array,
): number {
	const max = Math.floor(out.length / 3);
	let n = 0;
	for (; n < max; n++) {
		const t = n * dt;
		const y = from[1] + vel[1] * t - 0.5 * GRAVITY * t * t;
		out[n * 3] = from[0] + vel[0] * t;
		out[n * 3 + 1] = y;
		out[n * 3 + 2] = from[2] + vel[2] * t;
		if (y < 0) return n + 1;
	}
	return n;
}
