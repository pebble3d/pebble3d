/** Small deterministic PRNG (mulberry32). Integer ops only, so identical everywhere. */
export class Rng {
	private s: number;
	constructor(seed: number) {
		this.s = seed >>> 0 || 0x9e3779b9;
	}
	/** Uniform in [0, 1). */
	next(): number {
		this.s = (this.s + 0x6d2b79f5) >>> 0;
		let t = this.s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	range(a: number, b: number): number {
		return a + (b - a) * this.next();
	}
}
