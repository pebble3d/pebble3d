/** mulberry32: small seeded generator. The only randomness allowed in the sim and the CPU. */
export class Rng {
	private s: number;
	constructor(seed: number) {
		this.s = seed >>> 0 || 0x9e3779b9;
	}
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
	int(a: number, b: number): number {
		return Math.floor(this.range(a, b + 1));
	}
	/** Roughly normal in [-1, 1] (sum of three uniforms). */
	tri(): number {
		return (this.next() + this.next() + this.next()) / 1.5 - 1;
	}
	get state(): number {
		return this.s;
	}
}
