import { COLLAPSE, RINGS, TILE } from "./constants.ts";
import { Rng } from "./rng.ts";

/** One hex tile of the arena, in the arena's own (unrotated) frame. */
export interface TileDef {
	/** Centre on the XZ plane (m). */
	x: number;
	z: number;
	/** 0 = the centre tile, RINGS-1 = the rim. */
	ring: number;
	/** Fight tick this tile starts to fall. */
	dropTick: number;
	/** Fight tick the warning (shake + glow) starts. */
	warnTick: number;
	/** Visual column length under the slab (m), seeded. */
	root: number;
	/** Tumble axis (unit XZ) and spin rate (rad/tick) while falling, seeded. */
	ax: number;
	az: number;
	tumble: number;
	/** Shake phase, seeded. */
	phase: number;
}

const SQRT3 = Math.sqrt(3);

/** Ring index of axial hex coordinates. */
export function hexRing(q: number, r: number): number {
	return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

/** Fight tick at which ring `ring` drops (outer rings first). */
export function ringDropTick(ring: number): number {
	return COLLAPSE.first + COLLAPSE.every * (RINGS - 1 - ring);
}

/**
 * The arena layout for a seed: pointy-top hexes in rings around the centre, each with a
 * seeded column length, drop order within its ring, and tumble. Pure data, no physics.
 */
export function buildArena(seed: number): TileDef[] {
	const rng = new Rng(seed ^ 0xa7e4a);
	const tiles: TileDef[] = [];
	const R = TILE.radius;
	const N = RINGS - 1;
	for (let r = -N; r <= N; r++) {
		for (let q = -N; q <= N; q++) {
			const ring = hexRing(q, r);
			if (ring > N) continue;
			tiles.push({
				x: R * SQRT3 * (q + r / 2),
				z: R * 1.5 * r,
				ring,
				dropTick: 0,
				warnTick: 0,
				root: 0,
				ax: 1,
				az: 0,
				tumble: 0,
				phase: 0,
			});
		}
	}
	// ring order, then angle, so the layout and every seeded draw are stable
	tiles.sort(
		(a, b) => a.ring - b.ring || Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x),
	);
	for (const t of tiles) {
		const base = ringDropTick(t.ring);
		t.dropTick = base + Math.floor(rng.next() * COLLAPSE.spread);
		t.warnTick = base - COLLAPSE.warn;
		// longer columns toward the middle: the island reads as a hanging basalt cluster
		t.root = 1.2 + (RINGS - t.ring) * 0.9 + rng.next() * 2.4;
		const a = rng.next() * Math.PI * 2;
		t.ax = Math.cos(a);
		t.az = Math.sin(a);
		t.tumble = 0.006 + rng.next() * 0.02;
		t.phase = rng.next() * Math.PI * 2;
	}
	return tiles;
}

/** Hex corner `k` (0..5) of a pointy-top tile of circumradius `r`: [x, z]. */
export function hexCorner(k: number, r: number): [number, number] {
	const a = Math.PI / 6 + (Math.PI / 3) * k;
	return [r * Math.cos(a), r * Math.sin(a)];
}

/** Flat convex-hull points of one slab, centred on its body origin. */
export function tileHullPoints(): number[] {
	const pts: number[] = [];
	const h = TILE.height / 2;
	for (let k = 0; k < 6; k++) {
		const [x, z] = hexCorner(k, TILE.radius);
		pts.push(x, h, z, x, -h, z);
	}
	return pts;
}

/** Radius of the standing arena after `collapsed` rings have dropped (m, to the flat edge). */
export function arenaRadius(rings: number): number {
	if (rings <= 0) return 0;
	return TILE.radius * SQRT3 * (rings - 0.5);
}
