export const CMD = {
	NONE: 0,
	START: 1,
	PLACE: 2,
	UPGRADE: 3,
	SELL: 4,
	CALL_WAVE: 5,
	RESTART: 6,
} as const;
export type Cmd = (typeof CMD)[keyof typeof CMD];

/** One tick of player intent: at most one command. PLACE: a = tower type, b = build cell; UPGRADE/SELL: a = tower index. */
export interface TickInput {
	cmd: number;
	a: number;
	b: number;
}

export function emptyInput(): TickInput {
	return { cmd: CMD.NONE, a: 0, b: 0 };
}

/** FIFO of pending commands (main thread or worker side). Fixed capacity, no allocation per tick. */
export class CmdQueue {
	private readonly buf = new Int32Array(64 * 3);
	private head = 0;
	private n = 0;
	push(cmd: number, a = 0, b = 0): void {
		if (this.n >= 64) return;
		const i = ((this.head + this.n) % 64) * 3;
		this.buf[i] = cmd;
		this.buf[i + 1] = a;
		this.buf[i + 2] = b;
		this.n++;
	}
	/** Pops one command into `out` (or NONE). */
	pop(out: TickInput): void {
		if (this.n === 0) {
			out.cmd = CMD.NONE;
			out.a = 0;
			out.b = 0;
			return;
		}
		const i = this.head * 3;
		out.cmd = this.buf[i] as number;
		out.a = this.buf[i + 1] as number;
		out.b = this.buf[i + 2] as number;
		this.head = (this.head + 1) % 64;
		this.n--;
	}
	get length(): number {
		return this.n;
	}
}
