import {
	BTN,
	GUARD,
	type GuardState,
	type LanternSim,
	PHASE,
	type TickInput,
	TUNE,
} from "./sim.ts";

const REPLAN = 10;
const LOOKAHEAD = 6;
/** A calm guard this close, facing or walking our way, makes the bot move off to a hiding spot. */
const THREAT_RANGE = 7;
/** Ticks without getting closer to the goal before the bot stops hiding and waiting. */
const WATCHDOG = 60 * 40;
const COMMIT = 60 * 10;

/**
 * `?demo=1` autoplayer: a light-averse thief. Three modes, re-chosen every tick:
 * - flee: a guard is onto it (alarmed, or watching it with rising suspicion). Run to the best
 *   tile away from that guard and out of its sight, then keep still in the dark.
 * - hide: a calm guard is coming its way. Slip to a dark tile out of every guard's path.
 * - advance: A* to the relic (then the gate) over the sim's grid, every tile costing extra for
 *   its light and for lying ahead of a guard; wait before stepping into a guard's sight.
 * A watchdog stops the hiding and waiting if it has made no progress for 45 s. It reads only sim
 * state (what the HUD shows) and writes the same `TickInput` a player does; no allocation per tick.
 */
export class DemoBot {
	current = "title";
	private readonly cost: Float32Array;
	private readonly path: Int32Array;
	private readonly distP: Float32Array;
	private readonly distH: Float32Array;
	private readonly queue: Int32Array;
	private readonly route: Float32Array;
	private pathLen = 0;
	private pathIdx = 0;
	private replan = 0;
	private endT = 0;
	private modeT = 0;
	private mode = 0; // 0 advance, 1 hide, 2 flee
	private tx = 0;
	private tz = 0;
	private waitT = 0;
	private best = Number.POSITIVE_INFINITY;
	private stall = 0;
	private commitT = 0;
	private goalWasRelic = true;

	constructor(
		private readonly sim: LanternSim,
		/** Ticks on the title before pressing start. */
		private readonly titleTicks = 150,
	) {
		this.cost = new Float32Array(sim.grid.size);
		this.path = new Int32Array(sim.grid.size);
		this.distP = new Float32Array(sim.grid.size);
		this.distH = new Float32Array(sim.grid.size);
		this.queue = new Int32Array(sim.grid.size);
		// Distance from each tile to the nearest patrol leg (the routes are on the minimap's
		// world for a player who watches long enough; the bot just knows them).
		this.route = new Float32Array(sim.grid.size).fill(6);
		const grid = sim.grid;
		for (const g of sim.guards) {
			const r = g.route;
			const n = r.length / 3;
			for (let k = 0; k < n; k++) {
				const ax = r[k * 3] as number;
				const az = r[k * 3 + 1] as number;
				const bx = r[((k + 1) % n) * 3] as number;
				const bz = r[((k + 1) % n) * 3 + 1] as number;
				const lx = bx - ax;
				const lz = bz - az;
				const l2 = lx * lx + lz * lz || 1;
				for (let t = 0; t < grid.size; t++) {
					const px = grid.cx(t) - ax;
					const pz = grid.cz(t) - az;
					const u = Math.max(0, Math.min(1, (px * lx + pz * lz) / l2));
					const d = Math.hypot(px - u * lx, pz - u * lz);
					if (d < (this.route[t] as number)) this.route[t] = d;
				}
			}
		}
	}

	/** Back to the start-of-run state (each retry). */
	reset(): void {
		this.pathLen = 0;
		this.mode = 0;
		this.modeT = 0;
		this.waitT = 0;
		this.replan = 0;
		this.best = Number.POSITIVE_INFINITY;
		this.stall = 0;
		this.commitT = 0;
		this.goalWasRelic = true;
	}

	/** How much guard `g` threatens world point (x, z): ahead of it, near it, or both. */
	private threat(g: GuardState, x: number, z: number): number {
		const dx = x - g.x;
		const dz = z - g.z;
		const d = Math.hypot(dx, dz);
		if (d > THREAT_RANGE) return 0;
		const c = d > 1e-3 ? (dx * Math.sin(g.yaw) + dz * Math.cos(g.yaw)) / d : 1;
		let t = d < 2.4 ? 1 : d < 4 ? 0.7 : 0;
		if (c > 0.3) t += 1 - d / THREAT_RANGE;
		const along = g.mx * dx + g.mz * dz;
		if (along > 0 && d < 5) t += 0.5;
		return t;
	}

