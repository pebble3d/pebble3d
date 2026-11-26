import { type BlockSpec, KINDS } from "./blocks.ts";
import type { SiteView } from "./host.ts";

const STRIDE = 8;

/**
 * Ray against every block's oriented box (from the view's current state) and the ground
 * plane: the distance to the first hit, or -1. Runs on the main thread from pointer moves,
 * so it works the same for an inline Site and a worker mirror. Allocation-free.
 */
export function pickRay(
	view: SiteView,
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number,
	max: number,
): number {
	let best = dy < -1e-6 ? -oy / dy : Number.POSITIVE_INFINITY;
	if (best < 0) best = Number.POSITIVE_INFINITY;
	const c = view.curr;
	for (let i = 0; i < view.n; i++) {
		const o = (view.slots[i] as number) * STRIDE;
		const px = c[o] as number;
		const py = c[o + 1] as number;
		const pz = c[o + 2] as number;
		const h = (KINDS[(view.blocks[i] as BlockSpec).kind] as { half: number[] })
			.half;
		const hx = h[0] as number;
		const hy = h[1] as number;
		const hz = h[2] as number;
		// Cheap sphere reject first.
		const rx = px - ox;
		const ry = py - oy;
		const rz = pz - oz;
		const tc = rx * dx + ry * dy + rz * dz;
		const r2 = hx * hx + hy * hy + hz * hz;
		const d2 = rx * rx + ry * ry + rz * rz - tc * tc;
		if (d2 > r2 || tc < -2) continue;
		// Ray into the box frame: rotate by the inverse (conjugate) quaternion.
		const qx = -(c[o + 3] as number);
		const qy = -(c[o + 4] as number);
		const qz = -(c[o + 5] as number);
		const qw = c[o + 6] as number;
		const l = rotate(qx, qy, qz, qw, -rx, -ry, -rz);
		const lox = l0;
		const loy = l1;
		const loz = l2;
		rotate(qx, qy, qz, qw, dx, dy, dz);
		const t = slab(lox, loy, loz, l0, l1, l2, hx, hy, hz);
		if (l !== 0 && t >= 0 && t < best) best = t;
	}
	return best <= max ? best : -1;
}

let l0 = 0;
let l1 = 0;
let l2 = 0;

/** Rotates v by quaternion q into (l0, l1, l2). Returns 1. */
function rotate(
	qx: number,
	qy: number,
	qz: number,
	qw: number,
	vx: number,
	vy: number,
	vz: number,
): number {
	const tx = 2 * (qy * vz - qz * vy);
	const ty = 2 * (qz * vx - qx * vz);
	const tz = 2 * (qx * vy - qy * vx);
	l0 = vx + qw * tx + (qy * tz - qz * ty);
	l1 = vy + qw * ty + (qz * tx - qx * tz);
	l2 = vz + qw * tz + (qx * ty - qy * tx);
	return 1;
}

/** Ray (o, d) against the box [-h, h]: entry distance (0 when inside), or -1. */
function slab(
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number,
	hx: number,
	hy: number,
	hz: number,
): number {
	tmin = 0;
	tmax = Number.POSITIVE_INFINITY;
	if (!axis(ox, dx, hx) || !axis(oy, dy, hy) || !axis(oz, dz, hz)) return -1;
	return tmin;
}

let tmin = 0;
let tmax = 0;

function axis(o: number, d: number, h: number): boolean {
	if (Math.abs(d) < 1e-9) return o >= -h && o <= h;
	let t1 = (-h - o) / d;
	let t2 = (h - o) / d;
	if (t1 > t2) {
		const x = t1;
		t1 = t2;
		t2 = x;
	}
	if (t1 > tmin) tmin = t1;
	if (t2 < tmax) tmax = t2;
	return tmin <= tmax;
}
