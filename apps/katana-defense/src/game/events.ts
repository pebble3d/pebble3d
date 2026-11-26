import { MAX_EVENTS } from "./constants.ts";

/** Event types the sim emits for presentation (VFX, audio, HUD). */
export const EV = {
	SWING: 1,
	HIT: 2,
	KILL: 3,
	SPAWN: 4,
	TELEGRAPH: 5,
	STRIKE: 6,
	PLAYER_HURT: 7,
	DODGE: 8,
	JUMP: 9,
	LAND: 10,
	SPIN: 11,
	FOCUS_FULL: 12,
	WAVE_START: 13,
	WAVE_CLEAR: 14,
	UPGRADE_OFFER: 15,
	UPGRADE_PICK: 16,
	GAME_OVER: 17,
	VICTORY: 18,
	OBJ_HIT: 19,
	SHOCKWAVE: 20,
	PERFECT_DODGE: 21,
	PRE_WAVE: 22,
	CHARGE_READY: 23,
	ZOMBIE_LAND: 24,
	PLAYER_DOWN: 25,
	RUN_START: 26,
} as const;

/**
 * Fixed-capacity event list in parallel typed arrays. The sim appends; the presentation
 * reads `0..n` once per rendered frame and calls `clear()`. Overflow drops (and counts).
 */
export class EventQueue {
	readonly type = new Int16Array(MAX_EVENTS);
	/** Integer payload (zombie slot, move index, archetype, ...). */
	readonly a = new Int32Array(MAX_EVENTS);
	readonly x = new Float32Array(MAX_EVENTS);
	readonly y = new Float32Array(MAX_EVENTS);
	readonly z = new Float32Array(MAX_EVENTS);
	/** Two free float payloads (direction, damage, ...). */
	readonly u = new Float32Array(MAX_EVENTS);
	readonly v = new Float32Array(MAX_EVENTS);
	n = 0;
	dropped = 0;

	push(type: number, a = 0, x = 0, y = 0, z = 0, u = 0, v = 0): void {
		if (this.n >= MAX_EVENTS) {
			this.dropped++;
			return;
		}
		const i = this.n++;
		this.type[i] = type;
		this.a[i] = a;
		this.x[i] = x;
		this.y[i] = y;
		this.z[i] = z;
		this.u[i] = u;
		this.v[i] = v;
	}

	clear(): void {
		this.n = 0;
	}
}
