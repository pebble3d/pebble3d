import { TRACK_DS } from "./constants.ts";
import type { TrackDef } from "./course.ts";

const DEG = Math.PI / 180;
/** Pitch/bank/width changes ease in over this distance at a segment start (m). */
const BLEND = 7;
/** Deck cross-section points (left edge to right edge). */
export const DECK_POINTS = 9;
/** How much the deck edges rise above its centre, per metre of width (a shallow trough). */
const SAG_PER_M = 0.06;
/** Walls lean out by this much over their height. */
const WALL_FLARE = 0.15;
/** Boost pad length (m). */
export const BOOST_LEN = 6;
/** Physics rings use every Nth sample. */
const PHYS_STRIDE = 2;

export interface BoostPad {
	i0: number;
	i1: number;
	/** Lateral half-width of the pad (m). */
	half: number;
}
export interface SweeperDef {
	/** Centre sample. */
	i: number;
	arm: number;
	speed: number;
	count: number;
}

function smooth(t: number): number {
	const c = t < 0 ? 0 : Math.min(t, 1);
	return c * c * (3 - 2 * c);
}

/**
 * The expanded course: a centerline sampled every `TRACK_DS` metres with an orthonormal
 * frame (tangent t, right r, up u), plus the gameplay features mapped to sample indices.
 * Pure double-precision math on the JSON: identical in every run.
 */
export class Track {
	readonly n: number;
	readonly px: Float64Array;
	readonly py: Float64Array;
	readonly pz: Float64Array;
	readonly tx: Float64Array;
	readonly ty: Float64Array;
	readonly tz: Float64Array;
	readonly rx: Float64Array;
	readonly ry: Float64Array;
	readonly rz: Float64Array;
	readonly ux: Float64Array;
	readonly uy: Float64Array;
	readonly uz: Float64Array;
	readonly width: Float64Array;
	readonly wall: Float64Array;
	readonly dist: Float64Array;
	/** 1 where the sample has deck under it (0 in gaps). */
	readonly deck: Uint8Array;
	readonly segOf: Uint16Array;
	/** Checkpoint gates (sample indices), in order; the start is not one. */
	readonly checkpoints: number[] = [];
	readonly finish: number;
	readonly boosts: BoostPad[] = [];
	readonly sweepers: SweeperDef[] = [];
	/** Contiguous deck ranges [i0, i1] (inclusive). */
	readonly pieces: { i0: number; i1: number }[] = [];
	/** Lowest deck y (fall detection reference). */
	readonly minY: number;
	readonly bounds: {
		min: [number, number, number];
		max: [number, number, number];
	};

