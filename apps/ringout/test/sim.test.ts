import { describe, expect, it } from "vitest";
import {
	arenaRadius,
	buildArena,
	hexRing,
	ringDropTick,
} from "../src/game/arena.ts";
import { Bot } from "../src/game/bot.ts";
import {
	COUNTDOWN_TICKS,
	MAX_FIGHT_TICKS,
	RINGS,
} from "../src/game/constants.ts";
import { EV } from "../src/game/events.ts";
import { BTN, emptyFrame, InputLog } from "../src/game/input.ts";
import {
	activeSlots,
	Match,
	resimulate,
	roundSeed,
} from "../src/game/match.ts";
import { DRAW, PHASE, RoundSim } from "../src/game/sim.ts";
import { physicsHost } from "./helpers.ts";
import { playBotRound } from "./play.ts";

describe("arena", () => {
	it("lays out 61 hexes in 5 rings, rim first to drop", () => {
		const tiles = buildArena(7);
		expect(tiles.length).toBe(61);
		expect(tiles.filter((t) => t.ring === 0).length).toBe(1);
		expect(tiles.filter((t) => t.ring === RINGS - 1).length).toBe(24);
		expect(ringDropTick(RINGS - 1)).toBeLessThan(ringDropTick(0));
		for (const t of tiles) expect(t.warnTick).toBeLessThan(t.dropTick);
		expect(hexRing(2, -1)).toBe(2);
		expect(arenaRadius(RINGS)).toBeGreaterThan(7);
	});
	it("is a pure function of the seed", () => {
		expect(buildArena(3)).toEqual(buildArena(3));
		expect(buildArena(3)).not.toEqual(buildArena(4));
	});
});

describe("round sim", () => {
	it("counts down, fights, and the arena collapses ring by ring with no one driving", async () => {
		const host = await physicsHost();
		const sim = new RoundSim(host, 5, activeSlots(["p1", "p2", "off", "off"]));
		const f = emptyFrame();
		let go = -1;
		let drops = 0;
		while (sim.phase !== PHASE.OVER && sim.tick < 5000) {
			sim.step(f);
			for (let k = 0; k < sim.events.length; k++) {
				if (sim.events.type[k] === EV.GO) go = sim.tick;
				if (sim.events.type[k] === EV.DROP) drops++;
			}
		}
		expect(go).toBe(COUNTDOWN_TICKS);
		expect(sim.phase).toBe(PHASE.OVER);
		// idle orbs ride their ring down together: a draw
		expect(drops).toBeGreaterThanOrEqual(1);
		expect([0, 1, DRAW]).toContain(sim.winner);
		expect(sim.fightTick).toBeLessThanOrEqual(MAX_FIGHT_TICKS);
		expect(Array.from(sim.tileState).some((s) => s !== 0)).toBe(true);
		expect(sim.tileState[0]).toBe(0); // the centre still stands
		sim.free();
	});

	it("drives orbs with torque and impulse; a dash is a burst with a cooldown", async () => {
		const host = await physicsHost();
		const sim = new RoundSim(host, 1, activeSlots(["p1", "p2", "off", "off"]));
		const f = emptyFrame();
		while (sim.phase === PHASE.COUNTDOWN) sim.step(f);
		const p = f[0] as { x: number; z: number; buttons: number };
		p.x = 127;
		for (let t = 0; t < 30; t++) sim.step(f);
		expect(sim.vel[0]).toBeGreaterThan(2);
		// rolling: spin about -z for travel along +x
		expect(sim.ang[2]).toBeLessThan(-2);
		const before = sim.vel[0] as number;
		p.buttons = BTN.DASH;
		sim.step(f);
		expect((sim.vel[0] as number) - before).toBeGreaterThan(4);
		expect(sim.dashes[0]).toBe(1);
		for (let t = 0; t < 10; t++) sim.step(f);
		expect(sim.dashes[0]).toBe(1);
		sim.free();
	});

	it("bots knock each other out and decide a winner", async () => {
		const host = await physicsHost();
		let decided = 0;
		for (let seed = 1; seed <= 4; seed++) {
			const { rec, sim } = playBotRound(host, seed);
			expect(sim.phase).toBe(PHASE.OVER);
			if (rec.winner >= 0) decided++;
			expect(rec.outTicks.length).toBeGreaterThanOrEqual(3);
			sim.free();
		}
		expect(decided).toBeGreaterThanOrEqual(3);
	});
});

