import { describe, expect, it } from "vitest";
import { DemoBot } from "../src/game/bot.ts";
import { ReplayKeeper } from "../src/game/replay.ts";
import { emptyInput, PHASE, Session } from "../src/game/session.ts";
import { Site } from "../src/game/site.ts";
import { worldSource } from "./helpers.ts";
import { MINI } from "./mini.ts";

function runToEnd(s: Session, maxTicks = 20000): void {
	const bot = new DemoBot(s);
	const inp = emptyInput();
	for (let t = 0; t < maxTicks && s.phase !== PHASE.RUN_DONE; t++) {
		bot.next(inp);
		s.step(inp);
	}
}

describe("session", () => {
	it("stars follow par, 60% and 85%", () => {
		expect(Session.stars(MINI, 0.1)).toBe(0);
		expect(Session.stars(MINI, 0.2)).toBe(1);
		expect(Session.stars(MINI, 0.6)).toBe(2);
		expect(Session.stars(MINI, 0.9)).toBe(3);
	});

	it("counts shots and ignores fire outside the aim phase", async () => {
		const src = await worldSource();
		const s = new Session(src, 3, {}, [MINI]);
		const inp = emptyInput();
		inp.fire = true;
		inp.vz = -20;
		s.step(inp); // settling: ignored
		expect(s.phase).toBe(PHASE.SETTLING);
		while (s.phase === PHASE.SETTLING) s.step(emptyInput());
		expect(s.shotsLeft).toBe(2);
		s.step(inp);
		expect(s.phase).toBe(PHASE.SHOT);
		expect(s.shotsLeft).toBe(1);
		expect(s.levelShots.length).toBe(1);
		s.site.free();
	}, 60_000);

	it("a demo run reaches the end with a score, deterministically", async () => {
		const src = await worldSource();
		const a = new Session(src, 9, {}, [MINI, MINI]);
		runToEnd(a);
		expect(a.phase).toBe(PHASE.RUN_DONE);
		expect(a.results.length).toBe(4);
		expect(a.totalKg).toBeGreaterThan(0);
		expect(a.best).not.toBeNull();
		const b = new Session(src, 9, {}, [MINI, MINI]);
		runToEnd(b);
		expect(b.hash()).toBe(a.hash());
		expect(b.results.map((r) => r.endHash)).toEqual(
			a.results.map((r) => r.endHash),
		);
		a.site.free();
		b.site.free();
	}, 120_000);

	it("a rebuilt site fed the same shots reproduces every shot's end hash", async () => {
		const src = await worldSource();
		const s = new Session(src, 4, {}, [MINI]);
		runToEnd(s);
		const r = new Site(src, MINI, s.levelSeed(0));
		let next = 0;
		for (const res of s.results) {
			while (r.tick < res.endTick) {
				const sh = s.results[next]?.shot;
				if (sh && sh.tick === r.tick) {
					r.fire(sh);
					next++;
				}
				r.step();
			}
			expect(r.hash()).toBe(res.endHash);
		}
		r.free();
		s.site.free();
	}, 120_000);

	it("the replay keeper parks the best shot and replays it bit-identically", async () => {
		const src = await worldSource();
		const keeper = new ReplayKeeper(src);
		let clock = 0;
		const s = new Session(
			src,
			21,
			{
				onLevel: (site, i, seed) => keeper.beginLevel(site.level, seed, i),
				onFire: (shot) => keeper.noteShot(shot),
				onShotDone: (r, best) => keeper.onShotDone(r, best),
			},
			[MINI],
		);
		const bot = new DemoBot(s);
		const inp = emptyInput();
		while (s.phase !== PHASE.RUN_DONE) {
			bot.next(inp);
			s.step(inp);
			// A tiny budget per tick, like idle frame time.
			keeper.pump(0.5, () => (clock += 0.1), s.site.tick);
		}
		keeper.finish();
		expect(keeper.ready).toBe(true);
		const rep = keeper.take();
		expect(rep).not.toBeNull();
		if (!rep) return;
		expect(rep.site.tick).toBe(rep.shot.tick);
		rep.site.fire(rep.shot);
		while (rep.site.tick < rep.result.endTick) rep.site.step();
		expect(rep.site.hash()).toBe(rep.result.endHash);
		rep.site.free();
		keeper.dispose();
		s.site.free();
	}, 120_000);
});
