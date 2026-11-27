import { describe, expect, it } from "vitest";
import { BELTS } from "../src/game/cpu.ts";
import { POS_INDEX } from "../src/game/graph.ts";
import { IN, InputLog } from "../src/game/input.ts";
import { playCpuMatch, replay } from "../src/game/play.ts";
import { ACT, EV, MatchSim, PHASE, TUNE } from "../src/game/sim.ts";

const { UP, LEFT, DOWN, RIGHT, GRIP, BREATHE, POSTURE } = IN;

/** Steps the sim `n` ticks with fixed held inputs. */
function hold(s: MatchSim, n: number, a: number, b = 0): void {
	for (let i = 0; i < n; i++) s.step(a, b);
}
function live(cfg = {}): MatchSim {
	const s = new MatchSim({ seed: 1, introTicks: 1, ...cfg });
	hold(s, 2, 0);
	expect(s.phase).toBe(PHASE.LIVE);
	return s;
}
/** Builds grip for player 0 by holding J, then releases. */
function buildGrip(s: MatchSim, ticks = 150): void {
	hold(s, ticks, GRIP, 0);
	hold(s, 1, 0, 0);
}
/** Player 0 launches `dir`, presses J on the beat; player 1 sends `def` (a direction) at `defAt` ticks after launch. */
function exchange(s: MatchSim, dir: number, def = 0, defAt = 10): void {
	s.step(dir, 0);
	expect(s.act).toBe(ACT.TELEGRAPH);
	let t = 0;
	while (s.act !== ACT.IDLE && t < 400) {
		t++;
		let a = 0;
		if (s.act === ACT.WINDOW && s.actT + 1 === TUNE.beat) a = GRIP;
		const b = def && t === defAt ? def : 0;
		s.step(a, b);
	}
}

describe("exchanges and scoring", () => {
	it("scores a clean double-leg with no defence: 2 points, closed guard, attacker on top", () => {
		const s = live();
		buildGrip(s);
		exchange(s, UP);
		expect(s.pos).toBe(POS_INDEX.closedGuard);
		expect(s.top).toBe(0);
		expect(Array.from(s.points)).toEqual([2, 0]);
		expect(s.timeline.length).toBe(2);
	});

	it("refuses a move without enough grip", () => {
		const s = live();
		s.step(LEFT, 0); // outside trip needs 0.5 grip
		expect(s.act).toBe(ACT.IDLE);
	});

	it("an early correct counter stuffs the attack and gives the defender momentum", () => {
		const s = live();
		hold(s, 200, GRIP, GRIP); // both grip up
		hold(s, 1, 0, GRIP);
		exchange(s, UP, DOWN, 5); // sprawl during the telegraph
		expect(s.pos).toBe(POS_INDEX.standing);
		expect(s.points[0]).toBe(0);
		expect(s.momentum[1]).toBeGreaterThan(0);
		expect(s.recover[0]).toBeGreaterThan(0);
	});

	it("a wrong counter overcommits: the attack lands and the defender loses gas", () => {
		const run = (def: number): MatchSim => {
			const s = live();
			hold(s, 200, GRIP, GRIP);
			hold(s, 1, 0, GRIP);
			exchange(s, UP, def, 5);
			return s;
		};
		const wrong = run(RIGHT);
		const none = run(0);
		expect(wrong.pos).toBe(POS_INDEX.closedGuard);
		expect(wrong.gas[1] as number).toBeLessThan((none.gas[1] as number) - 0.05);
	});

	it("a late correct read is weaker than an early one", () => {
		const s = live();
		hold(s, 200, GRIP, GRIP);
		s.step(UP, 0);
		const earlyRead = (() => {
			s.step(0, DOWN);
			return s.strengths().def;
		})();
		const t = live();
		hold(t, 200, GRIP, GRIP);
		t.step(UP, 0);
		while (t.act !== ACT.WINDOW) t.step(0, 0);
		hold(t, 30, 0, 0);
		t.step(0, DOWN);
		expect(t.strengths().def).toBeLessThan(earlyRead);
	});
});

