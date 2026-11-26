import { readFileSync } from "node:fs";
import { loadSim, StateViews } from "@pebble3d/sdk/sim";
import { DemoBot } from "../src/game/bot.ts";
import { emptyInput, type TickInput } from "../src/game/input.ts";
import { defaultConfig, SiegeSim, type SimConfig } from "../src/game/sim.ts";

const DET = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);

export async function makeSim(o: Partial<SimConfig> = {}): Promise<SiegeSim> {
	const h = await loadSim("deterministic", DET, { seed: 1 });
	return new SiegeSim(h, new StateViews(h), defaultConfig(o));
}

/** Runs the demo bot for `ticks` (or until `until` holds); returns the tick it stopped at. */
export function runBot(
	sim: SiegeSim,
	ticks: number,
	until?: (s: SiegeSim) => boolean,
	input: TickInput = emptyInput(),
): number {
	const bot = new DemoBot(sim);
	for (let t = 0; t < ticks; t++) {
		bot.nextInput(input);
		sim.step(input);
		sim.events.clear();
		if (until?.(sim)) return sim.tick;
	}
	return sim.tick;
}
