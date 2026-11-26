import { readFileSync } from "node:fs";
import { loadSim, type SimBuild } from "@pebble3d/sdk/sim";
import { worldFactory } from "../src/game/factory.ts";
import type { WorldFactory } from "../src/game/sim.ts";

const cache = new Map<SimBuild, WorldFactory>();

/** A world factory over the real wasm build (loaded once per build per process). */
export async function nodeFactory(
	build: SimBuild = "deterministic",
): Promise<WorldFactory> {
	const hit = cache.get(build);
	if (hit) return hit;
	const dir =
		build === "deterministic" ? "det/engine_core_det" : "fast/engine_core_fast";
	const bytes = readFileSync(
		new URL(`../../../packages/sdk/wasm/${dir}_bg.wasm`, import.meta.url),
	);
	const f = worldFactory(await loadSim(build, bytes, { seed: 1 }));
	cache.set(build, f);
	return f;
}
