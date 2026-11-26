// Rockfall body-count bench: how many live rigid bodies the engine sustains, per build.
//
// Run: pnpm --filter rockfall bench [--out <file.json>] [--quick]
//
// Two measurements, each for the `deterministic` and the `fast` wasm build:
//
// 1. ramp: the engine alone. The arena (floor, walls, pillars) plus the game's own rock
//    templates (convex hulls) fed by engine spawners at 150 bodies/s, mixed like a late
//    wave, rocks never removed. Every second of sim time it records the body count and the
//    mean / p95 cost of `World.step(1)`. The rain keeps the piles awake (worst case: the
//    landing rocks keep waking what is below). "Sustained at B ms" is the body count of the
//    last 1 s window whose mean step stayed within B ms before the first window over it.
//
// 2. game: the real `RockfallSim` (director, hit tests, pickups, the per-build rock cap) with the demo
//    bot in god mode, from wave 6 with 1200 rubble rocks, for 60 s of sim time: mean / p95
//    tick cost and the live body count.
//
// Timings are wall-clock in Node (V8 + the same wasm the browser runs).
import { readFileSync, writeFileSync } from "node:fs";
import { loadSim, type SimBuild, type SimHandle } from "@pebble3d/sdk/sim";
import { DemoBot } from "../src/game/bot.ts";
import {
	ARENA_HALF,
	MAX_ROCKS,
	MAX_ROCKS_FAST,
	PILLAR_HALF,
	PILLAR_HEIGHT,
	PILLARS,
	WALL_HEIGHT,
	WALL_THICK,
} from "../src/game/constants.ts";
import { worldFactory } from "../src/game/factory.ts";
import { emptyInput } from "../src/game/input.ts";
import { KIND, type Kind, rockBody } from "../src/game/rocks.ts";
import { defaultConfig, RockfallSim } from "../src/game/sim.ts";

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;

const RAMP_RATE = 150;
const RAMP_MAX = quick ? 2500 : 6000;
const BUDGETS = [2, 4, 8, 16.7];
const GAME_SECONDS = quick ? 20 : 60;

async function load(build: SimBuild): Promise<SimHandle> {
	const dir =
		build === "deterministic" ? "det/engine_core_det" : "fast/engine_core_fast";
	const bytes = readFileSync(
		new URL(`../../../packages/sdk/wasm/${dir}_bg.wasm`, import.meta.url),
	);
	return loadSim(build, bytes, { seed: 1 });
}

function pct(sorted: number[], p: number): number {
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
	);
}

interface Window {
	second: number;
	bodies: number;
	active: number;
	meanMs: number;
	p95Ms: number;
}

function ramp(h: SimHandle): {
	windows: Window[];
	sustained: Record<string, number>;
} {
	const w = h.world;
	const stat = (p: number[], he: number[]): void => {
		w.spawn(
			JSON.stringify({
				position: p,
				body: { type: "static", collider: { shape: "box", halfExtents: he } },
			}),
		);
	};
	w.spawn(
		JSON.stringify({ body: { type: "static", collider: { shape: "plane" } } }),
	);
	const H = ARENA_HALF + WALL_THICK / 2;
	const L = ARENA_HALF + WALL_THICK;
	const hy = WALL_HEIGHT / 2;
	stat([0, hy, -H], [L, hy, WALL_THICK / 2]);
	stat([0, hy, H], [L, hy, WALL_THICK / 2]);
	stat([-H, hy, 0], [WALL_THICK / 2, hy, L]);
	stat([H, hy, 0], [WALL_THICK / 2, hy, L]);
	for (const [x, z] of PILLARS)
		stat(
			[x, PILLAR_HEIGHT / 2, z],
			[PILLAR_HALF, PILLAR_HEIGHT / 2, PILLAR_HALF],
		);
	// The late-wave mix, one spawner per kind/variant, rates summing to RAMP_RATE.
	const mix: [Kind, number, number][] = [
		[KIND.PEBBLE, 0.55, 4],
		[KIND.ROCK, 0.3, 4],
		[KIND.SLAB, 0.07, 2],
		[KIND.BOULDER, 0.08, 3],
	];
	let seed = 1;
	for (const [kind, share, variants] of mix)
		for (let v = 0; v < variants; v++) {
			const rate = (RAMP_RATE * share) / variants;
			w.spawn(
				JSON.stringify({
					spawner: {
						template: { body: rockBody(kind, v) },
						rate,
						count: Math.ceil((RAMP_MAX * share) / variants),
						areaMin: [-ARENA_HALF + 0.8, 18, -ARENA_HALF + 0.8],
						areaMax: [ARENA_HALF - 0.8, 26, ARENA_HALF - 0.8],
						seed: seed++,
					},
				}),
			);
		}
	const windows: Window[] = [];
	let ms: number[] = [];
	const maxTicks = Math.ceil((RAMP_MAX / RAMP_RATE) * 60) + 120;
	for (let t = 1; t <= maxTicks; t++) {
		const t0 = performance.now();
		w.step(1);
		ms.push(performance.now() - t0);
		if (w.spawnedPending() > 0) w.drainSpawned();
		if (t % 60 === 0) {
			const c = w.bodyCounts();
			const sorted = [...ms].sort((a, b) => a - b);
			windows.push({
				second: t / 60,
				bodies: (c[0] ?? 0) + (c[1] ?? 0),
				active: c[0] ?? 0,
				meanMs: ms.reduce((a, b) => a + b, 0) / ms.length,
				p95Ms: pct(sorted, 0.95),
			});
			ms = [];
		}
	}
	const sustained: Record<string, number> = {};
	for (const b of BUDGETS) {
		let best = 0;
		for (const win of windows) {
			if (win.meanMs > b) break;
			best = win.bodies;
		}
		sustained[`${b}ms`] = best;
	}
	w.free();
	return { windows, sustained };
}

