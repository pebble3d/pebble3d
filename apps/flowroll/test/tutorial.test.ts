import { describe, expect, it } from "vitest";
import { MatchSim, PHASE } from "../src/game/sim.ts";
import { TUT_STEPS, Tutorial } from "../src/game/tutorial.ts";

describe("tutorial", () => {
	it("a player following the cards grips, advances, defends, breathes, passes, mounts and finishes", () => {
		const s = new MatchSim({ seed: 1, roundTicks: 0, introTicks: 60 });
		const t = new Tutorial();
		t.begin(s);
		const seen = new Set<number>();
		let done = false;
		for (let i = 0; i < 60 * 120 && !done; i++) {
			s.step(t.mask(s, t.bot(s)), t.partner(s));
			t.afterStep(s);
			seen.add(t.step);
			done = t.update(s, 1 / 60);
		}
		expect(done).toBe(true);
		expect(s.phase).toBe(PHASE.OVER);
		expect(s.winner).toBe(0);
		expect(seen.size).toBe(TUT_STEPS.length);
		expect(t.defended).toBe(true);
	});

	it("the partner's sweep landing resets the defend step instead of breaking the lesson", () => {
		const s = new MatchSim({ seed: 2, roundTicks: 0, introTicks: 1 });
		const t = new Tutorial();
		t.begin(s);
		t.step = 2;
		s.step(0, 0);
		s.step(0, 0);
		s.pos = 1; // closed guard, the player on top
		s.top = 0;
		for (let i = 0; i < 1200 && t.retries === 0; i++) {
			s.step(0, t.partner(s));
			t.afterStep(s);
		}
		expect(t.retries).toBeGreaterThan(0);
		expect(s.pos).toBe(1);
		expect(s.top).toBe(0);
	});
});