	next(out: TickInput): void {
		const s = this.sim;
		out.mx = 0;
		out.mz = 0;
		out.buttons = 0;
		if (s.phase === PHASE.TITLE) {
			this.current = "title";
			if (s.phaseT > this.titleTicks) out.buttons = BTN.START;
			return;
		}
		if (s.phase !== PHASE.PLAY) {
			this.current = "results";
			if (++this.endT > 300) {
				out.buttons = BTN.START;
				this.endT = 0;
				this.reset();
			}
			return;
		}
		const grid = s.grid;
		const L = s.layout;

		// Who is onto us?
		let hunter: GuardState | null = null;
		let hunterD = Number.POSITIVE_INFINITY;
		let danger = 0;
		for (const g of s.guards) {
			const d = Math.hypot(g.x - s.px, g.z - s.pz);
			const onto =
				(g.state === GUARD.ALERT && d < 16) ||
				(g.sees && g.suspicion > 0.1) ||
				(g.state === GUARD.SUSPICIOUS && d < 9) ||
				(g.state === GUARD.SEARCH && d < 6);
			if (onto && d < hunterD) {
				hunter = g;
				hunterD = d;
			}
			const t = this.threat(g, s.px, s.pz);
			if (t > danger) danger = t;
		}
		const committed = this.commitT > 0;
		if (committed) this.commitT--;

		let goal: string;
		let gx: number;
		let gz: number;
		let sprint = false;
		if (hunter) {
			const alarm = hunter.state === GUARD.ALERT;
			const want = alarm ? 2 : 3; // 2 flee (run far), 3 duck (step out of its sight)
			if (this.mode !== want || --this.modeT <= 0) {
				this.mode = want;
				this.modeT = alarm ? 240 : 120;
				this.pickSpot(hunter, alarm ? 14 : 8, !alarm);
				this.replan = 0;
			}
			goal = alarm ? "flee" : "duck";
			gx = this.tx;
			gz = this.tz;
			sprint = alarm;
		} else if (
			danger > 1.0 ||
			(!committed && this.mode === 1 && this.modeT > 0)
		) {
			if (this.mode !== 1) {
				this.mode = 1;
				this.modeT = 150;
				this.pickSpot(null, 6);
				this.replan = 0;
			}
			this.modeT--;
			if (danger < 0.2 && this.modeT < 90) this.modeT = 0;
			goal = "hide";
			gx = this.tx;
			gz = this.tz;
		} else {
			this.mode = 0;
			if (s.hasRelic) {
				gx = L.gate[0];
				gz = L.exitZ + 2;
				goal = "escape";
			} else {
				gx = L.relic[0];
				gz = L.relic[1] + 1;
				goal = "relic";
			}
			for (let k = 0; k < L.loot.length; k++) {
				if (s.lootMask & (1 << k)) continue;
				const [lx, lz] = L.loot[k] as [number, number];
				if (
					Math.hypot(lx - s.px, lz - s.pz) < 3.5 &&
					grid.clearLine(s.px, s.pz, lx, lz)
				) {
					gx = lx;
					gz = lz;
					goal = "loot";
					break;
				}
			}
		}

		// Watchdog: straight-line distance to the real goal must keep improving.
		const relicGoal = !s.hasRelic;
		if (relicGoal !== this.goalWasRelic) {
			this.goalWasRelic = relicGoal;
			this.best = Number.POSITIVE_INFINITY;
		}
		const rd = relicGoal
			? Math.hypot(L.relic[0] - s.px, L.relic[1] - s.pz)
			: Math.hypot(L.gate[0] - s.px, L.exitZ - s.pz);
		if (rd < this.best - 0.5) {
			this.best = rd;
			this.stall = 0;
		} else if (++this.stall > WATCHDOG) {
			this.stall = 0;
			this.best = rd;
			this.commitT = COMMIT;
		}

		if (
			(goal === "hide" || goal === "flee" || goal === "duck") &&
			Math.hypot(gx - s.px, gz - s.pz) < 0.4
		) {
			this.current = goal;
			if (goal !== "hide" && hunter?.sees) this.modeT = 0; // spotted here: move again
			return;
		}

		if (--this.replan <= 0 || this.pathLen === 0) {
			this.plan(gx, gz);
			this.replan = REPLAN;
		}
		if (this.pathLen === 0) {
			this.mode = 0;
			this.current = "stuck";
			return;
		}
		let aim = this.pathIdx;
		for (
			let k = Math.min(this.pathLen - 1, this.pathIdx + LOOKAHEAD);
			k > this.pathIdx;
			k--
		) {
			const t = this.path[k] as number;
			if (grid.clearLine(s.px, s.pz, grid.cx(t), grid.cz(t))) {
				aim = k;
				break;
			}
		}
		this.pathIdx = aim;
		const t = this.path[aim] as number;
		let dx = grid.cx(t) - s.px;
		let dz = grid.cz(t) - s.pz;
		if (aim === this.pathLen - 1) {
			dx = gx - s.px;
			dz = gz - s.pz;
		}
		// Don't step into a guard's sight: wait where we stand until it looks away.
		if (this.mode === 0 && !committed && this.waitT < 480) {
			const dd = Math.hypot(dx, dz) || 1;
			const nx = s.px + (dx / dd) * 1.2;
			const nz = s.pz + (dz / dd) * 1.2;
			if (this.exposed(nx, nz) && !this.exposed(s.px, s.pz)) {
				this.waitT++;
				this.current = "wait";
				return;
			}
		}
		if (this.waitT > 0) this.waitT--;
		const d = Math.hypot(dx, dz);
		if (d > 1e-3) {
			out.mx = Math.round((dx / d) * 127);
			out.mz = Math.round((dz / d) * 127);
		}
		if (sprint) out.buttons |= BTN.SPRINT;
		this.current = committed && goal !== "flee" ? "commit" : goal;
	}

