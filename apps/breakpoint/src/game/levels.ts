import {
	type BlockSpec,
	KIND,
	KINDS,
	type Kind,
	STONES,
	type Stone,
} from "./blocks.ts";
import { Rng } from "./rng.ts";

/**
 * Procedural demolition sites. Every level is a seeded set of separate structures (each its
 * own physics island, so one hit wakes only what it touches) built from a handful of block
 * kinds. Courses sit exactly on each other; blocks within a course keep a small gap so the
 * solver starts without side friction fights.
 */

export interface LevelDef {
	id: string;
	name: string;
	subtitle: string;
	/** Score line height (m): mass that starts above it and ends below it counts. */
	line: number;
	/** Shots allowed. */
	shots: number;
	/** Fraction of the above-line mass to clear the level (1 star). */
	par: number;
	/** Where the launcher sits and what the demo bot aims at, per shot. */
	launcher: [number, number, number];
	botTargets: [number, number, number][];
	/** Bot shot speed per shot (m/s). */
	botSpeeds: number[];
	build(seed: number): BlockSpec[];
}

/** Brick dimensions (see KINDS). */
const BL = 0.9;
const BW = 0.45;
const BH = 0.45;
/** Horizontal gap between neighbouring blocks in a course. */
const GAP = 0.012;

class Builder {
	readonly out: BlockSpec[] = [];
	readonly rng: Rng;
	stone: Stone = STONES.sandstone;
	constructor(seed: number) {
		this.rng = new Rng(seed);
	}
	add(kind: Kind, x: number, y: number, z: number, yaw = 0): void {
		this.out.push({
			kind,
			x,
			y,
			z,
			yaw,
			stone: this.stone,
			tint: this.rng.next(),
		});
	}

	/**
	 * Hollow square tower in English-bond-like courses: even courses run the N/S faces
	 * full width, odd courses the E/W faces, so corners interlock. Outer size n*BL.
	 * Returns the top y.
	 */
	tower(
		cx: number,
		cz: number,
		n: number,
		courses: number,
		y0 = 0,
		crenel = true,
	): number {
		const D = n * BL;
		for (let c = 0; c < courses; c++) {
			const y = y0 + BH / 2 + c * BH;
			const even = c % 2 === 0;
			for (let side = 0; side < 4; side++) {
				const alongX = side < 2 === even;
				const sign = side % 2 === 0 ? 1 : -1;
				const full = side < 2;
				const count = full ? n : n - 1;
				const span = count * BL;
				for (let i = 0; i < count; i++) {
					const t = -span / 2 + BL / 2 + i * BL;
					const off = sign * (D / 2 - BW / 2);
					if (alongX) this.add(KIND.BRICK, cx + t, y, cz + off, 0);
					else this.add(KIND.BRICK, cx + off, y, cz + t, Math.PI / 2);
				}
			}
		}
		let top = y0 + courses * BH;
		if (crenel) {
			// Merlons: half bricks at every other position around the rim.
			const y = top + BH / 2;
			const steps = n * 2;
			for (let i = 0; i < steps; i += 2) {
				const t = -D / 2 + BW / 2 + i * BW;
				const o = D / 2 - BW / 2;
				this.add(KIND.HALF, cx + t, y, cz + o);
				this.add(KIND.HALF, cx - t, y, cz - o);
				this.add(KIND.HALF, cx + o, y, cz - t);
				this.add(KIND.HALF, cx - o, y, cz + t);
			}
			top += BH;
		}
		return top;
	}

	/**
	 * Two-row wall along X (or Z when `alongZ`), running bond: odd courses shift half a brick
	 * and close the ends with half bricks. `n` bricks per row.
	 */
	wall(
		cx: number,
		cz: number,
		n: number,
		courses: number,
		alongZ = false,
		y0 = 0,
	): number {
		const len = n * BL;
		for (let c = 0; c < courses; c++) {
			const y = y0 + BH / 2 + c * BH;
			const odd = c % 2 === 1;
			for (let row = 0; row < 2; row++) {
				const o = (row - 0.5) * (BW + GAP);
				const items: [Kind, number][] = [];
				if (!odd)
					for (let i = 0; i < n; i++)
						items.push([KIND.BRICK, -len / 2 + BL / 2 + i * BL]);
				else {
					items.push([KIND.HALF, -len / 2 + BW / 2]);
					for (let i = 0; i < n - 1; i++)
						items.push([KIND.BRICK, -len / 2 + BW + BL / 2 + i * BL]);
					items.push([KIND.HALF, len / 2 - BW / 2]);
				}
				for (const [k, t] of items) {
					if (alongZ) this.add(k, cx + o, y, cz + t, Math.PI / 2);
					else this.add(k, cx + t, y, cz + o, 0);
				}
			}
		}
		return y0 + courses * BH;
	}

