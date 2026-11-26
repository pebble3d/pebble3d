import type { Scene } from "@pebble3d/sdk/schema";

/** Walkability tile size, metres. */
export const TILE = 0.5;
/** Clearance kept from every static collider: the player capsule radius (0.3) plus a margin. */
export const CLEARANCE = 0.32;
/** Static colliders lower than this do not block walking (floor slabs, rugs). */
const MIN_BLOCK_HEIGHT = 0.3;

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];

/**
 * A walkability grid over the XZ plane, rasterised from a scene's static colliders. One code
 * path builds it for the generator (guard routes), the sim (chases, the demo bot) and the
 * solvability test, which rasterises the exported scene JSON itself.
 *
 * Path queries reuse preallocated typed arrays: `findPath` does not allocate.
 */
export class Grid {
	readonly blocked: Uint8Array;
	private readonly g: Float32Array;
	private readonly came: Int32Array;
	private readonly stamp: Uint32Array;
	private readonly closed: Uint32Array;
	private readonly heap: Int32Array;
	private readonly heapF: Float32Array;
	private heapN = 0;
	private gen = 0;

	readonly w: number;
	readonly h: number;
	readonly x0: number;
	readonly z0: number;

	constructor(w: number, h: number, x0: number, z0: number) {
		this.w = w;
		this.h = h;
		this.x0 = x0;
		this.z0 = z0;
		const n = w * h;
		this.blocked = new Uint8Array(n);
		this.g = new Float32Array(n);
		this.came = new Int32Array(n);
		this.stamp = new Uint32Array(n);
		this.closed = new Uint32Array(n);
		this.heap = new Int32Array(n * 8);
		this.heapF = new Float32Array(n * 8);
	}

	get size(): number {
		return this.w * this.h;
	}

	/** Tile index under world (x, z), or -1 outside the grid. */
	index(x: number, z: number): number {
		const i = Math.floor((x - this.x0) / TILE);
		const j = Math.floor((z - this.z0) / TILE);
		if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
		return j * this.w + i;
	}

	cx(i: number): number {
		return this.x0 + ((i % this.w) + 0.5) * TILE;
	}

	cz(i: number): number {
		return this.z0 + (Math.floor(i / this.w) + 0.5) * TILE;
	}

	walkable(i: number): boolean {
		return i >= 0 && i < this.blocked.length && this.blocked[i] === 0;
	}

	/** The walkable tile nearest to (x, z) within `maxR` tiles (spiral search), or -1. */
	nearestWalkable(x: number, z: number, maxR = 8): number {
		const c = this.index(x, z);
		if (this.walkable(c)) return c;
		const ci = Math.floor((x - this.x0) / TILE);
		const cj = Math.floor((z - this.z0) / TILE);
		let best = -1;
		let bestD = Number.POSITIVE_INFINITY;
		for (let r = 1; r <= maxR; r++) {
			for (let dj = -r; dj <= r; dj++) {
				for (let di = -r; di <= r; di++) {
					if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
					const i = ci + di;
					const j = cj + dj;
					if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
					const k = j * this.w + i;
					if (this.blocked[k] !== 0) continue;
					const d = (this.cx(k) - x) ** 2 + (this.cz(k) - z) ** 2;
					if (d < bestD) {
						bestD = d;
						best = k;
					}
				}
			}
			if (best >= 0) return best;
		}
		return -1;
	}

	/** True when every tile along the segment a -> b is walkable (sampled every quarter tile). */
	clearLine(ax: number, az: number, bx: number, bz: number): boolean {
		const len = Math.hypot(bx - ax, bz - az);
		const n = Math.max(1, Math.ceil(len / (TILE * 0.25)));
		for (let s = 0; s <= n; s++) {
			const t = s / n;
			if (!this.walkable(this.index(ax + (bx - ax) * t, az + (bz - az) * t)))
				return false;
		}
		return true;
	}

