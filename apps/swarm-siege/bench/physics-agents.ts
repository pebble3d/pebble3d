// Option A of the agent-architecture bench: every enemy a Rapier rigid body.
//
// N dynamic spheres (r 0.22 m, the mite size) on the ground in a 6 m wide lane, steered every
// tick with `setVelocity` toward a point moving along the lane (what a physics swarm would
// need to follow the path), then `world.step(1)`. Reports mean / p95 ms per tick for both wasm
// builds. Run: node --experimental-strip-types bench/physics-agents.ts [--quick]
import { readFileSync } from "node:fs";
import { loadSim, type SimBuild, StateViews } from "@pebble3d/sdk/sim";

const quick = process.argv.includes("--quick");
const COUNTS = quick ? [500, 1000, 2000] : [500, 1000, 2000, 4000, 8000];
const TICKS = quick ? 120 : 240;

export interface PhysicsRow {
	build: SimBuild;
	agents: number;
	meanMs: number;
	p95Ms: number;
}

async function measure(build: SimBuild, n: number): Promise<PhysicsRow> {
	const dir =
		build === "deterministic" ? "det/engine_core_det" : "fast/engine_core_fast";
	const bytes = readFileSync(
		new URL(`../../../packages/sdk/wasm/${dir}_bg.wasm`, import.meta.url),
	);
	const h = await loadSim(build, bytes, { seed: 1 });
	const w = h.world;
	w.spawn(
		JSON.stringify({
			position: [0, -0.5, 0],
			rotation: [0, 0, 0, 1],
			body: {
				type: "static",
				collider: { shape: "box", halfExtents: [200, 0.5, 200] },
			},
		}),
	);
	const ids = new Uint32Array(n);
	const tmpl = JSON.stringify;
	// A long lane along +x; agents start packed at its head, 6 m wide.
	for (let i = 0; i < n; i++) {
		const x = -150 + (i % 300) * 0.5;
		const z = -3 + Math.floor(i / 300) * 0.48;
		ids[i] = w.spawn(
			tmpl({
				position: [x, 0.23, (z % 6) - 3],
				rotation: [0, 0, 0, 1],
				body: {
					type: "dynamic",
					friction: 0.2,
					collider: { shape: "sphere", radius: 0.22 },
				},
			}),
		);
	}
	const views = new StateViews(h);
	const times: number[] = [];
	for (let t = 0; t < TICKS; t++) {
		const t0 = performance.now();
		views.refresh();
		const c = views.curr;
		for (let i = 0; i < n; i++) {
			const slot = w.slotOf(ids[i] as number);
			const z = c[slot * 8 + 2] as number;
			// Forward 3 m/s, steer back toward the lane centre.
			w.setVelocity(ids[i] as number, 3, 0, -z * 0.5, 0, 0, 0);
		}
		w.step(1);
		const dt = performance.now() - t0;
		if (t >= 20) times.push(dt);
	}
	w.free();
	times.sort((a, b) => a - b);
	const mean = times.reduce((a, b) => a + b, 0) / times.length;
	return {
		build,
		agents: n,
		meanMs: Math.round(mean * 100) / 100,
		p95Ms:
			Math.round((times[Math.floor(times.length * 0.95)] ?? 0) * 100) / 100,
	};
}

export async function physicsBench(): Promise<PhysicsRow[]> {
	const rows: PhysicsRow[] = [];
	for (const build of ["fast", "deterministic"] as const)
		for (const n of COUNTS) rows.push(await measure(build, n));
	return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	console.table(await physicsBench());
}
