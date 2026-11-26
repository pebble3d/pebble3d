import { describe, expect, it } from "vitest";
import { MenuGate } from "../src/game/gate.ts";

describe("menu gate (dash keys must not skip replays or results)", () => {
	it("swallows confirm presses for 0.75 s after arming, then accepts them", () => {
		const g = new MenuGate();
		expect(g.accept(true)).toBe(true);
		g.arm();
		// a player still mashing dash at 60 Hz for the first 0.7 s
		for (let f = 0; f < 42; f++) {
			g.tick(1 / 60);
			expect(g.accept(true)).toBe(false);
		}
		for (let f = 0; f < 4; f++) g.tick(1 / 60);
		expect(g.locked).toBe(false);
		expect(g.accept(true)).toBe(true);
		expect(g.accept(false)).toBe(false);
	});
	it("re-arming restarts the lockout (verdict after replay, results after verdict)", () => {
		const g = new MenuGate();
		g.arm();
		for (let f = 0; f < 60; f++) g.tick(1 / 60);
		g.arm();
		expect(g.accept(true)).toBe(false);
	});
});
