/**
 * One byte per player per tick: the held state of every control. The sim derives presses
 * (edges) itself from the previous tick, so a log of held bytes replays exactly.
 */
export const IN = {
	UP: 1,
	LEFT: 2,
	DOWN: 4,
	RIGHT: 8,
	/** J: grip (hold), beat (press in a window), squeeze (hold in a submission). */
	GRIP: 16,
	/** K: breathe. */
	BREATHE: 32,
	/** L: posture (defensive frame; stalling if held too long). */
	POSTURE: 64,
} as const;

export const DIR_BITS = [IN.UP, IN.LEFT, IN.DOWN, IN.RIGHT] as const;

/** Growable log of two bytes per tick (no allocation per tick until it doubles). */
export class InputLog {
	private buf = new Uint8Array(2 * 60 * 60 * 4);
	length = 0;
	push(a: number, b: number): void {
		if ((this.length + 1) * 2 > this.buf.length) {
			const n = new Uint8Array(this.buf.length * 2);
			n.set(this.buf);
			this.buf = n;
		}
		this.buf[this.length * 2] = a;
		this.buf[this.length * 2 + 1] = b;
		this.length++;
	}
	get(t: number, p: number): number {
		return this.buf[t * 2 + p] as number;
	}
	clear(): void {
		this.length = 0;
	}
	clone(): InputLog {
		const l = new InputLog();
		l.buf = this.buf.slice(0, Math.max(2, this.length * 2));
		l.length = this.length;
		return l;
	}
	get bytes(): number {
		return this.length * 2;
	}
}
