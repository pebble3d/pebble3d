// Records the "par" ghost for every course: the demo bot (par tuning) on seed 1, saved as
// seed + input log + the hash it produced. Tests re-simulate these files and must reproduce
// the hash bit for bit. Usage: pnpm --filter ghostline par
import { readFileSync, writeFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { Bot } from "../src/game/bot.ts";
import { COURSES } from "../src/game/courses.ts";
import { recordOf, runToEnd } from "../src/game/ghost.ts";
import { InputLog } from "../src/game/input.ts";
import { hostFromHandle } from "../src/game/physics.ts";
import { MarbleSim } from "../src/game/sim.ts";
import { Track } from "../src/game/track.ts";

const wasm = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);
const host = hostFromHandle(await loadSim("deterministic", wasm));
for (const c of COURSES) {
	const sim = new MarbleSim(host, c, new Track(c.track), 1);
	const bot = new Bot(sim, c.bot);
	const log = new InputLog();
	runToEnd(sim, (o) => bot.next(o), log);
	const rec = recordOf(sim, log, "par");
	const out = new URL(`../ghosts/${c.id}.par.json`, import.meta.url);
	writeFileSync(out, `${JSON.stringify(rec, null, "\t")}\n`);
	console.log(
		`${c.id}: ${rec.finishTime.toFixed(3)} s, ${rec.ticks} ticks, ${rec.inputs.length} b64 chars, ${rec.hash}`,
	);
	sim.free();
}
