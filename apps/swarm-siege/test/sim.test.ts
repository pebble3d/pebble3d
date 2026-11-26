import { describe, expect, it } from "vitest";
import {
	CELLS,
	CORE_HP,
	MAX_AGENTS,
	START_GOLD,
} from "../src/game/constants.ts";
import { KIND, TOWER, TOWERS } from "../src/game/defs.ts";
import { EV } from "../src/game/events.ts";
import { CMD, emptyInput, type TickInput } from "../src/game/input.ts";
import {
	buildMask,
	buildPaths,
	cellCenter,
	pathDistance,
} from "../src/game/path.ts";
import { emptyPick, PHASE, PICK, type SiegeSim } from "../src/game/sim.ts";
import {
	A_STRIDE,
	H,
	newSnapshot,
	OFF_AGENTS,
	packSnapshot,
} from "../src/game/snapshot.ts";
import { waveTotal } from "../src/game/waves.ts";
import { makeSim, runBot } from "./helpers.ts";

function step(sim: SiegeSim, cmd = 0, a = 0, b = 0): void {
	const i: TickInput = { cmd, a, b };
	sim.step(i);
}

function events(sim: SiegeSim, type: number): number {
	let n = 0;
	for (let e = 0; e < sim.events.n; e++) if (sim.events.type[e] === type) n++;
	return n;
}

/** A buildable cell near the trunk (the bot's favourite kind of spot). */
function goodCell(sim: SiegeSim): number {
	for (let c = 0; c < sim.mask.length; c++) {
		if (sim.mask[c] !== 1) continue;
		const [x, z] = cellCenter(c);
		if (pathDistance(sim.paths, x, z) < 6) return c;
	}
	throw new Error("no cell");
}

describe("map", () => {
	it("paths reach the core and build cells keep off the lanes", () => {
		const paths = buildPaths();
		for (const p of paths) {
			expect(p.length).toBeGreaterThan(100);
			expect(
				Math.hypot((p.x[p.n - 1] as number) - 0, (p.z[p.n - 1] as number) - 31),
			).toBeLessThan(0.6);
		}
		const mask = buildMask(paths);
		let n = 0;
		for (let c = 0; c < CELLS * CELLS; c++) {
			if (mask[c] !== 1) continue;
			n++;
			const [x, z] = cellCenter(c);
			expect(pathDistance(paths, x, z)).toBeGreaterThanOrEqual(4.2);
		}
		expect(n).toBeGreaterThan(400);
	});

	it("waves grow into the thousands", () => {
		expect(waveTotal(1)).toBeLessThan(waveTotal(6));
		expect(waveTotal(12)).toBeGreaterThan(6000);
	});
});

describe("placement, picking and economy", () => {
	it("places a tower on a pad, and a camera ray then picks that tower", async () => {
		const sim = await makeSim({ autoStart: true });
		step(sim);
		const c = goodCell(sim);
		const [x, z] = cellCenter(c);
		const pick = emptyPick();
		sim.pick(x, 60, z + 40, 0, -60, -40, pick);
		expect(pick.kind).toBe(PICK.CELL);
		expect(pick.cell).toBe(c);
		expect(pick.buildable).toBe(true);
		step(sim, CMD.PLACE, TOWER.SPARK, c);
		expect(sim.gold).toBe(START_GOLD - (TOWERS[TOWER.SPARK]?.cost ?? 0));
		expect(sim.nTowers).toBe(1);
		expect(events(sim, EV.PLACE)).toBe(1);
		step(sim); // broad phase sees the new collider after a step
		sim.pick(x, 60, z + 40, 0, -60, -40, pick);
		expect(pick.kind).toBe(PICK.TOWER);
		expect(pick.tower).toBe(0);
		// The same cell again is denied.
		sim.events.clear();
		step(sim, CMD.PLACE, TOWER.SPARK, c);
		expect(events(sim, EV.DENY)).toBe(1);
		expect(sim.nTowers).toBe(1);
	});

	it("denies lanes and empty purses; upgrades and sells", async () => {
		const sim = await makeSim({ autoStart: true });
		step(sim);
		let lane = -1;
		for (let c = 0; c < sim.mask.length; c++)
			if (sim.mask[c] === 0) {
				const [x, z] = cellCenter(c);
				if (pathDistance(sim.paths, x, z) < 1) lane = c;
			}
		step(sim, CMD.PLACE, TOWER.MORTAR, lane);
		expect(events(sim, EV.DENY)).toBe(1);
		const c = goodCell(sim);
		step(sim, CMD.PLACE, TOWER.MORTAR, c);
		expect(sim.nTowers).toBe(1);
		const gold = sim.gold;
		step(sim, CMD.UPGRADE, 0);
		expect(sim.tlevel[0]).toBe(2);
		expect(sim.gold).toBe(gold - (TOWERS[TOWER.MORTAR]?.upgrade[0] ?? 0));
		// Lance costs 150; what is left is not enough.
		sim.events.clear();
		step(sim, CMD.PLACE, TOWER.LANCE, goodCell(sim) + 1);
		expect(events(sim, EV.DENY)).toBe(1);
		const before = sim.gold;
		step(sim, CMD.SELL, 0);
		expect(sim.nTowers).toBe(0);
		expect(sim.gold).toBe(before + Math.floor((100 + 80) * 0.7));
	});
});

