import { it } from "vitest";
import { COUNTDOWN_TICKS } from "../src/game/constants.ts";
import { physicsHost } from "./helpers.ts";
import { playBotRound } from "./play.ts";

it.skipIf(!process.env.EXPLORE)("explore", async () => {
	const host = await physicsHost();
	const firsts: number[] = [];
	const lens: number[] = [];
	const wins = [0, 0, 0, 0, 0];
	for (let seed = 1; seed <= 24; seed++) {
		const { rec, sim } = playBotRound(host, seed * 7919);
		firsts.push(((rec.outTicks[0] ?? rec.ticks) - COUNTDOWN_TICKS) / 60);
		lens.push(sim.clock());
		wins[rec.winner + 1] = (wins[rec.winner + 1] ?? 0) + 1;
		sim.free();
	}
	const med = (a: number[]) =>
		a
			.slice()
			.sort((x, y) => x - y)
			[a.length >> 1]?.toFixed(1);
	console.log(
		"first-out median",
		med(firsts),
		"min",
		Math.min(...firsts).toFixed(1),
		"len median",
		med(lens),
		"min",
		Math.min(...lens).toFixed(1),
		"max",
		Math.max(...lens).toFixed(1),
		"wins(draw,0..3)",
		wins,
	);
});
