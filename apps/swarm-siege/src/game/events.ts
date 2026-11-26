import { MAX_EVENTS } from "./constants.ts";

export const EV = {
	/** a = tower index, (x,z) tower, (x2,z2) target. */
	ZAP: 1,
	/** a = tower index, (x,z) from, (x2,z2) landing; flight ticks in b. */
	SHELL: 2,
	/** a = radius*100, (x,z). */
	BOOM: 3,
	/** a = tower index, (x,z) tower, radius in x2. */
	PULSE: 4,
	/** a = tower index, (x,z) from, (x2,z2) beam end. */
	LANCE: 5,
	/** a = kind, (x,z). */
	KILL: 6,
	/** a = damage, (x,z) where it leaked. */
	LEAK: 7,
	/** a = tower type, (x,z). */
	PLACE: 8,
	/** a = new level, (x,z). */
	UPGRADE: 9,
	/** (x,z). */
	SELL: 10,
	/** a = wave number. */
	WAVE_START: 11,
	/** a = wave number, x = bonus gold. */
	WAVE_CLEAR: 12,
	WON: 13,
	LOST: 14,
	/** a = reason (1 gold, 2 blocked, 3 path). */
	DENY: 15,
	RESET: 16,
} as const;

/** Slots only lifecycle events (WAVE_START and later) may use. */
const RESERVED = 16;

/** Fixed-size event ring, structure of arrays. Overflowing effects are dropped. */
export class EventQueue {
	readonly type = new Uint8Array(MAX_EVENTS);
	readonly a = new Float32Array(MAX_EVENTS);
	readonly x = new Float32Array(MAX_EVENTS);
	readonly z = new Float32Array(MAX_EVENTS);
	readonly x2 = new Float32Array(MAX_EVENTS);
	readonly z2 = new Float32Array(MAX_EVENTS);
	n = 0;
	push(t: number, a: number, x: number, z: number, x2 = 0, z2 = 0): void {
		const i = this.n;
		// The last RESERVED slots are kept for lifecycle events (waves, results, reset).
		if (i >= MAX_EVENTS || (i >= MAX_EVENTS - RESERVED && t < EV.WAVE_START))
			return;
		this.type[i] = t;
		this.a[i] = a;
		this.x[i] = x;
		this.z[i] = z;
		this.x2[i] = x2;
		this.z2[i] = z2;
		this.n = i + 1;
	}
	/** Room left: callers skip optional effects when low. */
	get free(): number {
		return MAX_EVENTS - this.n;
	}
	clear(): void {
		this.n = 0;
	}
}
