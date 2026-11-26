/** Seeded PRNG (mulberry32). Deterministic across runs and engines for a given seed. Allocation-free. */
export class Rng {
	private s: number;

	constructor(seed: number) {
		this.s = seed >>> 0 || 0x9e3779b9;
	}

	/** Uniform in [0, 1). */
	next(): number {
		this.s = (this.s + 0x6d2b79f5) | 0;
		let t = this.s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Uniform in [a, b). */
	range(a: number, b: number): number {
		return a + (b - a) * this.next();
	}

	/** Integer in [0, n). */
	int(n: number): number {
		return Math.floor(this.next() * n);
	}

	/** True with probability p. */
	chance(p: number): boolean {
		return this.next() < p;
	}

	pick<T>(xs: readonly T[]): T {
		const x = xs[this.int(xs.length)];
		if (x === undefined) throw new Error("pick from an empty list");
		return x;
	}

	/** Fisher-Yates, in place. */
	shuffle<T>(xs: T[]): T[] {
		for (let i = xs.length - 1; i > 0; i--) {
			const j = this.int(i + 1);
			const t = xs[i] as T;
			xs[i] = xs[j] as T;
			xs[j] = t;
		}
		return xs;
	}
}
