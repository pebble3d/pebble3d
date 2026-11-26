import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { hostFromHandle, type PhysicsHost } from "../src/game/physics.ts";

let host: PhysicsHost | null = null;

/** One deterministic wasm module per test file; every MarbleSim gets its own World in it. */
export async function physicsHost(): Promise<PhysicsHost> {
	if (host) return host;
	const wasm = readFileSync(
		new URL(
			"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
			import.meta.url,
		),
	);
	host = hostFromHandle(await loadSim("deterministic", wasm));
	return host;
}
