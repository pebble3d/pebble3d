import { describe, expect, it } from "vitest";
import { aimVelocity, reachable, sampleArc } from "../src/game/aim.ts";
import { GRAVITY } from "../src/game/constants.ts";

describe("aim", () => {
	it("the low arc passes through the target", () => {
		const from = [0, 2.4, 30] as const;
		const to = [3, 4, 0] as const;
		const v = aimVelocity(from, to, 45);
		expect(Math.hypot(...v)).toBeCloseTo(45, 3);
		const dh = Math.hypot(to[0] - from[0], to[2] - from[2]);
		const t = dh / Math.hypot(v[0], v[2]);
		expect(from[0] + v[0] * t).toBeCloseTo(to[0], 2);
		expect(from[1] + v[1] * t - 0.5 * GRAVITY * t * t).toBeCloseTo(to[1], 2);
		expect(from[2] + v[2] * t).toBeCloseTo(to[2], 2);
		// The flat solution: under 20 degrees at this speed.
		expect(Math.atan2(v[1], Math.hypot(v[0], v[2]))).toBeLessThan(0.35);
	});

	it("falls back to 45 degrees when out of reach", () => {
		const from = [0, 0, 0] as const;
		const to = [0, 0, -500] as const;
		expect(reachable(from, to, 20)).toBe(false);
		const v = aimVelocity(from, to, 20);
		expect(v[1]).toBeCloseTo(-v[2], 4);
	});

	it("rounds components to f32", () => {
		const v = aimVelocity([0, 1, 9], [1.234567, 2.345678, 0], 33.3333);
		for (const c of v) expect(Math.fround(c)).toBe(c);
	});

	it("samples the arc until it hits the ground", () => {
		const out = new Float32Array(300);
		const n = sampleArc([0, 2, 0], [0, 5, -20], 0.05, out);
		expect(n).toBeGreaterThan(5);
		expect(n).toBeLessThan(100);
		expect(out[(n - 1) * 3 + 1]).toBeLessThan(0);
	});
});