	/** Would guard `g` (as it faces now) see a thief at (x, z)? The sim's test plus margins. */
	private seenBy(g: GuardState, x: number, z: number, margin: number): boolean {
		const s = this.sim;
		const dx = x - g.x;
		const dz = z - g.z;
		const d = Math.hypot(dx, dz);
		let range =
			TUNE.rangeDark + TUNE.rangeLit * Math.min(1, s.lightAt(x, z)) + margin;
		if (g.state === GUARD.ALERT)
			range = Math.max(range, TUNE.alertRange + margin);
		if (d > range) return false;
		if (d > TUNE.feel + margin) {
			const c = (dx * Math.sin(g.yaw) + dz * Math.cos(g.yaw)) / d;
			if (c < Math.cos(TUNE.coneHalf) - 0.25 * margin) return false;
		}
		return (
			s.clearSight(g.x, g.z, x, TUNE.chestY, z) ||
			s.clearSight(g.x, g.z, x, TUNE.headY, z)
		);
	}

	/** Could a guard see a thief standing at (x, z)? The sim's own sight test, with margins. */
	private exposed(x: number, z: number): boolean {
		const s = this.sim;
		const light = Math.min(1, s.lightAt(x, z));
		const range = TUNE.rangeDark + TUNE.rangeLit * light + 0.6;
		for (const g of s.guards) {
			const dx = x - g.x;
			const dz = z - g.z;
			const d = Math.hypot(dx, dz);
			if (d > range) continue;
			// A pausing or searching guard sweeps its gaze: treat it as looking almost all round.
			const wide = g.pause > 0 || g.state === GUARD.SEARCH;
			const c = (dx * Math.sin(g.yaw) + dz * Math.cos(g.yaw)) / (d || 1);
			if (d > 3 && c < (wide ? -0.3 : 0.2)) continue;
			if (
				s.clearSight(g.x, g.z, x, TUNE.chestY, z) ||
				s.clearSight(g.x, g.z, x, TUNE.headY, z)
			)
				return true;
		}
		return false;
	}

	/** Walking distance (metres, 8-connected) from (x, z) to every tile, into `out` (-1 = unreached). */
	private flood(x: number, z: number, out: Float32Array): void {
		const grid = this.sim.grid;
		out.fill(-1);
		const start = grid.nearestWalkable(x, z, 3);
		if (start < 0) return;
		const q = this.queue;
		let head = 0;
		let tail = 0;
		q[tail++] = start;
		out[start] = 0;
		const w = grid.w;
		while (head < tail) {
			const c = q[head++] as number;
			const ci = c % w;
			const cj = (c - ci) / w;
			const dc = out[c] as number;
			for (let dj = -1; dj <= 1; dj++)
				for (let di = -1; di <= 1; di++) {
					if (di === 0 && dj === 0) continue;
					const ni = ci + di;
					const nj = cj + dj;
					if (ni < 0 || nj < 0 || ni >= w || nj >= grid.h) continue;
					const n = nj * w + ni;
					if (grid.blocked[n] !== 0 || (out[n] as number) >= 0) continue;
					if (
						di !== 0 &&
						dj !== 0 &&
						(grid.blocked[cj * w + ni] !== 0 || grid.blocked[nj * w + ci] !== 0)
					)
						continue;
					out[n] = dc + (di !== 0 && dj !== 0 ? Math.SQRT1_2 : 0.5);
					q[tail++] = n;
				}
		}
	}

