import { Bot } from "../src/game/bot.ts";
import { emptyFrame, InputLog } from "../src/game/input.ts";
import { activeSlots, type RoundRecord, recordOf } from "../src/game/match.ts";
import type { PhysicsHost } from "../src/game/physics.ts";
import { PHASE, RoundSim } from "../src/game/sim.ts";

/** Plays one all-bot round in the live tick order (log, then step) and records it. */
export function playBotRound(
	host: PhysicsHost,
	seed: number,
	slots = activeSlots(["bot", "bot", "bot", "bot"]),
	maxTicks = 6000,
	onTick?: (sim: RoundSim) => void,
): { rec: RoundRecord; sim: RoundSim } {
	const sim = new RoundSim(host, seed, slots);
	const bots = [0, 1, 2, 3].map((s) => new Bot(s, seed));
	const f = emptyFrame();
	const log = new InputLog();
	while (sim.phase !== PHASE.OVER && sim.tick < maxTicks) {
		for (let s = 0; s < 4; s++) bots[s]?.next(sim, f[s] as never);
		log.push(f);
		sim.step(f);
		onTick?.(sim);
	}
	return { rec: recordOf(0, sim, log), sim };
}
