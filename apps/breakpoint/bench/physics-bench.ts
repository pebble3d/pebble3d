// Headless physics bench: builds every level in the deterministic Rapier build, settles it,
// fires the demo bot's first shot and reports ms per tick. Usage: pnpm --filter breakpoint bench:physics
import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { aimVelocity } from "../src/game/aim.ts";
import { LEVELS } from "../src/game/levels.ts";
import { Site } from "../src/game/site.ts";

const bytes = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);
const h = await loadSim("deterministic", bytes);
const Ctor = h.world.constructor as new (
	seed: number,
	g: number,
) => typeof h.world;
const src = { make: () => new Ctor(1, -9.81), memory: h.memory };
for (const level of LEVELS) {
	const t0 = performance.now();
	const site = new Site(src, level, 7);
	const tb = performance.now();
	const settleTicks = site.settle();
	const ts = performance.now();
	let drift = 0;
	for (let i = 0; i < site.n; i++) {
		const b = site.blocks[i];
		const o = (site.slots[i] as number) * 8;
		if (!b) continue;
		drift = Math.max(
			drift,
			Math.hypot(
				(site.curr[o] as number) - b.x,
				(site.curr[o + 1] as number) - b.y,
				(site.curr[o + 2] as number) - b.z,
			),
		);
	}
	console.log(
		`${level.id}: ${site.n} blocks (${(site.totalMass / 1000).toFixed(0)} t, above line ${(site.aboveMass / 1000).toFixed(0)} t) build ${(tb - t0).toFixed(0)} ms, settle ${settleTicks} ticks ${(ts - tb).toFixed(0)} ms (${((ts - tb) / settleTicks).toFixed(2)} ms/tick), max drift ${drift.toFixed(3)} m, knocked ${site.knockedMass().toFixed(0)}`,
	);
	for (let s = 0; s < level.shots; s++) {
		const target = level.botTargets[s] ?? [0, 2, 0];
		const v = aimVelocity(level.launcher, target, level.botSpeeds[s] ?? 46);
		site.fire({ tick: site.tick, vx: v[0], vy: v[1], vz: v[2] });
		let worst = 0;
		let sum = 0;
		let peakAwake = 0;
		let t = 0;
		for (; t < 600; t++) {
			const a = performance.now();
			site.step();
			const d = performance.now() - a;
			sum += d;
			worst = Math.max(worst, d);
			if (t % 10 === 0) {
				const aw = site.awakeBlocks();
				peakAwake = Math.max(peakAwake, aw);
				if (t > 150 && aw < 6) break;
			}
		}
		console.log(
			`  shot ${s + 1}: ${t} ticks, avg ${(sum / t).toFixed(2)} ms, worst ${worst.toFixed(1)} ms, peak awake ${peakAwake}, knocked ${((site.knockedMass() / site.aboveMass) * 100).toFixed(1)}%`,
		);
	}
	site.free();
}