describe("round feel", () => {
	it("beeps 3, 2, 1 during the countdown", async () => {
		const host = await physicsHost();
		const sim = new RoundSim(host, 2, activeSlots(["p1", "p2", "off", "off"]));
		const f = emptyFrame();
		const counts: number[] = [];
		while (sim.phase === PHASE.COUNTDOWN) {
			sim.step(f);
			for (let k = 0; k < sim.events.length; k++)
				if (sim.events.type[k] === EV.COUNT)
					counts.push(sim.events.a[k] as number);
		}
		expect(counts).toEqual([3, 2, 1]);
		sim.free();
	});

	it("the round winner keeps control during the post-decision linger", async () => {
		const host = await physicsHost();
		const run = (push: boolean): number => {
			const sim = new RoundSim(
				host,
				31,
				activeSlots(["bot", "bot", "bot", "bot"]),
			);
			const bots = [0, 1, 2, 3].map((s) => new Bot(s, 31));
			const f = emptyFrame();
			while (sim.phase !== PHASE.OVER) {
				for (let s = 0; s < 4; s++) bots[s]?.next(sim, f[s] as never);
				if (sim.winner >= 0) {
					const p = f[sim.winner] as { x: number; z: number; buttons: number };
					p.x = push ? 127 : 0;
					p.z = 0;
					p.buttons = 0;
				}
				sim.step(f);
			}
			const w = sim.winner;
			const x =
				w >= 0 && sim.alive[w] ? (sim.pos[w * 3] as number) : Number.NaN;
			sim.free();
			return x;
		};
		const still = run(false);
		const pushed = run(true);
		expect(Number.isNaN(still)).toBe(false);
		// pushing moves the winner (here it rolls off the edge: alive = no longer)
		expect(Object.is(pushed, still)).toBe(false);
	});
});

describe("replay", () => {
	it("re-simulating a round from its input log reproduces the live hash exactly", async () => {
		const host = await physicsHost();
		for (const seed of [11, 12]) {
			const { rec, sim } = playBotRound(host, seed);
			expect(rec.log.length).toBe(rec.ticks);
			expect(resimulate(host, rec)).toBe(rec.hash);
			sim.free();
		}
	});

	it("one changed input changes the hash", async () => {
		const host = await physicsHost();
		const { rec, sim } = playBotRound(host, 21);
		sim.free();
		const f = emptyFrame();
		const log = new InputLog();
		for (let t = 0; t < rec.log.length; t++) {
			rec.log.read(t, f);
			if (t === COUNTDOWN_TICKS + 30) {
				const p = f[1] as { x: number; z: number };
				// steer against the current travel (the drive ignores pushes past top speed)
				p.x = -p.x;
				p.z = -p.z;
			}
			log.push(f);
		}
		expect(resimulate(host, { ...rec, log })).not.toBe(rec.hash);
	});
});

describe("match", () => {
	it("best of 3 ends when a slot reaches 2 wins; seeds derive from the match seed", async () => {
		const host = await physicsHost();
		const m = new Match({
			slots: ["bot", "bot", "bot", "bot"],
			toWin: 2,
			seed: 9,
		});
		expect(roundSeed(9, 0)).toBe(roundSeed(9, 0));
		expect(roundSeed(9, 0)).not.toBe(roundSeed(9, 1));
		while (m.champion() < 0 && m.round < 9) {
			const { rec, sim } = playBotRound(host, m.nextSeed());
			m.add({ ...rec, index: m.round });
			sim.free();
		}
		expect(m.champion()).toBeGreaterThanOrEqual(0);
		expect(m.wins[m.champion()]).toBe(2);
	});
});
