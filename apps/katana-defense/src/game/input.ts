/** Button bits of a tick's held input. */
export const BTN = {
	LIGHT: 1,
	HEAVY: 2,
	DODGE: 4,
	JUMP: 8,
	FOCUS: 16,
	SPRINT: 32,
	START: 64,
	PICK1: 128,
	PICK2: 256,
	PICK3: 512,
} as const;

/**
 * One tick of player input: a world-space XZ move direction (length <= 1, already resolved
 * against the camera) and the held buttons. The sim quantises `mx`/`mz` to 1/127 steps on
 * entry, so live play and a replayed log produce identical state.
 */
export interface TickInput {
	mx: number;
	mz: number;
	buttons: number;
}

export function emptyInput(): TickInput {
	return { mx: 0, mz: 0, buttons: 0 };
}

export function quantize(v: number): number {
	const c = v > 1 ? 1 : Math.max(v, -1);
	return Math.round(c * 127) / 127;
}

/**
 * A recorded input stream (3 bytes of axes + 2 of buttons per tick). Grows by doubling, so
 * recording does not allocate per tick in the steady state.
 */
export class InputLog {
	private axes = new Int8Array(2 * 4096);
	private btns = new Uint16Array(4096);
	length = 0;

	push(i: TickInput): void {
		if (this.length >= this.btns.length) {
			const a = new Int8Array(this.axes.length * 2);
			a.set(this.axes);
			this.axes = a;
			const b = new Uint16Array(this.btns.length * 2);
			b.set(this.btns);
			this.btns = b;
		}
		const n = this.length++;
		this.axes[2 * n] = Math.round(quantize(i.mx) * 127);
		this.axes[2 * n + 1] = Math.round(quantize(i.mz) * 127);
		this.btns[n] = i.buttons;
	}

	read(n: number, out: TickInput): TickInput {
		out.mx = (this.axes[2 * n] ?? 0) / 127;
		out.mz = (this.axes[2 * n + 1] ?? 0) / 127;
		out.buttons = this.btns[n] ?? 0;
		return out;
	}
}
