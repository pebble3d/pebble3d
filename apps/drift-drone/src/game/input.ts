/**
 * One tick of pilot intent: four stick axes quantised to int8 (-127..127). The sim reads only
 * these, so a run is fully defined by (track, flight mode, input log).
 *   throttle: assisted = climb rate command; acro = raw thrust (-127 idle .. 127 full)
 *   yaw, pitch (+ = nose down / forward), roll (+ = right)
 */
export interface TickInput {
	throttle: number;
	yaw: number;
	pitch: number;
	roll: number;
}

export const STRIDE = 4;

export function emptyInput(): TickInput {
	return { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
}

/** Clamps a [-1, 1] axis to an int8 in [-127, 127]. */
export function quantize(v: number): number {
	if (Number.isNaN(v)) return 0; // NaN (a faulty pad axis) must never reach the sim
	const q = Math.round(v * 127);
	return q > 127 ? 127 : Math.max(q, -127);
}

export function copyInput(src: TickInput, out: TickInput): TickInput {
	out.throttle = src.throttle;
	out.yaw = src.yaw;
	out.pitch = src.pitch;
	out.roll = src.roll;
	return out;
}

/** Growable log of tick inputs: four bytes per tick. */
export class InputLog {
	private buf = new Int8Array(STRIDE * 4096);
	length = 0;

	clear(): void {
		this.length = 0;
	}

	push(i: TickInput): void {
		if ((this.length + 1) * STRIDE > this.buf.length) {
			const next = new Int8Array(this.buf.length * 2);
			next.set(this.buf);
			this.buf = next;
		}
		const o = this.length * STRIDE;
		this.buf[o] = i.throttle;
		this.buf[o + 1] = i.yaw;
		this.buf[o + 2] = i.pitch;
		this.buf[o + 3] = i.roll;
		this.length++;
	}

	/** Writes tick `t` into `out` (zero input past the end). */
	read(t: number, out: TickInput): TickInput {
		if (t < 0 || t >= this.length) {
			out.throttle = 0;
			out.yaw = 0;
			out.pitch = 0;
			out.roll = 0;
			return out;
		}
		const o = t * STRIDE;
		out.throttle = this.buf[o] as number;
		out.yaw = this.buf[o + 1] as number;
		out.pitch = this.buf[o + 2] as number;
		out.roll = this.buf[o + 3] as number;
		return out;
	}

	/** A copy of the first `n` ticks (default all). */
	slice(n = this.length): InputLog {
		const l = new InputLog();
		const m = Math.min(n, this.length);
		l.buf = new Int8Array(Math.max(STRIDE * 4096, m * STRIDE));
		l.buf.set(this.buf.subarray(0, m * STRIDE));
		l.length = m;
		return l;
	}

	/** Run-length encoded base64: (count u16, 4 axes) runs. */
	encode(): string {
		const out: number[] = [];
		let i = 0;
		const b = this.buf;
		while (i < this.length) {
			const o = i * STRIDE;
			let n = 1;
			while (
				i + n < this.length &&
				n < 0xffff &&
				b[o + n * STRIDE] === b[o] &&
				b[o + n * STRIDE + 1] === b[o + 1] &&
				b[o + n * STRIDE + 2] === b[o + 2] &&
				b[o + n * STRIDE + 3] === b[o + 3]
			)
				n++;
			out.push(
				n & 0xff,
				n >>> 8,
				(b[o] as number) & 0xff,
				(b[o + 1] as number) & 0xff,
				(b[o + 2] as number) & 0xff,
				(b[o + 3] as number) & 0xff,
			);
			i += n;
		}
		let s = "";
		for (const v of out) s += String.fromCharCode(v);
		return btoa(s);
	}

	/** Throws on malformed data or when the log would exceed `maxTicks`. */
	static decode(b64: string, maxTicks = Number.POSITIVE_INFINITY): InputLog {
		const s = atob(b64);
		const R = 2 + STRIDE;
		if (s.length % R !== 0) throw new Error("input log: corrupt run data");
		const l = new InputLog();
		const tmp = emptyInput();
		const i8 = (c: number): number => (c > 127 ? c - 256 : c);
		for (let k = 0; k < s.length; k += R) {
			const n = s.charCodeAt(k) | (s.charCodeAt(k + 1) << 8);
			if (n === 0 || l.length + n > maxTicks)
				throw new Error("input log: bad run length");
			tmp.throttle = i8(s.charCodeAt(k + 2));
			tmp.yaw = i8(s.charCodeAt(k + 3));
			tmp.pitch = i8(s.charCodeAt(k + 4));
			tmp.roll = i8(s.charCodeAt(k + 5));
			for (let j = 0; j < n; j++) l.push(tmp);
		}
		return l;
	}
}
