import { beforeAll, describe, expect, it } from "vitest";
import { canonical } from "../src/puzzle/compose.ts";
import { type Level, starsFor } from "../src/puzzle/level.ts";
import { LEVELS } from "../src/puzzle/levels.ts";
import { loadNodeEngine } from "../src/puzzle/node-engine.ts";
import {
	ballMass,
	type Engine,
	PuzzleSim,
	type SimEventKind,
} from "../src/puzzle/sim.ts";

let engine: Engine;
beforeAll(async () => {
	engine = await loadNodeEngine();
});

function events(level: Level): Set<SimEventKind> {
	const sim = new PuzzleSim(engine, level, level.solution);
	const seen = new Set<SimEventKind>();
	while (sim.status === "running") {
		sim.step();
		sim.drain((e) => seen.add(e.kind));
	}
	sim.dispose();
	return seen;
}

describe("PuzzleSim", () => {
	it("fires part behaviours as events (springs, fans, dominoes, goal)", () => {
		expect(events(LEVELS[1] as Level).has("spring")).toBe(true);
		expect(events(LEVELS[2] as Level).has("fan")).toBe(true);
		const k = events(LEVELS[3] as Level);
		expect(k.has("domino")).toBe(true);
		expect(k.has("goal") && k.has("solved")).toBe(true);
	});

	it("fails a run whose machine comes to rest", () => {
		const sim = new PuzzleSim(engine, LEVELS[0] as Level, []);
		const r = sim.run();
		sim.dispose();
		expect(r.status).toBe("failed");
		expect(r.reason).toBe("stopped");
	});

	it("stops stepping once the run has ended", () => {
		const sim = new PuzzleSim(
			engine,
			LEVELS[0] as Level,
			(LEVELS[0] as Level).solution,
		);
		const r = sim.run();
		sim.step();
		expect(sim.tick).toBe(r.tick);
		expect(sim.result().hash).toBe(r.hash);
		sim.dispose();
	});

	it("starts every run from a fresh world (same hash at tick 0)", () => {
		const level = LEVELS[5] as Level;
		const a = new PuzzleSim(engine, level, level.solution);
		a.run();
		const b = new PuzzleSim(engine, level, level.solution);
		const c = new PuzzleSim(engine, level, level.solution);
		expect(b.world.stateHash()).toBe(c.world.stateHash());
		for (const s of [a, b, c]) s.dispose();
	});
});

describe("scoring", () => {
	it("rates by parts used against par", () => {
		expect(starsFor(1, 2)).toBe(3);
		expect(starsFor(2, 2)).toBe(3);
		expect(starsFor(3, 2)).toBe(2);
		expect(starsFor(4, 2)).toBe(1);
	});
	it("orders placements canonically (row, then column)", () => {
		const out = canonical([
			{ part: "ramp", cell: [3, 2], dir: "right" },
			{ part: "fan", cell: [1, 2], dir: "up" },
			{ part: "spring", cell: [5, 0], dir: "up" },
		]);
		expect(out.map((p) => p.cell)).toEqual([
			[5, 0],
			[1, 2],
			[3, 2],
		]);
	});
});

describe("part behaviour is mass- and gravity-aware", () => {
	/** Ball velocity just after the first spring fires, for a level variant. */
	function afterSpring(level: Level): [number, number] {
		const sim = new PuzzleSim(engine, level, level.solution);
		let fired = false;
		while (sim.status === "running" && !fired) {
			sim.step();
			sim.drain((e) => {
				if (e.kind === "spring") fired = true;
			});
		}
		sim.world.linearVelocity(sim.ballId);
		const v: [number, number] = [
			sim.views.scratch[12] as number,
			sim.views.scratch[13] as number,
		];
		sim.dispose();
		return v;
	}

	it("launches a heavier ball at the same speed", () => {
		const base = LEVELS[1] as Level;
		const heavy: Level = {
			...base,
			scene: { prefabs: { ball: { body: { mass: 3 } } } },
		};
		const a = afterSpring(base);
		const b = afterSpring(heavy);
		expect(b[0]).toBeCloseTo(a[0], 3);
		expect(b[1]).toBeCloseTo(a[1], 3);
	});

	it("reads the ball mass from the scene", () => {
		const sim = new PuzzleSim(engine, LEVELS[0] as Level, []);
		expect(ballMass(sim.composed.scene)).toBe(1);
		sim.dispose();
	});
});
