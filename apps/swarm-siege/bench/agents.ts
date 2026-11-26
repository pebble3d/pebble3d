// Agent-architecture bench: which way of moving thousands of enemies holds a 60 Hz tick?
//
//   A. physics  N Rapier rigid bodies (spheres), each steered with setVelocity every tick,
//               then world.step(1). Both wasm builds. (bench/physics-agents.ts)
//   B. pooled   The real SiegeSim in stress mode: pooled kinematic agents on sampled paths,
//               the spatial grid rebuilt every tick (what towers query), fast build world.
//               Measured at the same counts plus the full 32,768 pool.
//
// Reports mean / p95 ms per tick. Budget: 16.7 ms per tick in total, and the worker also
// packs a snapshot each batch, so a sim should stay well under ~8 ms.
// Run: pnpm --filter swarm-siege bench [--quick]
import { readFileSync } from "node:fs";
import { loadSim, StateViews } from "@pebble3d/sdk/sim";
import { emptyInput } from "../src/game/input.ts";
import { defaultConfig, SiegeSim } from "../src/game/sim.ts";
import { newSnapshot, packSnapshot } from "../src/game/snapshot.ts";
import { physicsBench } from "./physics-agents.ts";

const quick = process.argv.includes("--quick");
const COUNTS = quick
	? [1000, 4000]
	: [500, 1000, 2000, 4000, 8000, 16384, 32768];

async function pooled(
	n: number,
): Promise<{ agents: number; meanMs: number; p95Ms: number; packMs: number }> {
	const bytes = readFileSync(
		new URL(
			"../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm",
			import.meta.url,
		),
	);
	const h = await loadSim("fast", bytes, { seed: 1 });
	// Spawn n agents fast (n per second over 1 s of ticks), then measure.
	const sim = new SiegeSim(
		h,
		new StateViews(h),
		defaultConfig({ stress: true, stressRate: n, stressCap: n }),
	);
	const input = emptyInput();
	while (sim.alive < n && sim.tick < 600) {
		sim.step(input);
		sim.events.clear();
	}
	const snap = newSnapshot();
	const times: number[] = [];
	let pack = 0;
	for (let t = 0; t < 240; t++) {
		const t0 = performance.now();
		sim.step(input);
		const t1 = performance.now();
		packSnapshot(sim, snap, true);
		pack += performance.now() - t1;
		sim.events.clear();
		if (t >= 20) times.push(t1 - t0);
	}
	times.sort((a, b) => a - b);
	const mean = times.reduce((a, b) => a + b, 0) / times.length;
	const r = (v: number) => Math.round(v * 100) / 100;
	return {
		agents: sim.alive,
		meanMs: r(mean),
		p95Ms: r(times[Math.floor(times.length * 0.95)] ?? 0),
		packMs: r(pack / 240),
	};
}

console.log("A. Rapier rigid bodies, steered every tick:");
console.table(await physicsBench());
console.log("B. Pooled kinematic agents (SiegeSim stress mode, fast build):");
const rows = [];
for (const n of COUNTS) rows.push(await pooled(n));
console.table(rows);
