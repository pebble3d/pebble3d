import {
	MAX_AGENTS,
	MAX_DEBRIS,
	MAX_EVENTS,
	MAX_SHELLS,
	MAX_TOWERS,
} from "./constants.ts";
import { SHELL_TICKS } from "./defs.ts";
import { EV } from "./events.ts";
import type { SiegeSim } from "./sim.ts";

/**
 * One packed frame of sim state, the only thing the view reads. The worker posts it as a
 * transferred buffer; the inline host packs the same layout. Sections of one Float32Array:
 * header, agents, towers, shells, debris, events.
 */
export const H = {
	TICK: 0,
	PHASE: 1,
	WAVE: 2,
	GOLD: 3,
	CORE: 4,
	ALIVE: 5,
	KILLS: 6,
	SCORE: 7,
	TIMER: 8,
	HW: 9,
	EVENTS: 10,
	TOWERS: 11,
	DEBRIS: 12,
	SHELLS: 13,
	LEAKS: 14,
	SPAWNED: 15,
	PENDING: 16,
	/** Ticks this snapshot advanced (worker batches can carry 2+). */
	TICKS: 17,
	/** Mean ms per tick, filled by the host. */
	SIM_MS: 18,
	LEN: 24,
} as const;

/** Agent: x, z, yaw, code. code = kind+1 (0 = free) + 4*gen(0..15) + 64*flash + 128*slowed. */
export const A_STRIDE = 4;
/** Tower: type (-1 none), level, x, z, aim yaw, ticks since fired, kills, upgrade cost (-1 max). */
export const T_STRIDE = 8;
/** Shell: x0, z0, x1, z1, progress 0..1, radius. */
export const S_STRIDE = 6;
/** Debris: px, py, pz, qx, qy, qz, qw. */
export const D_STRIDE = 7;
/** Event: type, a, x, z, x2, z2. */
export const E_STRIDE = 6;
/** Field offsets inside one packed event. */
export const EF = { TYPE: 0, A: 1, X: 2, Z: 3, X2: 4, Z2: 5 } as const;

export const OFF_AGENTS = H.LEN;
export const OFF_TOWERS = OFF_AGENTS + MAX_AGENTS * A_STRIDE;
export const OFF_SHELLS = OFF_TOWERS + MAX_TOWERS * T_STRIDE;
export const OFF_DEBRIS = OFF_SHELLS + MAX_SHELLS * S_STRIDE;
export const OFF_EVENTS = OFF_DEBRIS + MAX_DEBRIS * D_STRIDE;
export const SNAP_LEN = OFF_EVENTS + MAX_EVENTS * E_STRIDE;

export function newSnapshot(): Float32Array {
	return new Float32Array(SNAP_LEN);
}

/**
 * Packs `sim` into `out`. Events are appended after `out[H.EVENTS]` existing ones (so a
 * batch of ticks keeps every tick's effects); pass `fresh` to start the event list over.
 */
export function packSnapshot(
	sim: SiegeSim,
	out: Float32Array,
	fresh: boolean,
): void {
	out[H.TICK] = sim.tick;
	out[H.PHASE] = sim.phase;
	out[H.WAVE] = sim.wave;
	out[H.GOLD] = sim.gold;
	out[H.CORE] = sim.coreHp;
	out[H.ALIVE] = sim.alive;
	out[H.KILLS] = sim.kills;
	out[H.SCORE] = sim.score;
	out[H.TIMER] = sim.timer;
	out[H.HW] = sim.hw;
	out[H.TOWERS] = sim.nTowers;
	out[H.LEAKS] = sim.leaks;
	out[H.SPAWNED] = sim.totalSpawned;
	out[H.PENDING] = sim.pending;
	out[H.TICKS] = fresh ? 1 : (out[H.TICKS] as number) + 1;
	// agents
	let o: number = OFF_AGENTS;
	for (let i = 0; i < sim.hw; i++, o += A_STRIDE) {
		const k = sim.akind[i] as number;
		if (k < 0) {
			out[o + 3] = 0;
			continue;
		}
		out[o] = sim.ax[i] as number;
		out[o + 1] = sim.az[i] as number;
		out[o + 2] = sim.ayaw[i] as number;
		out[o + 3] =
			k +
			1 +
			4 * (sim.agen[i] as number) +
			((sim.aflash[i] as number) > 0 ? 64 : 0) +
			((sim.aslow[i] as number) > 0 ? 128 : 0);
	}
	// towers
	o = OFF_TOWERS;
	for (let t = 0; t < MAX_TOWERS; t++, o += T_STRIDE) {
		const ty = sim.ttype[t] as number;
		out[o] = ty;
		if (ty < 0) continue;
		out[o + 1] = sim.tlevel[t] as number;
		out[o + 2] = sim.tx[t] as number;
		out[o + 3] = sim.tz[t] as number;
		out[o + 4] = sim.taim[t] as number;
		out[o + 5] = sim.tick - (sim.tfired[t] as number);
		out[o + 6] = sim.tkills[t] as number;
		out[o + 7] = sim.upgradeCost(t);
	}
	// shells
	o = OFF_SHELLS;
	for (let s = 0; s < sim.nShells; s++, o += S_STRIDE) {
		out[o] = sim.sx0[s] as number;
		out[o + 1] = sim.sz0[s] as number;
		out[o + 2] = sim.sx1[s] as number;
		out[o + 3] = sim.sz1[s] as number;
		out[o + 4] = (sim.tick - (sim.sborn[s] as number)) / SHELL_TICKS;
		out[o + 5] = sim.srad[s] as number;
	}
	out[H.SHELLS] = sim.nShells;
	// debris poses from the engine state buffer
	const v = sim.views;
	v.refresh();
	const c = v.curr;
	o = OFF_DEBRIS;
	for (let d = 0; d < sim.nDebris; d++, o += D_STRIDE) {
		const b = (sim.dslot[d] as number) * 8;
		for (let k = 0; k < 7; k++) out[o + k] = c[b + k] as number;
	}
	out[H.DEBRIS] = sim.nDebris;
	// events
	const ev = sim.events;
	let n = fresh ? 0 : (out[H.EVENTS] as number);
	for (let e = 0; e < ev.n && n < MAX_EVENTS; e++) {
		// Coalesced batches can fill up: keep the last 16 slots for lifecycle events.
		if (n >= MAX_EVENTS - 16 && (ev.type[e] as number) < EV.WAVE_START)
			continue;
		const p = OFF_EVENTS + n++ * E_STRIDE;
		out[p] = ev.type[e] as number;
		out[p + 1] = ev.a[e] as number;
		out[p + 2] = ev.x[e] as number;
		out[p + 3] = ev.z[e] as number;
		out[p + 4] = ev.x2[e] as number;
		out[p + 5] = ev.z2[e] as number;
	}
	out[H.EVENTS] = n;
}
