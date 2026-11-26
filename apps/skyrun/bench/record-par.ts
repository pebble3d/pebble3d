// Records each course's shipped "course spirit" ghost from the fast demo bot:
//   node --experimental-strip-types bench/record-par.ts
import { writeFileSync } from "node:fs";
import { DemoBot } from "../src/game/bot.ts";
import { makeRecord } from "../src/game/ghost.ts";
import { emptyInput, InputLog } from "../src/game/input.ts";
import { PHASE } from "../src/game/sim.ts";
import { loadCourse, nodeHost, SkyrunSim } from "../test/helpers.ts";

const host = await nodeHost();
for (const id of ["dawnsteps", "gale-spires"]) {
	const course = loadCourse(id);
	const sim = new SkyrunSim(host, course);
	const bot = new DemoBot(sim, "fast");
	const log = new InputLog();
	const inp = emptyInput();
	while (sim.phase !== PHASE.DONE && sim.tick < 60 * 300) {
		bot.next(inp);
		log.push(inp);
		sim.step(inp);
	}
	if (sim.phase !== PHASE.DONE) throw new Error(`${id}: bot did not finish`);
	const rec = makeRecord(course, sim.runTicks, log, "robot", "par", sim.falls);
	writeFileSync(
		new URL(`../courses/${id}.par.json`, import.meta.url),
		`${JSON.stringify(rec, null, "\t")}\n`,
	);
	console.log(
		`${id}: ${(sim.runTicks / 60).toFixed(2)} s, ${log.length} ticks`,
	);
	sim.free();
}