	/**
	 * A spot to run to: dark, reachable soon, out of guards' way. Fleeing from `from`: a tile we
	 * reach well before it does (walking distances, not straight lines) and out of its sight.
	 */
	private pickSpot(from: GuardState | null, R: number, duck = false): void {
		const s = this.sim;
		const grid = s.grid;
		this.flood(s.px, s.pz, this.distP);
		if (from) this.flood(from.x, from.z, this.distH);
		let best = -1;
		let bestScore = Number.NEGATIVE_INFINITY;
		const maxWalk = R * 1.6;
		const exitNow = Math.hypot(s.px - s.layout.gate[0], s.pz - s.layout.exitZ);
		for (let t = 0; t < grid.size; t++) {
			const dp = this.distP[t] as number;
			if (dp < 0 || dp > maxWalk) continue;
			const x = grid.cx(t);
			const z = grid.cz(t);
			let threat = 0;
			let near = 99;
			for (const g of s.guards) {
				threat += this.threat(g, x, z);
				near = Math.min(near, Math.hypot(x - g.x, z - g.z));
			}
			let score: number;
			if (from && duck) {
				// Ducking: the nearest dark tile out of the watcher's sight, not towards it.
				const dh = this.distH[t] as number;
				if (dh >= 0 && dh - dp < 0.5) continue;
				if (this.seenBy(from, x, z, 1)) continue;
				score =
					-dp -
					12 * (s.light[t] as number) -
					6 * threat +
					Math.min(this.route[t] as number, 3);
			} else if (from) {
				// Fleeing: far from the hunter by its own walking distance, reached well ahead of it.
				const dh = this.distH[t] as number;
				const margin = dh < 0 ? 20 : dh - dp;
				if (margin < 2 || dp < 6) continue;
				score =
					Math.min(dh < 0 ? 30 : dh, 30) -
					6 * threat -
					3 * (s.light[t] as number) -
					0.1 * dp +
					Math.min(this.route[t] as number, 4);
				if (!s.clearSight(from.x, from.z, x, TUNE.headY, z)) score += 4;
				// Carrying the relic, the gate is the best hiding place of all.
				if (s.hasRelic)
					score +=
						1.2 *
						(exitNow - Math.hypot(x - s.layout.gate[0], z - s.layout.exitZ));
			} else
				score =
					Math.min(near, 10) -
					8 * threat -
					6 * (s.light[t] as number) -
					0.25 * dp +
					2.5 * Math.min(this.route[t] as number, 4);
			if (score > bestScore) {
				bestScore = score;
				best = t;
			}
		}
		if (best < 0 && from) {
			// Cornered: the reachable tile we gain most ground on, whatever it costs.
			for (let t = 0; t < grid.size; t++) {
				const dp = this.distP[t] as number;
				if (dp < 1 || dp > maxWalk) continue;
				const dh = this.distH[t] as number;
				const score = dh < 0 ? 99 : dh - dp;
				if (score > bestScore) {
					bestScore = score;
					best = t;
				}
			}
		}
		if (best < 0) {
			this.tx = s.px;
			this.tz = s.pz;
			return;
		}
		this.tx = grid.cx(best);
		this.tz = grid.cz(best);
	}

	private plan(gx: number, gz: number): void {
		const s = this.sim;
		const grid = s.grid;
		const cost = this.cost;
		for (let i = 0; i < cost.length; i++) cost[i] = 5 * (s.light[i] as number);
		for (const g of s.guards) {
			const R = g.state === GUARD.ALERT ? 9 : THREAT_RANGE;
			const w = grid.w;
			const a0 = Math.max(0, Math.floor((g.x - R - grid.x0) / 0.5));
			const b0 = Math.max(0, Math.floor((g.z - R - grid.z0) / 0.5));
			const span = Math.ceil((2 * R) / 0.5) + 1;
			for (let b = b0; b < Math.min(grid.h, b0 + span); b++)
				for (let a = a0; a < Math.min(w, a0 + span); a++) {
					const t = b * w + a;
					const th = this.threat(g, grid.cx(t), grid.cz(t));
					if (th > 0)
						cost[t] =
							(cost[t] as number) + (g.state === GUARD.ALERT ? 90 : 45) * th;
				}
		}
		const from = grid.nearestWalkable(s.px, s.pz, 3);
		const to = grid.nearestWalkable(gx, gz, 4);
		this.pathLen =
			from >= 0 && to >= 0 ? grid.findPath(from, to, this.path, cost) : 0;
		this.pathIdx = 0;
	}
}
