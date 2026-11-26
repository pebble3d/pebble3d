import { describe, expect, it } from "vitest";
import { KIND } from "../src/game/blocks.ts";
import { MirrorSite } from "../src/game/host.ts";
import type { LevelDef } from "../src/game/levels.ts";
import { pickRay } from "../src/game/pick.ts";

const ONE: LevelDef = {
	id: "one",
	name: "One",
	subtitle: "",
	line: 0.5,
	shots: 1,
	par: 0.1,
	launcher: [0, 1, 10],
	botTargets: [],
	botSpeeds: [],
	build: () => [
		{ kind: KIND.BRICK, x: 0, y: 1, z: 0, yaw: Math.PI / 2, stone: 0, tint: 0 },
	],
};

describe("pickRay", () => {
	it("hits a rotated block's face, else the ground, else nothing", () => {
		const m = new MirrorSite(ONE, 1);
		// Yaw 90 degrees: the brick's long axis (0.45 half) now runs along Z.
		const q = Math.SQRT1_2;
		const buf = new Float32Array((1 + 4) * 8);
		buf.set([0, 1, 0, 0, q, 0, q, 1]);
		m.apply(buf, 0, true);
		expect(pickRay(m, 0, 1, 10, 0, 0, -1, 100)).toBeCloseTo(10 - 0.45, 4);
		expect(pickRay(m, 3, 1, 10, 0, 0, -1, 100)).toBe(-1);
		const d = Math.SQRT1_2;
		expect(pickRay(m, 5, 2, 10, 0, -d, -d, 100)).toBeCloseTo(2 / d, 4);
	});
});
