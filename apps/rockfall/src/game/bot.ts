import {
	ARENA_HALF,
	MAX_HP,
	MAX_PICKUPS,
	PILLAR_HALF,
	PILLARS,
} from "./constants.ts";
import { BTN, type TickInput } from "./input.ts";
import { PHASE } from "./phase.ts";
import { KIND } from "./rocks.ts";
import { PICKUP, type RockfallSim } from "./sim.ts";

const DIRS = 16;
const RINGS = [1.3, 2.8] as const;
const G = 9.81;
/** Threat weight per kind. */
const WEIGHT = [0.15, 1, 1.3, 2.2, 2.6];
const DX = Float32Array.from({ length: DIRS }, (_, i) =>
	Math.cos((i / DIRS) * Math.PI * 2),
);
const DZ = Float32Array.from({ length: DIRS }, (_, i) =>
	Math.sin((i / DIRS) * Math.PI * 2),
);

export interface BotOptions {
	/** Ticks on the title before pressing start. */
	startDelay: number;
	/** Ticks on the results screen before restarting (0 = never). */
	restartDelay: number;
	/** Stand down (stop dodging) after this many waves; 0 = never. */
	waves: number;
}

/**
 * The `?demo=1` autoplayer. Every tick it scores 33 candidate spots (stay, and 16 headings
 * at two ranges) by the predicted landing points of the rocks in the air (Gaussian threat,
 * weighted by kind and by how soon they land), walls and pillars, plus a pull toward
 * pickups, and walks to the safest. It reads only sim state, so a demo run is as
 * deterministic as the sim itself.
 */
export class DemoBot {
	private readonly sim: RockfallSim;
	private readonly o: BotOptions;
	private lastDir = -1;
	private stuck = 0;
	private lx = 0;
	private lz = 0;
	private readonly lxs = new Float32Array(1024);
	private readonly lzs = new Float32Array(1024);
	private readonly lw = new Float32Array(1024);
	private readonly ls = new Float32Array(1024);
	private readonly lt = new Float32Array(1024);
	/** Diagnostics: threat at the player's spot last tick. */
	threat = 0;

	constructor(sim: RockfallSim, o: Partial<BotOptions> = {}) {
		this.sim = sim;
		this.o = { startDelay: 90, restartDelay: 300, waves: 0, ...o };
	}

	next(out: TickInput): void {
		const sim = this.sim;
		out.mx = 0;
		out.mz = 0;
		out.buttons = 0;
		if (sim.phase === PHASE.TITLE) {
			if (sim.phaseTick >= this.o.startDelay) out.buttons = BTN.START;
			return;
		}
		if (sim.phase === PHASE.OVER) {
			if (this.o.restartDelay > 0 && sim.phaseTick >= this.o.restartDelay)
				out.buttons = BTN.START;
			return;
		}
		if (this.o.waves > 0 && sim.wave > this.o.waves) return;
		const n = this.collect();
		const px = sim.px;
		const pz = sim.pz;
		let best = -1;
		let bestScore = this.score(px, pz, n, 0) - 0.05;
		this.threat = bestScore;
		for (let ring = 0; ring < RINGS.length; ring++) {
			const R = RINGS[ring] as number;
			for (let d = 0; d < DIRS; d++) {
				const qx = px + (DX[d] as number) * R;
				const qz = pz + (DZ[d] as number) * R;
				let s = this.score(qx, qz, n, R / 6);
				if (d === this.lastDir) s -= 0.04;
				if (s < bestScore) {
					bestScore = s;
					best = d;
				}
			}
		}
		this.lastDir = best;
		if (best >= 0) {
			out.mx = DX[best] as number;
			out.mz = DZ[best] as number;
			if (this.threat > 0.6) out.buttons |= BTN.SPRINT;
		}
		// Unstick: walking but not moving (rubble lip) -> hop.
		const moved = Math.hypot(px - this.lx, pz - this.lz);
		this.lx = px;
		this.lz = pz;
		if (best >= 0 && moved < 0.01) this.stuck++;
		else this.stuck = 0;
		if (this.stuck > 12) {
			out.buttons |= BTN.JUMP;
			this.stuck = 0;
		}
	}

	/** Predicted landings of the rocks in the air -> scratch arrays. Returns the count. */
	private collect(): number {
		const sim = this.sim;
		const c = sim.views.curr;
		const p = sim.views.prev;
		let n = 0;
		for (let i = 0; i < sim.rockCount && n < this.lxs.length; i++) {
			const o = (sim.rockSlot[i] as number) * 8;
			const y = c[o + 1] as number;
			const vy = (y - (p[o + 1] as number)) * 60;
			if (vy > -1 || y < 0.6) continue;
			const r = sim.rockR[i] as number;
			const h = Math.max(0, y - r);
			const t = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
			if (t > 3) continue;
			const kind = sim.rockKind[i] as number;
			this.lxs[n] =
				(c[o] as number) + ((c[o] as number) - (p[o] as number)) * 60 * t;
			this.lzs[n] =
				(c[o + 2] as number) +
				((c[o + 2] as number) - (p[o + 2] as number)) * 60 * t;
			this.lw[n] = (WEIGHT[kind] ?? 1) * (kind === KIND.METEOR ? 1.6 : 1);
			const sg = r + (kind === KIND.METEOR ? 1.6 : 0.4);
			this.ls[n] = 1 / (2 * sg * sg);
			this.lt[n] = t;
			n++;
		}
		return n;
	}

	private score(x: number, z: number, n: number, travel: number): number {
		const sim = this.sim;
		let s = 0;
		for (let i = 0; i < n; i++) {
			const dx = x - (this.lxs[i] as number);
			const dz = z - (this.lzs[i] as number);
			const t = this.lt[i] as number;
			// A spot reached only after the rock lands is threatened less by it.
			const urg = 1.4 / (0.3 + Math.max(0, t - travel * 0.4));
			s +=
				(this.lw[i] as number) *
				urg *
				Math.exp(-(dx * dx + dz * dz) * (this.ls[i] as number));
		}
		const lim = ARENA_HALF - 1.1;
		if (Math.abs(x) > lim || Math.abs(z) > lim) s += 5;
		for (const [qx, qz] of PILLARS)
			if (
				Math.abs(x - qx) < PILLAR_HALF + 0.7 &&
				Math.abs(z - qz) < PILLAR_HALF + 0.7
			)
				s += 3;
		// Pickups pull (hearts more when hurt).
		for (let i = 0; i < MAX_PICKUPS; i++) {
			const t = sim.pkType[i] as number;
			if (t < 0) continue;
			const d = Math.hypot(
				x - (sim.pkX[i] as number),
				z - (sim.pkZ[i] as number),
			);
			const want =
				t === PICKUP.HEART
					? sim.hp < MAX_HP * 0.75
						? 0.9
						: 0.1
					: t === PICKUP.SHIELD
						? 0.6
						: 0.5;
			s -= want / (1 + d * 0.5);
		}
		// Mild pull toward the open middle.
		s += (x * x + z * z) * 0.0009;
		return s;
	}
}
