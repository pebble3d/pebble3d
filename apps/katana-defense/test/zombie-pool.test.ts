import { describe, expect, it } from "vitest";
import wavesJson from "../src/data/waves.json";
import zombiesJson from "../src/data/zombies.json";
import { MAX_ZOMBIES } from "../src/game/constants.ts";
import { warmCounts } from "../src/game/view/zombie-pool.ts";
import type { WaveFile } from "../src/game/waves/director.ts";

const waves = wavesJson as unknown as WaveFile;

describe("warmCounts", () => {
	it("covers each avatar's share of the busiest wave, capped", () => {
		const one: WaveFile = {
			...waves,
			waves: [
				{ maxAlive: 40, interval: 30, groups: [{ type: "a", count: 10 }] },
			],
		};
		// a single-avatar archetype needs every live zombie and corpse
		expect(warmCounts(one, { a: [0] }, 2, 16)).toEqual([40 + 16 + 1, 0]);
		// never more than every zombie plus every corpse
		const huge: WaveFile = {
			...waves,
			waves: [
				{ maxAlive: 999, interval: 30, groups: [{ type: "a", count: 10 }] },
			],
		};
		expect(warmCounts(huge, { a: [0] }, 1, 16)).toEqual([MAX_ZOMBIES + 16]);
		// split over two avatars: half each plus headroom
		const n = warmCounts(one, { a: [0, 1] }, 2, 16);
		expect(n[0]).toBe(n[1]);
		expect(n[0]).toBeGreaterThanOrEqual(28);
		expect(n[0]).toBeLessThan(MAX_ZOMBIES + 16);
	});

	it("warms every avatar the shipped waves use for at least its peak share", () => {
		const n = warmCounts(
			waves,
			zombiesJson.archetypes,
			zombiesJson.avatars.length,
			16,
		);
		const peak = Math.max(...waves.waves.map((w) => w.maxAlive)) + 16;
		for (const c of n)
			expect(c).toBeGreaterThan(peak / zombiesJson.avatars.length);
	});
});
