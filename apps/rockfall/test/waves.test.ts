import { describe, expect, it } from "vitest";
import { WAVE_TICKS } from "../src/game/constants.ts";
import { Rng } from "../src/game/rng.ts";
import {
	KIND,
	ROCK_KINDS,
	rockPoints,
	variantRadius,
} from "../src/game/rocks.ts";
import { PATTERN, planWave, rainRates } from "../src/game/waves.ts";

describe("waves", () => {
	it("plans the same wave for the same rng state, sorted by tick", () => {
		const a = planWave(4, new Rng(11));
		const b = planWave(4, new Rng(11));
		expect(a).toEqual(b);
		for (let i = 1; i < a.length; i++)
			expect((a[i] as { at: number }).at).toBeGreaterThanOrEqual(
				(a[i - 1] as { at: number }).at,
			);
		expect(a.every((o) => o.at >= 0 && o.at < WAVE_TICKS)).toBe(true);
	});

	it("escalates: more rain, more specials, new patterns unlock", () => {
		const total = (n: number) => rainRates(n).reduce((s, [, r]) => s + r, 0);
		for (let n = 1; n < 8; n++) expect(total(n + 1)).toBeGreaterThan(total(n));
		const specials = (n: number) =>
			planWave(n, new Rng(1)).filter((o) => o.pattern !== PATTERN.RAIN).length;
		expect(specials(8)).toBeGreaterThan(specials(1));
		const kinds = (n: number) =>
			new Set(planWave(n, new Rng(1)).map((o) => o.kind));
		expect(kinds(1).has(KIND.BOULDER)).toBe(false);
		expect(kinds(6).has(KIND.BOULDER)).toBe(true);
		const pats = new Set<number>();
		for (let s = 0; s < 20; s++)
			for (const o of planWave(6, new Rng(s))) pats.add(o.pattern);
		expect(pats.has(PATTERN.METEORS)).toBe(true);
		expect(pats.has(PATTERN.SLIDE)).toBe(true);
	});
});

describe("rock shapes", () => {
	it("are deterministic and bounded by the variant radius", () => {
		for (const k of ROCK_KINDS)
			for (let v = 0; v < k.variants; v++) {
				const p = rockPoints(k.id, v);
				expect(p).toEqual(rockPoints(k.id, v));
				expect(p.length).toBe(k.points * 3);
				const r = variantRadius(k.id, v);
				for (let i = 0; i < p.length; i += 3) {
					const d = Math.hypot(
						p[i] as number,
						p[i + 1] as number,
						p[i + 2] as number,
					);
					expect(d).toBeLessThanOrEqual(r * 1.12 * 1.5);
				}
			}
	});
});
