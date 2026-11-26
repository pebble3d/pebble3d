import { readFileSync } from "node:fs";
import { expandScene } from "@pebble3d/sdk/expand";
import { parseScene } from "@pebble3d/sdk/schema";
import { loadSim, StateViews } from "@pebble3d/sdk/sim";
import { DemoBot } from "../src/game/bot.ts";
import {
	emptyInput,
	LanternSim,
	PHASE,
	type TickInput,
} from "../src/game/sim.ts";
import { generateKeep } from "../src/gen/generate.ts";

const wasm = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);

/** A keep spawned the way createGame does it, plus the sim, driven in the browser's tick order. */
export async function headless(seed: number) {
	const keep = generateKeep(seed);
	const scene = parseScene(keep.scene);
	const handle = await loadSim("deterministic", wasm, {
		seed: scene.sim.seed,
		gravity: scene.sim.gravity,
	});
	const ids = handle.spawnScene(expandScene(scene).sim);
	const views = new StateViews(handle);
	const sim = new LanternSim({ sim: handle, views, ids }, keep);
	const input: TickInput = emptyInput();
	const step = (fill?: (i: TickInput) => void): void => {
		handle.world.step(1);
		views.refresh();
		fill?.(input);
		sim.step(input);
	};
	return {
		keep,
		handle,
		views,
		sim,
		input,
		step,
		free: () => handle.world.free(),
	};
}

/** Run the demo bot until the run ends (or `max` ticks). Returns the engine tick of the end. */
export async function demoRun(seed: number, max = 60 * 240) {
	const h = await headless(seed);
	const bot = new DemoBot(h.sim);
	let end = -1;
	for (let t = 0; t < max; t++) {
		h.step((i) => bot.next(i));
		if (h.sim.phase === PHASE.CAUGHT || h.sim.phase === PHASE.ESCAPED) {
			end = h.handle.world.tick();
			break;
		}
	}
	return { ...h, bot, end };
}