	/** Column of drums with a cap. Returns the top y. */
	column(x: number, z: number, drums: number, y0 = 0): number {
		const dh = (KINDS[KIND.DRUM] as { half: number[] }).half[1] as number;
		const ch = (KINDS[KIND.CAP] as { half: number[] }).half[1] as number;
		let y = y0;
		for (let i = 0; i < drums; i++) {
			this.add(KIND.DRUM, x, y + dh, z, i % 2 ? 0.3 : -0.2);
			y += dh * 2;
		}
		this.add(KIND.CAP, x, y + ch, z);
		return y + ch * 2;
	}

	/** Solid stepped pyramid (ziggurat) of bricks; `n` bricks across the base row. */
	ziggurat(cx: number, cz: number, n: number, tiers: number, y0 = 0): number {
		let y = y0;
		for (let t = 0; t < tiers; t++) {
			const m = n - t;
			if (m < 1) break;
			const yc = y + BH / 2;
			const rot = t % 2 === 1;
			// m bricks long, 2m rows deep (bricks are 2:1), alternating direction per tier.
			for (let i = 0; i < m; i++)
				for (let j = 0; j < m * 2; j++) {
					const a = (i - (m - 1) / 2) * (BL + GAP);
					const b = (j - (m * 2 - 1) / 2) * (BW + GAP);
					if (rot) this.add(KIND.BRICK, cx + b, yc, cz + a, Math.PI / 2);
					else this.add(KIND.BRICK, cx + a, yc, cz + b, 0);
				}
			y += BH;
		}
		return y;
	}
}

const half = (k: Kind, axis: 0 | 1 | 2): number =>
	(KINDS[k] as { half: number[] }).half[axis] as number;

/** Level 1: a walled keep. Four corner towers, four curtain walls, a tall central keep. */
function buildKeep(seed: number): BlockSpec[] {
	const b = new Builder(seed);
	b.stone = STONES.sandstone;
	const towerN = 3;
	const D = towerN * BL;
	const wallN = 7;
	const wallLen = wallN * BL;
	const c = wallLen / 2 + 0.03 + D / 2;
	const courses = 13 + b.rng.int(2);
	for (const sx of [-1, 1])
		for (const sz of [-1, 1]) b.tower(sx * c, sz * c, towerN, courses);
	b.stone = STONES.limestone;
	const wc = 8;
	b.wall(0, c, wallN, wc);
	b.wall(0, -c, wallN, wc);
	b.wall(c, 0, wallN, wc, true);
	b.wall(-c, 0, wallN, wc, true);
	b.stone = STONES.terracotta;
	b.tower(0, 0, 4, 18 + b.rng.int(3));
	return b.out;
}

