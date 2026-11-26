// Runs the demo bot on each course headless and prints times (course tuning aid).
// node --experimental-strip-types bench/run-bot.ts [courseId] [seed]
import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { Bot } from "../src/game/bot.ts";
import { COURSES } from "../src/game/courses.ts";
import { emptyInput } from "../src/game/input.ts";
import { hostFromHandle } from "../src/game/physics.ts";
import { MarbleSim, PHASE } from "../src/game/sim.ts";
import { Track } from "../src/game/track.ts";

const wasm = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);
const h = await loadSim("deterministic", wasm);
const host = hostFromHandle(h);
const only = process.argv[2];
const seed = Number(process.argv[3] ?? 1);
for (const c of COURSES) {
	if (only && c.id !== only) continue;
	const track = new Track(c.track);
	const t0 = performance.now();
	const sim = new MarbleSim(host, c, track, seed);
	const bot = new Bot(sim, c.bot);
	const inp = emptyInput();
	let maxV = 0;
	let lastLog = -1;
	while (sim.phase !== PHASE.DONE && sim.tick < 60 * 200) {
		bot.next(inp);
		sim.step(inp);
		maxV = Math.max(maxV, sim.speed());
		for (let e = 0; e < sim.events.length; e++) {
			const ty = sim.events.type[e];
			if (ty === 7)
				console.log(`  respawn at sample ${sim.progress} tick ${sim.tick}`);
		}
		if (process.env.TRACE && sim.tick % 60 === 0 && sim.tick !== lastLog) {
			lastLog = sim.tick;
			console.log(
				`  t=${(sim.runTick / 60).toFixed(1)} i=${sim.progress}/${track.n} v=${sim.speed().toFixed(1)} lat=${sim.lateral.toFixed(2)} above=${sim.above.toFixed(2)} g=${sim.grounded}`,
			);
		}
	}
	const ms = performance.now() - t0;
	console.log(
		`${c.id}: finish ${sim.finishTime.toFixed(3)}s splits [${sim.splits.map((s) => s.toFixed(2)).join(", ")}] respawns ${sim.respawns} maxV ${maxV.toFixed(1)} m/s, len ${(track.n * 0.5).toFixed(0)} m, ${sim.tick} ticks in ${ms.toFixed(0)} ms, hash ${sim.hash()}`,
	);
	sim.free();
}
