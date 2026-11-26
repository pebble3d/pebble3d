// Usage: node --experimental-strip-types test/bench.mjs
import { readFileSync } from "node:fs";
import { loadSim } from "../src/sim.ts";

const wasm = {
	deterministic: readFileSync(
		new URL("../wasm/det/engine_core_det_bg.wasm", import.meta.url),
	),
	fast: readFileSync(
		new URL("../wasm/fast/engine_core_fast_bg.wasm", import.meta.url),
	),
};
const TICKS = 10000;
const WARMUP = 30;
const ACTIVE = 300;

function body(i, type, collider, position) {
	return {
		name: `b${i}`,
		position,
		rotation: [0, 0, 0, 1],
		body: {
			type,
			friction: 0.5,
			restitution: 0,
			linearDamping: 0,
			angularDamping: 0,
			ccd: false,
			collider,
		},
	};
}

function populate(h, n) {
	h.world.spawn(
		JSON.stringify(body("g", "static", { shape: "plane" }, [0, 0, 0])),
	);
	// Staggered grid of boxes/spheres dropped at different heights so they pile up.
	const side = Math.ceil(Math.sqrt(n));
	for (let i = 0; i < n; i++) {
		const gx = i % side;
		const gz = Math.floor(i / side);
		const pos = [
			(gx - side / 2) * 1.1,
			1 + (i % 7) * 1.3,
			(gz - side / 2) * 1.1,
		];
		const c =
			i % 2
				? { shape: "sphere", radius: 0.5 }
				: { shape: "box", halfExtents: [0.5, 0.5, 0.5] };
		h.world.spawn(JSON.stringify(body(i, "dynamic", c, pos)));
	}
}

const rows = [];
for (const build of ["deterministic", "fast"]) {
	for (const bodies of [100, 500]) {
		const h = await loadSim(build, wasm[build]);
		populate(h, bodies);
		// Warm-up ticks are excluded from timing. The ACTIVE window is timed
		// separately: bodies fall asleep after settling, which flatters the
		// full-run number. fullRunMs covers everything after the warm-up.
		h.world.step(WARMUP);
		const t0 = performance.now();
		h.world.step(ACTIVE);
		const activeMs = performance.now() - t0;
		h.world.step(TICKS - WARMUP - ACTIVE);
		const fullMs = performance.now() - t0;
		const counts = Array.from(h.world.bodyCounts());
		rows.push({
			build,
			bodies,
			ticks: TICKS,
			awakeAsleepAtEnd: counts.join("/"),
			activeX: Number((ACTIVE / 60 / (activeMs / 1000)).toFixed(1)),
			fullRunMs: Math.round(fullMs),
			fullRunX: Number(((TICKS - WARMUP) / 60 / (fullMs / 1000)).toFixed(1)),
		});
	}
}
console.table(rows);
const det100 = rows.find(
	(r) => r.build === "deterministic" && r.bodies === 100,
);
if (det100 && det100.activeX < 100) {
	console.log(
		`WARNING: det@100 active-phase speed is ${det100.activeX}x real time (full run ${det100.fullRunX}x); target is 100x`,
	);
}