/** Level 2: a viaduct of brick piers and beam-and-slab spans, with gatehouses at each end. */
function buildViaduct(seed: number): BlockSpec[] {
	const b = new Builder(seed);
	b.stone = STONES.limestone;
	const piers = 6;
	const spacing = 3.2;
	const pierCourses = 12;
	const x0 = (-(piers - 1) * spacing) / 2;
	const top = pierCourses * BH;
	for (let i = 0; i < piers; i++)
		b.tower(x0 + i * spacing, 0, 2, pierCourses, 0, false);
	// Spans: two beams per gap (one per pier face), slabs on top, parapet bricks.
	const bh = half(KIND.BEAM, 1);
	const sh = half(KIND.SLAB, 1);
	b.stone = STONES.slate;
	for (let i = 0; i < piers - 1; i++) {
		const x = x0 + (i + 0.5) * spacing;
		for (const z of [-0.45, 0.45]) b.add(KIND.BEAM, x, top + bh, z);
	}
	const deckY = top + bh * 2;
	b.stone = STONES.sandstone;
	const slabW = half(KIND.SLAB, 0) * 2;
	const deckLen = (piers - 1) * spacing - 0.5;
	const nSlab = Math.floor(deckLen / (slabW + GAP));
	for (let i = 0; i < nSlab; i++) {
		const x = -((nSlab - 1) * (slabW + GAP)) / 2 + i * (slabW + GAP);
		b.add(KIND.SLAB, x, deckY + sh, 0);
	}
	const parY = deckY + sh * 2;
	const nPar = Math.floor((nSlab * (slabW + GAP)) / (BL + GAP));
	for (let c = 0; c < 2; c++)
		for (let i = 0; i < nPar - (c % 2); i++) {
			const x = -((nPar - 1 - (c % 2)) * (BL + GAP)) / 2 + i * (BL + GAP);
			for (const z of [-0.45 + BW / 2, 0.45 - BW / 2])
				b.add(KIND.BRICK, x, parY + BH / 2 + c * BH, z);
		}
	// Gatehouses beyond each end.
	b.stone = STONES.terracotta;
	const gx = -x0 + 4.4;
	b.tower(gx, 0, 4, 14);
	b.tower(-gx, 0, 4, 14);
	// A colonnade behind the bridge, for the follow-through.
	b.stone = STONES.limestone;
	for (let i = 0; i < 7; i++) {
		const x = -7.2 + i * 2.4;
		const t = b.column(x, -6, 6);
		if (i % 2 === 0 && i < 6)
			b.add(KIND.BEAM, x + 1.2, t + half(KIND.BEAM, 1), -6);
	}
	return b.out;
}

/** Level 3: the citadel. A ziggurat crowned by a spire, flanked by towers and walls. */
function buildCitadel(seed: number): BlockSpec[] {
	const b = new Builder(seed);
	b.stone = STONES.terracotta;
	const zTop = b.ziggurat(0, -1, 6, 4);
	b.stone = STONES.slate;
	b.tower(0, -1, 2, 14, zTop, true);
	b.stone = STONES.sandstone;
	for (const sx of [-1, 1]) {
		b.tower(sx * 8.4, 1.5, 3, 20);
		b.wall(sx * 4.6, 4.2, 4, 7);
	}
	b.stone = STONES.limestone;
	for (let i = 0; i < 4; i++) {
		const x = -3.6 + i * 2.4;
		const t = b.column(x, 4.2 + 3.2, 5);
		if (i % 2 === 0)
			b.add(KIND.BEAM, x + 1.2, t + half(KIND.BEAM, 1), 4.2 + 3.2);
	}
	return b.out;
}

export const LEVELS: readonly LevelDef[] = [
	{
		id: "keep",
		name: "The Old Keep",
		subtitle: "Four towers, four walls, one stubborn keep",
		line: 2.2,
		shots: 3,
		par: 0.35,
		launcher: [0, 2.4, 30],
		botTargets: [
			[-0.2, 2.6, 5.7],
			[-3.4, 2.6, 5.7],
			[3.1, 2.6, 5.7],
		],
		botSpeeds: [52, 52, 52],
		build: buildKeep,
	},
	{
		id: "viaduct",
		name: "Dry Viaduct",
		subtitle: "Piers, spans and a colonnade behind",
		line: 2.0,
		shots: 3,
		par: 0.35,
		launcher: [0, 2.4, 28],
		botTargets: [
			[11, 2.6, 1.6],
			[-13, 2.6, 1.6],
			[-1, 2.6, 1.6],
		],
		botSpeeds: [52, 52, 52],
		build: buildViaduct,
	},
	{
		id: "citadel",
		name: "Sun Citadel",
		subtitle: "A ziggurat spire between two towers",
		line: 2.0,
		shots: 3,
		par: 0.3,
		launcher: [0, 2.4, 30],
		botTargets: [
			[-6.3, 2.6, 7.4],
			[7.3, 2.6, 7.4],
			[-0.8, 2.6, 7.4],
		],
		botSpeeds: [52, 52, 52],
		build: buildCitadel,
	},
];