	/**
	 * A* from tile `from` to tile `to`, 8-connected without corner cutting. `extra` adds a
	 * per-tile cost (null = uniform). Writes the tile path (from first, to last) into `out`
	 * and returns its length, or 0 when unreachable or `out` is too short.
	 */
	findPath(
		from: number,
		to: number,
		out: Int32Array,
		extra: Float32Array | null = null,
	): number {
		if (!this.walkable(from) || !this.walkable(to)) return 0;
		const gen = ++this.gen;
		const w = this.w;
		const tx = to % w;
		const tz = Math.floor(to / w);
		this.heapN = 0;
		this.g[from] = 0;
		this.stamp[from] = gen;
		this.came[from] = -1;
		this.push(from, this.heur(from, tx, tz));
		let found = false;
		while (this.heapN > 0) {
			const cur = this.pop();
			if (this.closed[cur] === gen) continue;
			this.closed[cur] = gen;
			if (cur === to) {
				found = true;
				break;
			}
			const ci = cur % w;
			const cj = Math.floor(cur / w);
			const gc = this.g[cur] as number;
			for (let d = 0; d < 8; d++) {
				const ni = ci + (DX[d] as number);
				const nj = cj + (DZ[d] as number);
				if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
				const nb = nj * w + ni;
				if (this.blocked[nb] !== 0 || this.closed[nb] === gen) continue;
				if (d >= 4) {
					// No corner cutting: both orthogonal neighbours must be open.
					if (
						this.blocked[cj * w + ni] !== 0 ||
						this.blocked[nj * w + ci] !== 0
					)
						continue;
				}
				const step = d >= 4 ? SQRT2 : 1;
				const ng = gc + step * (1 + (extra ? (extra[nb] as number) : 0));
				if (this.stamp[nb] !== gen || ng < (this.g[nb] as number)) {
					this.stamp[nb] = gen;
					this.g[nb] = ng;
					this.came[nb] = cur;
					this.push(nb, ng + this.heur(nb, tx, tz));
				}
			}
		}
		if (!found) return 0;
		let n = 0;
		for (let c = to; c !== -1; c = this.came[c] as number) n++;
		if (n > out.length) return 0;
		let k = n - 1;
		for (let c = to; c !== -1; c = this.came[c] as number) out[k--] = c;
		return n;
	}

	/** Every tile reachable from `from` gets 1 in `out` (flood fill, 4-connected). Returns the count. */
	flood(from: number, out: Uint8Array): number {
		out.fill(0);
		if (!this.walkable(from)) return 0;
		const stack = this.heap; // reuse as a stack
		let sp = 0;
		stack[sp++] = from;
		out[from] = 1;
		let count = 0;
		while (sp > 0) {
			const c = stack[--sp] as number;
			count++;
			const ci = c % this.w;
			const cj = Math.floor(c / this.w);
			for (let d = 0; d < 4; d++) {
				const ni = ci + (DX[d] as number);
				const nj = cj + (DZ[d] as number);
				if (ni < 0 || nj < 0 || ni >= this.w || nj >= this.h) continue;
				const nb = nj * this.w + ni;
				if (this.blocked[nb] !== 0 || out[nb] !== 0) continue;
				out[nb] = 1;
				stack[sp++] = nb;
			}
		}
		return count;
	}

	private heur(i: number, tx: number, tz: number): number {
		const dx = Math.abs((i % this.w) - tx);
		const dz = Math.abs(Math.floor(i / this.w) - tz);
		return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
	}

	private push(i: number, f: number): void {
		let k = this.heapN++;
		const heap = this.heap;
		const hf = this.heapF;
		while (k > 0) {
			const p = (k - 1) >> 1;
			if ((hf[p] as number) <= f) break;
			heap[k] = heap[p] as number;
			hf[k] = hf[p] as number;
			k = p;
		}
		heap[k] = i;
		hf[k] = f;
	}

	private pop(): number {
		const heap = this.heap;
		const hf = this.heapF;
		const top = heap[0] as number;
		const n = --this.heapN;
		const li = heap[n] as number;
		const lf = hf[n] as number;
		let k = 0;
		for (;;) {
			let c = 2 * k + 1;
			if (c >= n) break;
			if (c + 1 < n && (hf[c + 1] as number) < (hf[c] as number)) c++;
			if ((hf[c] as number) >= lf) break;
			heap[k] = heap[c] as number;
			hf[k] = hf[c] as number;
			k = c;
		}
		heap[k] = li;
		hf[k] = lf;
		return top;
	}
}

/** An axis-aligned blocker footprint in XZ: a box (half extents) or a circle (radius in hx). */
export interface Footprint {
	x: number;
	z: number;
	hx: number;
	hz: number;
	round: boolean;
}

