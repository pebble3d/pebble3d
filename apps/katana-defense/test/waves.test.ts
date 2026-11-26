import { describe, expect, it } from "vitest";
import { ARCHETYPES, WAVES } from "../src/game/config.ts";
import { Rng } from "../src/game/rng.ts";
import {
	composeWave,
	type WaveDef,
	WaveDirector,
	waveComposition,
} from "../src/game/waves/director.ts";

const weights = [1, 1, 1, 0.5];
const idx = (id: string) => ARCHETYPES.findIndex((a) => a.id === id);

function compose(def: WaveDef, seed: number) {
	const t = new Int8Array(256);
	const s = new Int8Array(256);
	const k = new Float32Array(256);
	const n = composeWave(def, ARCHETYPES, weights, new Rng(seed), t, s, k);
	return {
		n,
		types: Array.from(t.slice(0, n)),
		spawns: Array.from(s.slice(0, n)),
	};
}

describe("wave data", () => {
	it("has 8 waves that escalate", () => {
		expect(WAVES.waves).toHaveLength(8);
		let prevTotal = 0;
		let prevMax = 0;
		WAVES.waves.forEach((w, i) => {
			const c = waveComposition(w);
			const total = Object.values(c).reduce((a, b) => a + b, 0);
			expect(total).toBeGreaterThan(prevTotal);
			expect(w.maxAlive).toBeGreaterThanOrEqual(prevMax);
			expect(w.maxAlive).toBeLessThanOrEqual(40);
			prevTotal = total;
			prevMax = w.maxAlive;
			const wave = i + 1;
			expect((c.runner ?? 0) > 0).toBe(wave >= 3);
			expect((c.brute ?? 0) > 0).toBe(wave >= 5);
		});
	});
});

describe("composeWave", () => {
	it("emits exactly the composition, with valid spawn points", () => {
		for (const def of WAVES.waves) {
			const { n, types, spawns } = compose(def, 9);
			const c = waveComposition(def);
			expect(n).toBe(Object.values(c).reduce((a, b) => a + b, 0));
			for (const [k, v] of Object.entries(c))
				expect(types.filter((t) => t === idx(k))).toHaveLength(v);
			for (const s of spawns) expect(s >= 0 && s < weights.length).toBe(true);
		}
	});

	it("is deterministic per seed and varies across seeds", () => {
		const def = WAVES.waves[5] as WaveDef;
		expect(compose(def, 4)).toEqual(compose(def, 4));
		expect(compose(def, 4).spawns).not.toEqual(compose(def, 5).spawns);
	});

	it("holds a group back until its `after` fraction of the wave", () => {
		const def = WAVES.waves[4] as WaveDef; // brute after 0.5
		const { n, types } = compose(def, 2);
		const first = types.indexOf(idx("brute"));
		expect(first).toBeGreaterThanOrEqual(Math.floor(n * 0.4));
	});
});

describe("WaveDirector", () => {
	it("spaces spawns by the interval and respects maxAlive", () => {
		const def: WaveDef = {
			maxAlive: 3,
			interval: 10,
			groups: [{ type: "shambler", count: 8 }],
		};
		const d = new WaveDirector();
		const rng = new Rng(1);
		d.begin(def, ARCHETYPES, weights, rng);
		let alive = 0;
		const at: number[] = [];
		for (let t = 0; t < 400 && !d.exhausted; t++) {
			if (d.next(alive, rng) >= 0) {
				alive++;
				at.push(t);
			}
			if (alive === 3 && t % 50 === 0) alive = 1; // two die
		}
		expect(d.exhausted).toBe(true);
		for (let i = 1; i < at.length; i++)
			expect((at[i] as number) - (at[i - 1] as number)).toBeGreaterThanOrEqual(
				7,
			);
		// never more than maxAlive
		const d2 = new WaveDirector();
		d2.begin(def, ARCHETYPES, weights, rng);
		let n = 0;
		for (let t = 0; t < 1000; t++) if (d2.next(n, rng) >= 0) n++;
		expect(n).toBe(3);
	});
});