describe("stamina", () => {
	it("gripping drains gas, breathing refills it and drops grips", () => {
		const s = live();
		hold(s, 600, GRIP, 0);
		const g = s.gas[0] as number;
		expect(g).toBeLessThan(0.8);
		expect(s.grip[0]).toBeCloseTo(1, 5);
		hold(s, 120, BREATHE, 0);
		expect(s.gas[0] as number).toBeGreaterThan(g + 0.25);
		expect(s.grip[0] as number).toBeLessThan(0.1);
	});

	it("a gassed attacker telegraphs longer", () => {
		const fresh = live();
		buildGrip(fresh);
		fresh.step(UP, 0);
		const tired = live();
		hold(tired, 200, GRIP, 0);
		tired.gas[0] = 0.1;
		hold(tired, 1, 0, 0);
		tired.step(UP, 0);
		expect(tired.telDur).toBeGreaterThan(fresh.telDur + 10);
	});

	it("posture held while an attack is in progress is defence, not stalling", () => {
		const s = live();
		hold(s, 200, GRIP, POSTURE);
		const before = s.stall[1] as number;
		s.step(UP, POSTURE); // player 0 launches; player 1 keeps posture through the exchange
		while (s.act !== ACT.IDLE) s.step(0, POSTURE);
		expect(s.stall[1]).toBeLessThanOrEqual(before);
	});

	it("posture held too long is stalling: the opponent gets an advantage", () => {
		const s = live();
		hold(s, TUNE.stallTicks + 2, POSTURE, 0);
		expect(s.adv[1]).toBe(1);
	});
});

/** Gets player 0 into a mount armbar: guard → sweep would take long, so place the state directly. */
function intoArmbar(): MatchSim {
	const s = live();
	s.pos = POS_INDEX.mount;
	s.top = 0;
	hold(s, 200, GRIP, 0);
	hold(s, 1, 0, 0);
	exchange(s, UP);
	expect(s.pos).toBe(POS_INDEX.armbar);
	return s;
}

describe("submission tension", () => {
	it("squeezing against no defence ends in a tap", () => {
		const s = intoArmbar();
		let taps = 0;
		for (let i = 0; i < 1200 && s.phase !== PHASE.OVER; i++) {
			s.step(GRIP, 0);
			for (let k = 0; k < s.evN; k++) if (s.evType[k] === EV.TAP) taps++;
		}
		expect(s.phase).toBe(PHASE.OVER);
		expect(s.winner).toBe(0);
		expect(s.method).toBe("Submission");
		expect(taps).toBe(1);
	});

	it("escapes timed on the beat break free and give the attacker an advantage", () => {
		const s = intoArmbar();
		const advBefore = s.adv[0] as number;
		for (let i = 0; i < 1200 && s.pos === POS_INDEX.armbar; i++) {
			const onBeat = s.settle === 0 && (s.subT + 1) % TUNE.subBeatEvery === 0;
			s.step(i % 3 === 0 ? 0 : GRIP, onBeat ? UP : 0);
		}
		expect(s.phase).toBe(PHASE.LIVE);
		expect(s.pos).toBe(POS_INDEX.closedGuard); // mount armbar escape lands in their guard
		expect(s.top).toBe(1);
		expect(s.adv[0]).toBe(advBefore + 1);
	});

	it("panicking (wrong key) tightens the lock", () => {
		const s = intoArmbar();
		hold(s, TUNE.settle + 1, 0, 0);
		const t0 = s.tension;
		s.step(0, LEFT);
		expect(s.tension).toBeGreaterThan(t0);
	});
});

