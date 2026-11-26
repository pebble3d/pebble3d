import { MAX_PLAYERS } from "./constants.ts";

/**
 * One player's intent for one tick, in WORLD space: `x`, `z` are a stick quantised to int8
 * (-127..127), `buttons` a bit set. Humans and bots produce the same record, so the sim
 * cannot tell them apart and a log replays either.
 */
export interface PlayerInput {
	x: number;
	z: number;
	buttons: number;
}

export const BTN = { DASH: 1 } as const;

/** One lockstep frame: every slot's input for the same tick. */
export type FrameInput = PlayerInput[];

export function emptyFrame(): FrameInput {
	const f: FrameInput = [];
	for (let i = 0; i < MAX_PLAYERS; i++) f.push({ x: 0, z: 0, buttons: 0 });
	return f;
}

export function clearFrame(f: FrameInput): void {
	for (const p of f) {
		p.x = 0;
		p.z = 0;
		p.buttons = 0;
	}
}

/** Clamps a [-1, 1] axis to an int8 in [-127, 127]. */
export function quantize(v: number): number {
	const q = Math.round(v * 127);
	return Math.min(127, Math.max(-127, q));
}

/** Writes a stick (any length, clamped to 1) into `out` as quantised world axes. */
export function setStick(out: PlayerInput, x: number, z: number): void {
	const l = Math.hypot(x, z);
	if (l > 1) {
		x /= l;
		z /= l;
	}
	out.x = quantize(x);
	out.z = quantize(z);
}

const STRIDE = 3 * MAX_PLAYERS;

/**
 * The round's lockstep input log: 12 bytes per tick (x, z, buttons for each of 4 slots).
 * This is exactly what an online lockstep session would exchange each tick.
 */
export class InputLog {
	private buf = new Int8Array(STRIDE * 4096);
	length = 0;

	clear(): void {
		this.length = 0;
	}

	push(f: FrameInput): void {
		if ((this.length + 1) * STRIDE > this.buf.length) {
			const next = new Int8Array(this.buf.length * 2);
			next.set(this.buf);
			this.buf = next;
		}
		let o = this.length * STRIDE;
		for (let i = 0; i < MAX_PLAYERS; i++) {
			const p = f[i] as PlayerInput;
			this.buf[o++] = p.x;
			this.buf[o++] = p.z;
			this.buf[o++] = p.buttons;
		}
		this.length++;
	}

	/** Writes tick `t` into `out` (all zero past the end). */
	read(t: number, out: FrameInput): FrameInput {
		if (t < 0 || t >= this.length) {
			clearFrame(out);
			return out;
		}
		let o = t * STRIDE;
		for (let i = 0; i < MAX_PLAYERS; i++) {
			const p = out[i] as PlayerInput;
			p.x = this.buf[o++] as number;
			p.z = this.buf[o++] as number;
			p.buttons = this.buf[o++] as number;
		}
		return out;
	}

	/** Bytes the log occupies (for the HUD). */
	get bytes(): number {
		return this.length * STRIDE;
	}

	/** An independent copy (the round record keeps it after the live log is cleared). */
	clone(): InputLog {
		const l = new InputLog();
		l.buf = this.buf.slice(0, Math.max(STRIDE * 64, this.length * STRIDE));
		l.length = this.length;
		return l;
	}
}
