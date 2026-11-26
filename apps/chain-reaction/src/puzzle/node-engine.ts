import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { type Engine, engineFrom } from "./sim.ts";

/** The deterministic engine build loaded from bytes (Node: the CLI and tests). */
export async function loadNodeEngine(): Promise<Engine> {
	const bytes = readFileSync(
		new URL(
			"../../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
			import.meta.url,
		),
	);
	return engineFrom(await loadSim("deterministic", bytes, { seed: 1 }));
}
