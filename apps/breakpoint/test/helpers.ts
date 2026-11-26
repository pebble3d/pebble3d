import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import type { WorldSource } from "../src/game/site.ts";

const wasm = (kind: "det" | "fast"): Uint8Array<ArrayBuffer> =>
	new Uint8Array(
		readFileSync(
			new URL(
				`../../../packages/sdk/wasm/${kind}/engine_core_${kind}_bg.wasm`,
				import.meta.url,
			),
		),
	);

/**
 * A WorldSource over one wasm build (Node). The game ships the `fast` (SIMD) build; replays
 * rely on same-binary determinism, which the tests check on both builds.
 */
export async function worldSource(
	kind: "det" | "fast" = "det",
): Promise<WorldSource> {
	const h = await loadSim(
		kind === "fast" ? "fast" : "deterministic",
		wasm(kind),
	);
	const Ctor = h.world.constructor as new (
		seed: number,
		g: number,
	) => typeof h.world;
	h.world.free();
	return { make: () => new Ctor(1, -9.81), memory: h.memory };
}
