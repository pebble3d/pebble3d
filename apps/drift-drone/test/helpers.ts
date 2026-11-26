import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { hostFromHandle, type PhysicsHost } from "../src/game/physics.ts";

const wasm = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);

/** A physics host on the real deterministic wasm, as the browser gets from createGame. */
export async function nodeHost(): Promise<PhysicsHost> {
	const h = await loadSim("deterministic", wasm, { seed: 1, gravity: -9.81 });
	return hostFromHandle(h);
}
