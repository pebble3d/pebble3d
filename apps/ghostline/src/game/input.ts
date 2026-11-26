/**
 * One tick of player intent, already in WORLD space (the camera turned it before logging),
 * so the sim never depends on presentation. `x`/`z` are a tilt vector quantised to int8.
 */
export interface TickInput {
	x: number;
	z: number;
	buttons: number;
}

export const BTN = { JUMP: 1, BRAKE: 2 } as const;

export function emptyInput(): TickInput {
	return { x: 0, z: 0, buttons: 0 };
}

/** Clamps a [-1, 1] axis to an int8 in [-127, 127]. */
export function quantize(v: number): number {
	const q = Math.round(v * 127);
	return q > 127 ? 127 : Math.max(q, -127);
}

/** Growable log of tick inputs: three bytes per tick (x, z, buttons). */
export class InputLog {
	private buf = new Int8Array(3 * 4096);
	length = 0;

	clear(): void {
		this.length = 0;
	}

	push(i: TickInput): void {
		if ((this.length + 1) * 3 > this.buf.length) {
			const next = new Int8Array(this.buf.length * 2);
			next.set(this.buf);
			this.buf = next;
		}
		const o = this.length * 3;
		this.buf[o] = i.x;
		this.buf[o + 1] = i.z;
		this.buf[o + 2] = i.buttons;
		this.length++;
	}

	/** Writes tick `t` into `out` (zero input past the end). */
	read(t: number, out: TickInput): TickInput {
		if (t < 0 || t >= this.length) {
			out.x = 0;
			out.z = 0;
			out.buttons = 0;
			return out;
		}
		const o = t * 3;
		out.x = this.buf[o] as number;
		out.z = this.buf[o + 1] as number;
		out.buttons = this.buf[o + 2] as number;
		return out;
	}

	bytes(): Int8Array {
		return this.buf.slice(0, this.length * 3);
	}

	static from(bytes: Int8Array): InputLog {
		const l = new InputLog();
		const n = Math.floor(bytes.length / 3);
		l.buf = new Int8Array(Math.max(3 * 4096, n * 3));
		l.buf.set(bytes.subarray(0, n * 3));
		l.length = n;
		return l;
	}

	/** Run-length encoded base64: (count u16, x, z, buttons) runs. Compact for storage. */
	encode(): string {
		const out: number[] = [];
		let i = 0;
		while (i < this.length) {
			const o = i * 3;
			const x = this.buf[o] as number;
			const z = this.buf[o + 1] as number;
			const b = this.buf[o + 2] as number;
			let n = 1;
			while (
				i + n < this.length &&
				n < 0xffff &&
				this.buf[o + n * 3] === x &&
				this.buf[o + n * 3 + 1] === z &&
				this.buf[o + n * 3 + 2] === b
			)
				n++;
			out.push(n & 0xff, n >>> 8, x & 0xff, z & 0xff, b & 0xff);
			i += n;
		}
		let s = "";
		for (const v of out) s += String.fromCharCode(v);
		return btoa(s);
	}

	/** Throws on malformed data or when the log would exceed `maxTicks` (no runaway RLE). */
	static decode(b64: string, maxTicks = Number.POSITIVE_INFINITY): InputLog {
		const s = atob(b64);
		if (s.length % 5 !== 0) throw new Error("input log: corrupt run data");
		const l = new InputLog();
		const tmp = emptyInput();
		const i8 = (c: number): number => (c > 127 ? c - 256 : c);
		for (let k = 0; k < s.length; k += 5) {
			const n = s.charCodeAt(k) | (s.charCodeAt(k + 1) << 8);
			if (l.length + n > maxTicks)
				throw new Error("input log: longer than allowed");
			tmp.x = i8(s.charCodeAt(k + 2));
			tmp.z = i8(s.charCodeAt(k + 3));
			tmp.buttons = i8(s.charCodeAt(k + 4));
			for (let j = 0; j < n; j++) l.push(tmp);
		}
		return l;
	}
}