	constructor(def: TrackDef) {
		// Pass 1: count samples.
		let total = 1;
		const segLen = def.segments.map((s) => {
			const L =
				s.len ?? s.gap ?? Math.abs((s.turn ?? 0) * DEG) * (s.radius ?? 1);
			const steps = Math.max(1, Math.round(L / TRACK_DS));
			total += steps;
			return steps;
		});
		const n = total;
		this.n = n;
		const f = () => new Float64Array(n);
		this.px = f();
		this.py = f();
		this.pz = f();
		this.tx = f();
		this.ty = f();
		this.tz = f();
		this.rx = f();
		this.ry = f();
		this.rz = f();
		this.ux = f();
		this.uy = f();
		this.uz = f();
		this.width = f();
		this.wall = f();
		this.dist = f();
		this.deck = new Uint8Array(n);
		this.segOf = new Uint16Array(n);

		let x = def.start.pos[0];
		let y = def.start.pos[1];
		let z = def.start.pos[2];
		let h = def.start.heading * DEG;
		let pitch = 0;
		let bank = 0;
		let width = def.width;
		let wall = def.wall;
		let finish = -1;
		const write = (i: number, seg: number, deck: boolean): void => {
			const cp = Math.cos(pitch);
			const tx = Math.sin(h) * cp;
			const ty = Math.sin(pitch);
			const tz = Math.cos(h) * cp;
			// flat right = t x worldUp, normalised (t is never vertical here)
			let rx = -tz;
			let rz = tx;
			const rl = Math.sqrt(rx * rx + rz * rz);
			rx /= rl;
			rz /= rl;
			// up = r x t
			let ux = -rz * ty; // r.y = 0
			let uy = rz * tx - rx * tz;
			let uz = rx * ty;
			// bank about t
			const cb = Math.cos(bank);
			const sb = Math.sin(bank);
			const brx = rx * cb + ux * sb;
			const bry = uy * sb;
			const brz = rz * cb + uz * sb;
			ux = ux * cb - rx * sb;
			uy = uy * cb;
			uz = uz * cb - rz * sb;
			this.px[i] = x;
			this.py[i] = y;
			this.pz[i] = z;
			this.tx[i] = tx;
			this.ty[i] = ty;
			this.tz[i] = tz;
			this.rx[i] = brx;
			this.ry[i] = bry;
			this.rz[i] = brz;
			this.ux[i] = ux;
			this.uy[i] = uy;
			this.uz[i] = uz;
			this.width[i] = width;
			this.wall[i] = wall;
			this.dist[i] = i * TRACK_DS;
			this.deck[i] = deck ? 1 : 0;
			this.segOf[i] = seg;
		};
		write(0, 0, def.segments[0]?.gap === undefined);
		let i = 0;
		def.segments.forEach((s, k) => {
			const steps = segLen[k] as number;
			const L = steps * TRACK_DS;
			const p0 = pitch;
			const b0 = bank;
			const w0 = width;
			const wl0 = wall;
			const p1 = (s.pitch ?? p0 / DEG) * DEG;
			const turnSign = Math.sign(s.turn ?? 0);
			const b1 =
				s.turn !== undefined
					? turnSign * (s.bank ?? 0) * DEG
					: (s.bank ?? 0) * DEG;
			const w1 = s.width ?? def.width;
			const wl1 = s.wall ?? def.wall;
			const curv = s.turn !== undefined ? (s.turn * DEG) / L : 0;
			const blend = Math.min(BLEND, L);
			if (s.checkpoint) this.checkpoints.push(i);
			if (s.finish) finish = i;
			const deck = s.gap === undefined;
			for (let j = 0; j < steps; j++) {
				const sl = (j + 0.5) * TRACK_DS;
				const e = smooth(sl / blend);
				pitch = p0 + (p1 - p0) * e;
				bank = b0 + (b1 - b0) * smooth(sl / Math.min(BLEND * 1.5, L));
				width = w0 + (w1 - w0) * e;
				wall = wl0 + (wl1 - wl0) * e;
				h += curv * TRACK_DS;
				const cp = Math.cos(pitch);
				x += Math.sin(h) * cp * TRACK_DS;
				y += Math.sin(pitch) * TRACK_DS;
				z += Math.cos(h) * cp * TRACK_DS;
				i++;
				write(i, k, deck);
			}
			const mid = i - Math.floor(steps / 2);
			if (s.boost) {
				const half = Math.round(BOOST_LEN / TRACK_DS / 2);
				this.boosts.push({ i0: mid - half, i1: mid + half, half: 1.2 });
			}
			if (s.sweeper)
				this.sweepers.push({
					i: mid,
					arm: s.sweeper.arm,
					speed: s.sweeper.speed,
					count: s.sweeper.count ?? 1,
				});
		});
		this.finish = finish;

		let minY = Number.POSITIVE_INFINITY;
		const mn: [number, number, number] = [Infinity, Infinity, Infinity];
		const mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
		let start = -1;
		for (let k = 0; k < n; k++) {
			const px = this.px[k] as number;
			const py = this.py[k] as number;
			const pz = this.pz[k] as number;
			if (px < mn[0]) mn[0] = px;
			if (py < mn[1]) mn[1] = py;
			if (pz < mn[2]) mn[2] = pz;
			if (px > mx[0]) mx[0] = px;
			if (py > mx[1]) mx[1] = py;
			if (pz > mx[2]) mx[2] = pz;
			if (this.deck[k]) {
				if (py < minY) minY = py;
				if (start < 0) start = k > 0 && !this.deck[k - 1] ? k - 1 : k;
			} else if (start >= 0) {
				this.pieces.push({ i0: start, i1: k - 1 });
				start = -1;
			}
		}
		if (start >= 0) this.pieces.push({ i0: start, i1: n - 1 });
		this.minY = minY;
		this.bounds = { min: mn, max: mx };
	}

