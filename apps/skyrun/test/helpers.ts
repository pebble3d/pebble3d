import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { type Course, parseCourse } from "../src/game/course.ts";
import { simHost } from "../src/game/physics.ts";
import { SkyrunSim } from "../src/game/sim.ts";

const wasm = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);

export async function nodeHost(): Promise<ReturnType<typeof simHost>> {
	const h = await loadSim("deterministic", wasm, { seed: 1 });
	const host = simHost(h);
	h.world.free();
	return host;
}

export function loadCourse(id: string): Course {
	return parseCourse(
		JSON.parse(
			readFileSync(new URL(`../courses/${id}.json`, import.meta.url), "utf8"),
		),
	);
}

export { SkyrunSim };
