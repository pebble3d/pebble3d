import { describe, expect, it } from "vitest";
import { FixedStepLoop } from "../src/loop.ts";

describe("FixedStepLoop", () => {
	it("realtime 1/60 gives one tick", () => {
		const l = new FixedStepLoop({ mode: "realtime" });
		const r = l.advance(1 / 60, 0);
		expect(r.ticks).toBe(1);
		expect(r.alpha).toBeCloseTo(0, 5);
	});
	it("two 1/120 frames give 0 then 1 ticks", () => {
		const l = new FixedStepLoop({ mode: "realtime" });
		let r = l.advance(1 / 120, 0);
		expect(r.ticks).toBe(0);
		expect(r.alpha).toBeCloseTo(0.5, 5);
		r = l.advance(1 / 120, 0);
		expect(r.ticks).toBe(1);
	});
	it("clamps a huge frame to 5 ticks and drops the rest", () => {
		const l = new FixedStepLoop({ mode: "realtime" });
		expect(l.advance(10, 0).ticks).toBe(5);
		expect(l.advance(1 / 60, 0).ticks).toBe(1);
	});
	it("fixed mode steps once with alpha 1", () => {
		const l = new FixedStepLoop({ mode: "fixed" });
		expect(l.advance(0.5, 0)).toEqual({ ticks: 1, alpha: 1 });
	});
	it("fixed mode stops at stopAtTick", () => {
		const l = new FixedStepLoop({ mode: "fixed", stopAtTick: 3 });
		expect(l.advance(0.5, 2).ticks).toBe(1);
		expect(l.advance(0.5, 3).ticks).toBe(0);
	});
});