	/** Deck surface height above the centreline at lateral offset `x` (trough profile). */
	sag(i: number, x: number): number {
		const w = this.width[i] as number;
		const k = (2 * x) / w;
		return SAG_PER_M * w * k * k;
	}

	/**
	 * Cross-section of the collision surface at sample `i`: left wall top, the deck points,
	 * right wall top, as [x, y] pairs in the (r, u) frame.
	 */
	profile(i: number, out: Float64Array): Float64Array {
		const w = this.width[i] as number;
		const hw = w / 2;
		const wall = this.wall[i] as number;
		const top = this.sag(i, hw) + wall;
		let o = 0;
		out[o++] = -hw - WALL_FLARE;
		out[o++] = top;
		for (let j = 0; j < DECK_POINTS; j++) {
			const xx = -hw + (w * j) / (DECK_POINTS - 1);
			out[o++] = xx;
			out[o++] = this.sag(i, xx);
		}
		out[o++] = hw + WALL_FLARE;
		out[o++] = top;
		return out;
	}

	/** Trimesh colliders, one per deck piece (flat xyz vertices + indices). */
	colliders(): { vertices: number[]; indices: number[] }[] {
		const P = DECK_POINTS + 2;
		const prof = new Float64Array(P * 2);
		const out: { vertices: number[]; indices: number[] }[] = [];
		for (const { i0, i1 } of this.pieces) {
			const vertices: number[] = [];
			const indices: number[] = [];
			const rings: number[] = [];
			for (let i = i0; i < i1; i += PHYS_STRIDE) rings.push(i);
			rings.push(i1);
			for (const i of rings) {
				this.profile(i, prof);
				for (let j = 0; j < P; j++) {
					const a = prof[j * 2] as number;
					const b = prof[j * 2 + 1] as number;
					vertices.push(
						Math.fround(
							(this.px[i] as number) +
								(this.rx[i] as number) * a +
								(this.ux[i] as number) * b,
						),
						Math.fround(
							(this.py[i] as number) +
								(this.ry[i] as number) * a +
								(this.uy[i] as number) * b,
						),
						Math.fround(
							(this.pz[i] as number) +
								(this.rz[i] as number) * a +
								(this.uz[i] as number) * b,
						),
					);
				}
			}
			for (let r = 0; r + 1 < rings.length; r++) {
				const a = r * P;
				const b = (r + 1) * P;
				for (let j = 0; j + 1 < P; j++) {
					// (r x t) = up: deck triangles face into the channel
					indices.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
				}
			}
			out.push({ vertices, indices });
		}
		return out;
	}

	/**
	 * Nearest sample to (x, y, z), searching `[hint - back, hint + ahead]`. Local search keeps
	 * it O(window) and stops the projection snapping to a crossing piece of track.
	 */
	nearest(
		x: number,
		y: number,
		z: number,
		hint: number,
		back = 24,
		ahead = 60,
	): number {
		const lo = Math.max(0, hint - back);
		const hi = Math.min(this.n - 1, hint + ahead);
		let best = hint;
		let bd = Number.POSITIVE_INFINITY;
		for (let i = lo; i <= hi; i++) {
			const dx = x - (this.px[i] as number);
			const dy = y - (this.py[i] as number);
			const dz = z - (this.pz[i] as number);
			const d = dx * dx + dy * dy + dz * dz;
			if (d < bd) {
				bd = d;
				best = i;
			}
		}
		return best;
	}
}
