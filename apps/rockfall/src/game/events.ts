import { MAX_EVENTS } from "./constants.ts";

/** Event types the sim emits for presentation (VFX, audio, HUD). */
export const EV = {
	RESET: 1,
	COUNTDOWN: 2,
	WAVE_START: 3,
	WAVE_CLEAR: 4,
	/** A wave pattern begins: a = pattern id, x/z = focus. */
	PATTERN: 5,
	/** A rock hit the ground or the pile hard: a = kind, u = impact speed, v = radius. */
	LAND: 6,
	/** The player was hit: a = kind, u = damage, v = shield absorbed (0/1). */
	HIT: 7,
	/** A rock fell close past the player: a = points, u = multiplier after. */
	NEAR_MISS: 8,
	PICKUP_SPAWN: 9,
	/** a = pickup type, u = points/amount. */
	PICKUP: 10,
	/** A meteor detonated on landing: u = blast radius. */
	BLAST: 11,
	/** An old rock crumbled away (rock cap): v = radius. */
	CRUMBLE: 12,
	JUMP: 13,
	GAME_OVER: 14,
	/** A pickup expired: a = type. */
	PICKUP_LOST: 15,
} as const;

/**
 * Fixed-capacity event list in parallel typed arrays. The sim clears it at the start of
 * every tick; the presentation reads `0..n` after the tick. Overflow drops (and counts).
 */
export class EventQueue {
	readonly type = new Int16Array(MAX_EVENTS);
	readonly a = new Int32Array(MAX_EVENTS);
	readonly x = new Float32Array(MAX_EVENTS);
	readonly y = new Float32Array(MAX_EVENTS);
	readonly z = new Float32Array(MAX_EVENTS);
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
