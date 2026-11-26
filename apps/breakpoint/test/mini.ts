import { KIND } from "../src/game/blocks.ts";
import type { LevelDef } from "../src/game/levels.ts";

/** A small, fast test level: two short brick piles. */
export const MINI: LevelDef = {
	id: "mini",
	name: "Mini",
	subtitle: "",
	line: 0.5,
	shots: 2,
	par: 0.2,
	launcher: [0, 1.5, 14],
	botTargets: [
		[0, 0.9, 0],
		[3, 0.9, 0],
	],
	botSpeeds: [30, 30],
	build(seed) {
		const out = [];
		for (const x of [0, 3])
			for (let c = 0; c < 5; c++)
				for (let i = 0; i < 3; i++)
					out.push({
						kind: KIND.BRICK,
						x: x + (i - 1) * 0.92,
						y: 0.225 + c * 0.45,
						z: 0,
						yaw: 0,
						stone: 0 as const,
						tint: ((seed * 31 + i) % 7) / 7,
					});
		return out;
	},
};
