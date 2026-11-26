import { describe, expect, it } from "vitest";
import { DEMO_BOT, DroneBot } from "../src/game/bot.ts";
import { emptyInput } from "../src/game/input.ts";
import { DroneSim, PHASE } from "../src/game/sim.ts";
import { SITE, trackById } from "../src/game/tracks.ts";
import { nodeHost } from "./helpers.ts";

/**
 * bench/capture-final.sh picks its --ticks from these events of the `?demo=1` race. The app runs
 * one sim tick per frame in fixed mode, starting at frame 1, so the sim tick equals the shot's
 * engine tick. If a tuning change moves them, this fails and the script needs new ticks.
 * The finish hash is the same one `pnpm shot` records in the sidecar's `game.probe.hash`
 * (Chromium), so this also pins Node == browser determinism.
 */
describe("demo race capture ticks", () => {
	it.each([
		["hall-circuit", 2144, "f5736521634bb635:9a2c9c7e"],
		["needle-and-eaves", 2103, "7020bd0960003867:e0e6c412"],
	])("%s finishes at tick %i", async (id, finishTick, hash) => {
		const host = await nodeHost();
		const sim = new DroneSim(host, trackById(id), SITE, "assisted");
		const bot = new DroneBot(sim, DEMO_BOT);
		const inp = emptyInput();
		while (sim.phase !== PHASE.FINISHED) sim.step(bot.next(inp));
		expect(sim.tick).toBe(finishTick);
		expect(sim.hash()).toBe(hash);
		sim.free();
	});
});