/**
 * The XZ footprints of every static collider in a parsed scene, bounds walls included.
 * Supports what the generator writes: identity-rotation boxes and cylinders (auto or explicit
 * box colliders). Anything else throws, so a generator change cannot silently skip a blocker.
 */
export function footprints(scene: Scene): Footprint[] {
	const out: Footprint[] = [];
	for (const e of scene.entities) {
		if (!e.body || e.character) continue;
		const type = e.body.type ?? "dynamic";
		if (type !== "static") continue;
		const t = e.transform;
		const p = t?.position ?? [0, 0, 0];
		const s = t?.scale ?? [1, 1, 1];
		const r = t?.rotation ?? [0, 0, 0, 1];
		if (Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) > 1e-6)
			throw new Error(
				`footprints: ${e.id} is rotated; only axis-aligned statics are supported`,
			);
		const c = e.body.collider ?? "auto";
		let hx: number;
		let hy: number;
		let hz: number;
		let round = false;
		if (c === "auto") {
			const prim = e.mesh?.primitive;
			if (prim === "box") {
				hx = s[0] / 2;
				hy = s[1] / 2;
				hz = s[2] / 2;
			} else if (prim === "cylinder") {
				hx = Math.max(s[0], s[2]) / 2;
				hz = hx;
				hy = s[1] / 2;
				round = true;
			} else
				throw new Error(`footprints: ${e.id} has an unsupported auto collider`);
		} else if (c.shape === "box") {
			[hx, hy, hz] = c.halfExtents;
		} else
			throw new Error(
				`footprints: ${e.id} has an unsupported collider ${c.shape}`,
			);
		if (p[1] + hy < MIN_BLOCK_HEIGHT) continue;
		out.push({ x: p[0], z: p[2], hx, hz, round });
	}
	const b = scene.bounds;
	if (b) {
		const ht = b.thickness / 2;
		const [minX, minZ] = b.min;
		const [maxX, maxZ] = b.max;
		const cx = (minX + maxX) / 2;
		const cz = (minZ + maxZ) / 2;
		const hw = (maxX - minX) / 2 + b.thickness;
		const hd = (maxZ - minZ) / 2 + b.thickness;
		out.push({ x: cx, z: minZ - ht, hx: hw, hz: ht, round: false });
		out.push({ x: cx, z: maxZ + ht, hx: hw, hz: ht, round: false });
		out.push({ x: minX - ht, z: cz, hx: ht, hz: hd, round: false });
		out.push({ x: maxX + ht, z: cz, hx: ht, hz: hd, round: false });
	}
	return out;
}

/** Rasterise a parsed scene's statics into a grid covering its bounds (required). */
export function rasterize(scene: Scene, clearance = CLEARANCE): Grid {
	const b = scene.bounds;
	if (!b) throw new Error("rasterize: the scene needs bounds");
	const x0 = b.min[0];
	const z0 = b.min[1];
	const w = Math.ceil((b.max[0] - x0) / TILE);
	const h = Math.ceil((b.max[1] - z0) / TILE);
	const grid = new Grid(w, h, x0, z0);
	for (const f of footprints(scene)) {
		const ext = clearance + Math.max(f.hx, f.hz);
		const i0 = Math.max(
			0,
			Math.floor((f.x - (f.round ? ext : f.hx + clearance) - x0) / TILE),
		);
		const i1 = Math.min(
			w - 1,
			Math.floor((f.x + (f.round ? ext : f.hx + clearance) - x0) / TILE),
		);
		const j0 = Math.max(
			0,
			Math.floor((f.z - (f.round ? ext : f.hz + clearance) - z0) / TILE),
		);
		const j1 = Math.min(
			h - 1,
			Math.floor((f.z + (f.round ? ext : f.hz + clearance) - z0) / TILE),
		);
		for (let j = j0; j <= j1; j++) {
			const cz = z0 + (j + 0.5) * TILE;
			for (let i = i0; i <= i1; i++) {
				const cx = x0 + (i + 0.5) * TILE;
				let inside: boolean;
				if (f.round) inside = Math.hypot(cx - f.x, cz - f.z) < f.hx + clearance;
				else {
					const dx = Math.max(0, Math.abs(cx - f.x) - f.hx);
					const dz = Math.max(0, Math.abs(cz - f.z) - f.hz);
					inside = dx * dx + dz * dz < clearance * clearance;
				}
				if (inside) grid.blocked[j * w + i] = 1;
			}
		}
	}
	return grid;
}
