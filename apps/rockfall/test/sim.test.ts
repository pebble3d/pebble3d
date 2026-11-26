import { describe, expect, it } from "vitest";
import { DemoBot } from "../src/game/bot.ts";
import { COUNTDOWN_TICKS, MAX_HP } from "../src/game/constants.ts";
import { EV } from "../src/game/events.ts";
import { BTN, emptyInput, type TickInput } from "../src/game/input.ts";
import { PHASE } from "../src/game/phase.ts";
import {
	defaultConfig,
	PICKUP,
	RockfallSim,
	type SimConfig,
} from "../src/game/sim.ts";
import { nodeFactory } from "./helpers.ts";

async function makeSim(over: Partial<SimConfig> = {}): Promise<RockfallSim> {
	return new RockfallSim(
		await nodeFactory(),
		defaultConfig({ autoStart: true, ...over }),
	);
}

/** A fixed scripted input: wander in a slow figure-eight, hop now and then. */
function scripted(t: number, out: TickInput): TickInput {
	out.mx = Math.sin(t / 47);
	out.mz = Math.cos(t / 71);
	out.buttons = t % 97 === 0 ? BTN.JUMP : 0;
	return out;
}

function run(sim: RockfallSim, ticks: number, t0 = 0): void {
	const inp = emptyInput();
	for (let t = 0; t < ticks; t++) sim.step(scripted(t0 + t, inp));
}

describe("RockfallSim", () => {
	it("is deterministic for a seed and an input log", async () => {
		const a = await makeSim({ seed: 3 });
		const b = await makeSim({ seed: 3 });
		run(a, 1500);
		run(b, 1500);
		expect(a.rockCount).toBeGreaterThan(30);
		expect(a.hash()).toBe(b.hash());
		const c = await makeSim({ seed: 4 });
		run(c, 1500);
		expect(c.hash()).not.toBe(a.hash());
	});

	it("starts every run from a fresh world, independent of the title's length", async () => {
		const a = await makeSim({ seed: 9 });
		run(a, 800);
		const b = await makeSim({ seed: 9, autoStart: false });
		const inp = emptyInput();
		for (let t = 0; t < 137; t++) b.step(inp);
		expect(b.phase).toBe(PHASE.TITLE);
		scripted(0, inp);
		inp.buttons |= BTN.START;
		b.step(inp); // START is read before the world steps: this tick is run tick 0
		run(b, 799, 1);
		expect(b.phase).not.toBe(PHASE.TITLE);
		expect(b.world.stateHash()).toBe(a.world.stateHash());
		expect(b.score).toBe(a.score);
	});

	it("rains rocks only from engine spawners, and every one is tracked by slot", async () => {
		const sim = await makeSim({ seed: 5 });
		let removed = 0;
		const inp = emptyInput();
		for (let t = 0; t < COUNTDOWN_TICKS + 600; t++) {
			sim.step(inp);
			removed += sim.removedN;
			for (let i = 0; i < sim.addedN; i++)
				expect(sim.addedSlot[i]).toBeGreaterThanOrEqual(0);
		}
		expect(sim.totalSpawned).toBeGreaterThan(40);
		expect(sim.rockCount + removed).toBe(sim.totalSpawned);
		const [active, sleeping] = sim.bodyCounts();
		// Every dynamic body in the engine is a tracked rock (the KCC body is kinematic).
		expect(active + sleeping).toBe(sim.rockCount + 1);
	});

	it("hurts a player who stands still under the rain, and ends the run at 0 hp", async () => {
		const sim = await makeSim({ seed: 2, startWave: 6 });
		const inp = emptyInput();
		let hits = 0;
		for (let t = 0; t < 60 * 90 && sim.phase !== PHASE.OVER; t++) {
			sim.step(inp);
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.HIT) hits++;
		}
		expect(hits).toBeGreaterThan(0);
		expect(sim.hp).toBeLessThan(MAX_HP);
		expect(sim.phase).toBe(PHASE.OVER);
		expect(sim.hp).toBe(0);
	});

	it("takes no damage in god mode", async () => {
		const sim = await makeSim({ seed: 2, startWave: 6, god: true });
		run(sim, 60 * 40);
		expect(sim.hp).toBe(MAX_HP);
		expect(sim.phase).not.toBe(PHASE.OVER);
	});

	it("collects a pickup under the player", async () => {
		const sim = await makeSim({ seed: 1 });
		const inp = emptyInput();
		for (let t = 0; t < COUNTDOWN_TICKS + 5; t++) sim.step(inp);
		sim.pkType[0] = PICKUP.CRYSTAL;
		sim.pkX[0] = sim.px;
		sim.pkY[0] = sim.py;
		sim.pkZ[0] = sim.pz;
		sim.pkBorn[0] = sim.tick;
		const before = sim.score;
		sim.step(inp);
		expect(sim.pkType[0]).toBe(-1);
		expect(sim.crystals).toBe(1);
		expect(sim.score).toBeGreaterThanOrEqual(before + 250);
	});

	it("crumbles the oldest rocks past the cap", async () => {
		const sim = await makeSim({ seed: 6, rubble: 300, maxRocks: 120 });
		const inp = emptyInput();
		let crumbles = 0;
		for (let t = 0; t < COUNTDOWN_TICKS + 120; t++) {
			sim.step(inp);
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.CRUMBLE) crumbles++;
		}
		expect(crumbles).toBeGreaterThan(100);
		expect(sim.rockCount).toBeLessThanOrEqual(120 + 6);
	});

	it("lets the demo bot survive waves and score near misses", async () => {
		const sim = await makeSim({ seed: 7 });
		const bot = new DemoBot(sim);
		const inp = emptyInput();
		for (let t = 0; t < 60 * 75; t++) {
			bot.next(inp);
			sim.step(inp);
		}
		expect(sim.wave).toBeGreaterThanOrEqual(3);
		expect(sim.phase).not.toBe(PHASE.OVER);
		expect(sim.score).toBeGreaterThan(1000);
	});
});
