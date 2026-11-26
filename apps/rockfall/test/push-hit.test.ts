import { describe, expect, it } from "vitest";
import { EV } from "../src/game/events.ts";
import { BTN, emptyInput } from "../src/game/input.ts";
import { PHASE } from "../src/game/phase.ts";
import { KIND, type Kind } from "../src/game/rocks.ts";
import { defaultConfig, RockfallSim } from "../src/game/sim.ts";
import { nodeFactory } from "./helpers.ts";

/** Test-only access to the director internals (no rain, a hand-placed rock). */
interface Internals {
	orders: unknown[];
	spawner(
		kind: Kind,
		rate: number,
		count: number,
		min: number[],
		max: number[],
	): void;
}

/**
 * Review I1: sprinting into a resting boulder or slab shoves it faster than the old
 * horizontal "lethal" threshold, which used to count as a hit (7 of 20 trials).
 */
async function sprintInto(
	kind: Kind,
	z: number,
	dist: number,
): Promise<number> {
	const sim = new RockfallSim(
		await nodeFactory(),
		defaultConfig({ seed: 11, autoStart: true }),
	);
	const s = sim as unknown as Internals;
	const inp = emptyInput();
	// Countdown: drop one rock ahead of the player and let it settle.
	s.spawner(kind, 600, 1, [dist, 1.5, z], [dist, 1.5, z]);
	while (sim.phase === PHASE.COUNTDOWN) sim.step(inp);
	s.orders = []; // no rain: only the resting rock and the player
	let hits = 0;
	inp.mx = 1;
	inp.buttons = BTN.SPRINT;
	for (let t = 0; t < 90; t++) {
		sim.step(inp);
		for (let e = 0; e < sim.events.n; e++)
			if (sim.events.type[e] === EV.HIT) hits++;
	}
	return hits;
}

describe("pushing rubble", () => {
	it("never hurts the player who sprints into a resting boulder or slab", async () => {
		let hits = 0;
		for (let i = 0; i < 20; i++) {
			const z = -0.6 + (i % 5) * 0.3;
			const dist = 3 + (i % 4) * 0.7;
			hits += await sprintInto(i % 4 === 3 ? KIND.SLAB : KIND.BOULDER, z, dist);
		}
		expect(hits).toBe(0);
	});
});
