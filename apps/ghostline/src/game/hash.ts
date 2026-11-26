/** FNV-1a 32 over 32-bit words. Feed numbers as f32 bits or ints; deterministic. */
export class Fnv32 {
	h = 0x811c9dc5;
	private readonly f32 = new Float32Array(1);
	private readonly u32 = new Uint32Array(this.f32.buffer);
	reset(): this {
		this.h = 0x811c9dc5;
		return this;
	}
	word(w: number): this {
		let h = this.h;
		for (let i = 0; i < 4; i++) {
			h ^= (w >>> (i * 8)) & 0xff;
			h = Math.imul(h, 0x01000193);
		}
		this.h = h >>> 0;
		return this;
	}
	float(v: number): this {
		this.f32[0] = v;
		return this.word(this.u32[0] as number);
	}
	/** Feeds a string (UTF-16 code units). */
	str(t: string): this {
		for (let i = 0; i < t.length; i++) this.word(t.charCodeAt(i));
		return this;
	}
	hex(): string {
		return this.h.toString(16).padStart(8, "0");
	}
}