function game(h: SimHandle): {
	meanMs: number;
	p95Ms: number;
	maxMs: number;
	bodiesEnd: number;
	bodiesPeak: number;
	activePeak: number;
	wave: number;
	spawned: number;
} {
	const sim = new RockfallSim(
		worldFactory(h),
		defaultConfig({
			seed: 7,
			startWave: 6,
			rubble: 1200,
			god: true,
			autoStart: true,
			maxRocks: h.build === "fast" ? MAX_ROCKS_FAST : MAX_ROCKS,
		}),
	);
	const bot = new DemoBot(sim);
	const inp = emptyInput();
	const ms: number[] = [];
	let peak = 0;
	let activePeak = 0;
	const ticks = GAME_SECONDS * 60;
	for (let t = 0; t < ticks; t++) {
		bot.next(inp);
		const t0 = performance.now();
		sim.step(inp);
		ms.push(performance.now() - t0);
		if (t % 60 === 0) {
			const [a, s] = sim.bodyCounts();
			peak = Math.max(peak, a + s);
			activePeak = Math.max(activePeak, a);
		}
	}
	const sorted = [...ms].sort((a, b) => a - b);
	const [a, s] = sim.bodyCounts();
	return {
		meanMs: ms.reduce((x, y) => x + y, 0) / ms.length,
		p95Ms: pct(sorted, 0.95),
		maxMs: sorted[sorted.length - 1] ?? 0,
		bodiesEnd: a + s,
		bodiesPeak: peak,
		activePeak,
		wave: sim.wave,
		spawned: sim.totalSpawned,
	};
}

const report: Record<string, unknown> = {
	date: new Date().toISOString(),
	node: process.version,
	rampRate: RAMP_RATE,
	results: {} as Record<string, unknown>,
};
for (const build of ["deterministic", "fast"] as const) {
	console.log(`\n== ${build}`);
	const r = ramp(await load(build));
	console.log("ramp (rain never stops; 1 s windows):");
	console.log("  s   bodies  awake  mean ms  p95 ms");
	for (const win of r.windows)
		if (win.second % 4 === 0 || win.second === r.windows.length)
			console.log(
				`  ${String(win.second).padStart(2)}  ${String(win.bodies).padStart(6)}  ${String(win.active).padStart(5)}  ${win.meanMs.toFixed(2).padStart(7)}  ${win.p95Ms.toFixed(2).padStart(6)}`,
			);
	console.log("  sustained bodies by mean step budget:", r.sustained);
	const g = game(await load(build));
	console.log(
		`game (wave 6+, rubble 1200, bot, ${GAME_SECONDS} s): mean ${g.meanMs.toFixed(2)} ms, p95 ${g.p95Ms.toFixed(2)} ms, max ${g.maxMs.toFixed(1)} ms; bodies peak ${g.bodiesPeak} (awake peak ${g.activePeak}), end ${g.bodiesEnd}; reached wave ${g.wave}; ${g.spawned} spawned`,
	);
	(report.results as Record<string, unknown>)[build] = { ramp: r, game: g };
}
if (outFile) {
	writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
	console.log(`\nwrote ${outFile}`);
}
