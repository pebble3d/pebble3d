import { BUILD_CLEAR, CELL, CELLS, CORE_X, CORE_Z, HALF } from "./constants.ts";

/** Arc-length sample spacing of a resampled path (metres). */
export const STEP = 0.5;

/** Control points: two rifts at the far corners that merge into one serpentine trunk to the core. */
const TRUNK: readonly (readonly [number, number])[] = [
	[0, -10],
	[-12, -2],
	[-15, 8],
	[-6, 15],
	[8, 12],
	[17, 18],
	[12, 27],
	[CORE_X, CORE_Z],
];
const ARM_A: readonly (readonly [number, number])[] = [
	[-37, -37],
	[-27, -35],
	[-19, -28],
	[-24, -18],
	[-13, -13],
];
const ARM_B: readonly (readonly [number, number])[] = [
	[37, -37],
	[27, -35],
	[19, -28],
	[24, -18],
	[13, -13],
];

/** A path resampled every STEP metres: position, unit tangent and yaw per sample. */
export interface PathSamples {
	readonly n: number;
	readonly length: number;
	readonly x: Float32Array;
	readonly z: Float32Array;
	readonly tx: Float32Array;
	readonly tz: Float32Array;
	readonly yaw: Float32Array;
}

function catmull(
	p0: number,
	p1: number,
	p2: number,
	p3: number,
	t: number,
): number {
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		0.5 *
		(2 * p1 +
			(-p0 + p2) * t +
			(2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
			(-p0 + 3 * p1 - 3 * p2 + p3) * t3)
	);
}

/** Catmull-Rom through `pts`, then resampled at equal arc length. Deterministic (pure math). */
export function buildPath(
	pts: readonly (readonly [number, number])[],
): PathSamples {
	const dense: number[] = [];
	const SUB = 32;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[Math.max(0, i - 1)] as readonly [number, number];
		const p1 = pts[i] as readonly [number, number];
		const p2 = pts[i + 1] as readonly [number, number];
		const p3 = pts[Math.min(pts.length - 1, i + 2)] as readonly [
			number,
			number,
		];
		for (let k = 0; k < SUB; k++) {
			const t = k / SUB;
			dense.push(
				catmull(p0[0], p1[0], p2[0], p3[0], t),
				catmull(p0[1], p1[1], p2[1], p3[1], t),
			);
		}
	}
	const last = pts[pts.length - 1] as readonly [number, number];
	dense.push(last[0], last[1]);
	const m = dense.length / 2;
	const cum = new Float64Array(m);
	for (let i = 1; i < m; i++)
		cum[i] =
			(cum[i - 1] as number) +
			Math.hypot(
				(dense[i * 2] as number) - (dense[i * 2 - 2] as number),
				(dense[i * 2 + 1] as number) - (dense[i * 2 - 1] as number),
			);
	const length = cum[m - 1] as number;
	const n = Math.floor(length / STEP) + 2;
	const x = new Float32Array(n);
	const z = new Float32Array(n);
	let j = 0;
	for (let i = 0; i < n; i++) {
		const s = Math.min(length, i * STEP);
		while (j < m - 2 && (cum[j + 1] as number) < s) j++;
		const seg = (cum[j + 1] as number) - (cum[j] as number);
		const f = seg > 0 ? (s - (cum[j] as number)) / seg : 0;
		x[i] =
			(dense[j * 2] as number) +
			((dense[j * 2 + 2] as number) - (dense[j * 2] as number)) * f;
		z[i] =
			(dense[j * 2 + 1] as number) +
			((dense[j * 2 + 3] as number) - (dense[j * 2 + 1] as number)) * f;
	}
	const tx = new Float32Array(n);
	const tz = new Float32Array(n);
	const yaw = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const a = Math.max(0, i - 2);
		const b = Math.min(n - 1, i + 2);
		let dx = (x[b] as number) - (x[a] as number);
		let dz = (z[b] as number) - (z[a] as number);
		const l = Math.hypot(dx, dz) || 1;
		dx /= l;
		dz /= l;
		tx[i] = dx;
		tz[i] = dz;
		yaw[i] = Math.atan2(dx, dz);
	}
	return { n, length, x, z, tx, tz, yaw };
}

/** The two enemy routes (rift A and rift B, sharing the trunk). */
export function buildPaths(): [PathSamples, PathSamples] {
	return [buildPath([...ARM_A, ...TRUNK]), buildPath([...ARM_B, ...TRUNK])];
}

/** Scenery outcrops: [x, z, half extent]. Static colliders; their cells are not buildable. */
export const ROCKS: readonly (readonly [number, number, number])[] = [
	[-31, -24, 2.2],
	[30, -22, 2.4],
	[-6, -30, 2.8],
	[7, -24, 1.8],
	[-33, 6, 2.6],
	[32, 4, 2.2],
	[-26, 24, 2.4],
	[28, 30, 2.0],
	[3, 2, 1.6],
	[-2, 24, 1.5],
	[24, -6, 1.6],
	[-35, -6, 1.4],
];

export function cellCenter(cell: number): [number, number] {
	const i = cell % CELLS;
	const k = Math.floor(cell / CELLS);
	return [-HALF + CELL * (i + 0.5), -HALF + CELL * (k + 0.5)];
}

export function cellAt(x: number, z: number): number {
	const i = Math.floor((x + HALF) / CELL);
	const k = Math.floor((z + HALF) / CELL);
	if (i < 0 || k < 0 || i >= CELLS || k >= CELLS) return -1;
	return k * CELLS + i;
}

/** Distance from (x,z) to the nearest sample of either path. */
export function pathDistance(
	paths: readonly PathSamples[],
	x: number,
	z: number,
): number {
	let best = 1e9;
	for (const p of paths)
		for (let i = 0; i < p.n; i++) {
			const d = ((p.x[i] as number) - x) ** 2 + ((p.z[i] as number) - z) ** 2;
			if (d < best) best = d;
		}
	return Math.sqrt(best);
}

/** 1 where a tower may stand: off the lanes, away from the core and the outcrops, inside the edge. */
export function buildMask(paths: readonly PathSamples[]): Uint8Array {
	const mask = new Uint8Array(CELLS * CELLS);
	for (let c = 0; c < mask.length; c++) {
		const [x, z] = cellCenter(c);
		if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) continue;
		if (Math.hypot(x - CORE_X, z - CORE_Z) < 5) continue;
		let rock = false;
		for (const r of ROCKS)
			if (Math.abs(x - r[0]) < r[2] + 1 && Math.abs(z - r[1]) < r[2] + 1)
				rock = true;
		if (rock) continue;
		if (pathDistance(paths, x, z) < BUILD_CLEAR) continue;
		mask[c] = 1;
	}
	return mask;
}