describe("waves", () => {
	it("an undefended core takes leaks, falls, and a restart resets the run", async () => {
		const sim = await makeSim({ autoStart: true, startWave: 6 });
		let lost = -1;
		for (let t = 0; t < 60 * 120 && lost < 0; t++) {
			step(sim, t === 2 ? CMD.CALL_WAVE : 0);
			if (sim.phase === PHASE.LOST) lost = sim.tick;
			sim.events.clear();
		}
		expect(lost).toBeGreaterThan(0);
		expect(sim.coreHp).toBe(0);
		expect(sim.leaks).toBeGreaterThan(0);
		// The core shatters into engine-spawned debris.
		for (let t = 0; t < 4; t++) step(sim);
		expect(sim.nDebris).toBeGreaterThan(20);
		step(sim, CMD.RESTART);
		expect(sim.phase).toBe(PHASE.BUILD);
		expect(sim.coreHp).toBe(CORE_HP);
		expect(sim.alive).toBe(0);
	});

	it("towers kill: a Spark next to the lane earns gold during wave 1", async () => {
		const sim = await makeSim({ autoStart: true });
		step(sim);
		step(sim, CMD.PLACE, TOWER.SPARK, goodCell(sim));
		step(sim, CMD.CALL_WAVE);
		for (let t = 0; t < 60 * 50; t++) {
			step(sim);
			sim.events.clear();
		}
		expect(sim.kills).toBeGreaterThan(10);
		expect(sim.tkills[0]).toBe(sim.kills);
	});

	it("brutes shatter into debris from a Rust spawner", async () => {
		const sim = await makeSim({
			autoStart: true,
			startWave: 5,
			bonusGold: 5000,
		});
		step(sim);
		let placed = 0;
		for (let c = 0; c < sim.mask.length && placed < 16; c++) {
			if (sim.mask[c] !== 1) continue;
			const [x, z] = cellCenter(c);
			if (pathDistance(sim.paths, x, z) > 7) continue;
			step(sim, CMD.PLACE, placed % 2 ? TOWER.LANCE : TOWER.MORTAR, c);
			placed++;
		}
		step(sim, CMD.CALL_WAVE);
		let debris = 0;
		let bruteKills = 0;
		for (let t = 0; t < 60 * 80; t++) {
			step(sim);
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.KILL && sim.events.a[e] === KIND.BRUTE)
					bruteKills++;
			debris = Math.max(debris, sim.nDebris);
			sim.events.clear();
		}
		expect(bruteKills).toBeGreaterThan(0);
		expect(debris).toBeGreaterThan(5);
	});
});

describe("determinism", () => {
	it("the same seed and bot give the same hash; another seed differs", async () => {
		const run = async (seed: number): Promise<string> => {
			const sim = await makeSim({ seed });
			runBot(sim, 4000);
			return sim.hash();
		};
		const a = await run(7);
		expect(await run(7)).toBe(a);
		expect(await run(8)).not.toBe(a);
	});

	it("the demo bot plays several waves and keeps the beacon", async () => {
		const sim = await makeSim({ seed: 7 });
		runBot(sim, 60 * 60 * 5);
		expect(sim.wave).toBeGreaterThanOrEqual(4);
		expect(sim.nTowers).toBeGreaterThanOrEqual(8);
		expect(sim.coreHp).toBeGreaterThan(0);
		expect(sim.kills).toBeGreaterThan(500);
	});
});

describe("stress mode and snapshots", () => {
	it("the endless stream grows and loops, and packs into a snapshot", async () => {
		const sim = await makeSim({ stress: true, stressRate: 600 });
		const input = emptyInput();
		for (let t = 0; t < 60 * 30; t++) {
			sim.step(input);
			sim.events.clear();
		}
		// 30 s at 600/s: the stream only grows (nobody dies or leaks).
		expect(sim.alive).toBeGreaterThan(17500);
		expect(sim.alive).toBeLessThanOrEqual(Math.min(MAX_AGENTS, 18000));
		expect(sim.coreHp).toBe(CORE_HP);
		const snap = newSnapshot();
		packSnapshot(sim, snap, true);
		expect(snap[H.ALIVE]).toBe(sim.alive);
		let live = 0;
		for (let i = 0; i < (snap[H.HW] as number); i++)
			if ((snap[OFF_AGENTS + i * A_STRIDE + 3] as number) !== 0) live++;
		expect(live).toBe(sim.alive);
	});
});