describe("round clock", () => {
	it("ends on time and decides by points, then advantages", () => {
		const s = live({ roundTicks: 600 });
		buildGrip(s);
		exchange(s, UP);
		hold(s, 700, 0, 0);
		expect(s.phase).toBe(PHASE.OVER);
		expect(s.liveTick).toBe(600);
		expect(s.method).toBe("Points");
		expect(s.winner).toBe(0);
		const t = live({ roundTicks: 300 });
		t.adv[1] = 1;
		hold(t, 400, 0, 0);
		expect(t.method).toBe("Advantages");
		expect(t.winner).toBe(1);
		const u = live({ roundTicks: 100 });
		hold(u, 200, 0, 0);
		expect(u.method).toBe("Draw");
	});

	it("counts down from three minutes", () => {
		const s = new MatchSim({ seed: 3 });
		expect(s.clock()).toBe(180);
		hold(s, TUNE.introTicks + 60, 0, 0);
		expect(s.clock()).toBeCloseTo(179, 1);
	});
});

describe("determinism", () => {
	it("replaying the input log reproduces the state hash; one changed input changes it", () => {
		const cfg = { seed: 11 };
		const { sim, log } = playCpuMatch(cfg, ["blue", "black"]);
		const again = replay(cfg, log);
		expect(again.hash()).toBe(sim.hash());
		expect(again.timeline).toEqual(sim.timeline);
		const edited = new InputLog();
		for (let t = 0; t < log.length; t++) {
			const a = t === 400 ? log.get(t, 0) ^ GRIP : log.get(t, 0);
			edited.push(a, log.get(t, 1));
		}
		expect(replay(cfg, edited).hash()).not.toBe(sim.hash());
	});

	it("the same seed and belts play the same match", () => {
		const a = playCpuMatch({ seed: 5 }, ["white", "blue"]);
		const b = playCpuMatch({ seed: 5 }, ["white", "blue"]);
		expect(a.sim.hash()).toBe(b.sim.hash());
		expect(a.log.length).toBe(b.log.length);
	});
});

describe("CPU partners", () => {
	it("CPU vs CPU finishes every match (submission or time) over a range of seeds, for every belt pair", () => {
		let subs = 0;
		let n = 0;
		for (const x of BELTS)
			for (const y of BELTS)
				for (let seed = 1; seed <= 8; seed++) {
					const { sim } = playCpuMatch({ seed }, [x, y]);
					expect(sim.phase, `${x} v ${y} seed ${seed}`).toBe(PHASE.OVER);
					expect(sim.liveTick).toBeLessThanOrEqual(TUNE.roundTicks);
					if (sim.method === "Submission") subs++;
					n++;
				}
		// submissions are a real way to win, not a rarity
		expect(subs / n).toBeGreaterThan(0.25);
	});

	it("a higher belt beats a lower one on most seeds", () => {
		let wins = 0;
		for (let seed = 1; seed <= 20; seed++) {
			const { sim } = playCpuMatch({ seed }, ["white", "black"]);
			if (sim.winner === 1) wins++;
		}
		expect(wins).toBeGreaterThanOrEqual(15);
	});

	it("matches visit most of the graph", () => {
		const seen = new Set<number>();
		for (let seed = 1; seed <= 10; seed++)
			for (const s of playCpuMatch({ seed }, ["blue", "blue"]).sim.timeline)
				if (s.pos >= 0) seen.add(s.pos);
		expect(seen.size).toBeGreaterThanOrEqual(10);
	});
});

describe("restart", () => {
	it("a rematch carries no state from the last roll", () => {
		const alone = playCpuMatch({ seed: 9 }, ["blue", "black"]);
		playCpuMatch({ seed: 8 }, ["white", "blue"]);
		const after = playCpuMatch({ seed: 9 }, ["blue", "black"]);
		expect(after.sim.hash()).toBe(alone.sim.hash());
		const fresh = new MatchSim({ seed: 9 });
		expect(Array.from(fresh.points)).toEqual([0, 0]);
		expect(fresh.timeline.length).toBe(1);
	});
});
