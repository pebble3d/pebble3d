/** Per-tick input bits. Movement bits drive the engine's character; the rest drive the sim. */
export const BTN = {
	F: 1,
	B: 2,
	L: 4,
	R: 8,
	SPRINT: 16,
	JUMP: 32,
	/** Edge: enter/leave photo mode. */
	PHOTO: 64,
	/** Edge: release the shutter. */
	SHUTTER: 128,
	/** Edge: autofocus on the subject nearest the frame centre. */
	AF: 256,
	/** Edge: one third stop brighter / darker. */
	EV_UP: 512,
	EV_DOWN: 1024,
	/** Edge: start / restart (title and results). */
	START: 2048,
} as const;

export const MOVE_MASK = BTN.F | BTN.B | BTN.L | BTN.R | BTN.SPRINT | BTN.JUMP;

/**
 * One tick of input. Angles and amounts are quantised (`quantize`) before the sim sees them,
 * so a logged input replays bit-identically.
 */
export interface TickInput {
	buttons: number;
	/** Exploration camera yaw (radians): the movement frame and the photo mode's start yaw. */
	camYaw: number;
	/** Photo mode look deltas, radians. */
	lookYaw: number;
	lookPitch: number;
	/** Photo mode zoom delta, degrees of field of view (negative zooms in). */
	zoom: number;
	/** Photo mode manual focus delta, metres. */
	focus: number;
}

export function emptyInput(): TickInput {
	return { buttons: 0, camYaw: 0, lookYaw: 0, lookPitch: 0, zoom: 0, focus: 0 };
}

/** Rounds to 1/4096: stable across JS engines and cheap to log. */
export function quantize(x: number): number {
	return Math.round(x * 4096) / 4096;
}

export function quantizeInput(i: TickInput): void {
	i.camYaw = quantize(i.camYaw);
	i.lookYaw = quantize(i.lookYaw);
	i.lookPitch = quantize(i.lookPitch);
	i.zoom = quantize(i.zoom);
	i.focus = quantize(i.focus);
}

/** Append-only input log (for replays and the determinism test). Grows in chunks. */
export class InputLog {
	private buf = new Float64Array(6 * 4096);
	length = 0;

	push(i: TickInput): void {
		if ((this.length + 1) * 6 > this.buf.length) {
			const next = new Float64Array(this.buf.length * 2);
			next.set(this.buf);
			this.buf = next;
		}
		const o = this.length * 6;
		this.buf[o] = i.buttons;
		this.buf[o + 1] = i.camYaw;
		this.buf[o + 2] = i.lookYaw;
		this.buf[o + 3] = i.lookPitch;
		this.buf[o + 4] = i.zoom;
		this.buf[o + 5] = i.focus;
		this.length++;
	}

	clear(): void {
		this.length = 0;
	}

	read(n: number, out: TickInput): TickInput {
		const o = n * 6;
		out.buttons = this.buf[o] as number;
		out.camYaw = this.buf[o + 1] as number;
		out.lookYaw = this.buf[o + 2] as number;
		out.lookPitch = this.buf[o + 3] as number;
		out.zoom = this.buf[o + 4] as number;
		out.focus = this.buf[o + 5] as number;
		return out;
	}
}
