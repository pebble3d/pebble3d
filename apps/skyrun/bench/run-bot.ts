// Dev tool: node --experimental-strip-types bench/run-bot.ts <course> [fast|casual]
import { DemoBot } from "../src/game/bot.ts";
import { emptyInput } from "../src/game/input.ts";
import { EV, PHASE } from "../src/game/sim.ts";
import { loadCourse, nodeHost, SkyrunSim } from "../test/helpers.ts";

const host = await nodeHost();
const course = loadCourse(process.argv[2] ?? "dawnsteps");
const sim = new SkyrunSim(host, course);
const bot = new DemoBot(sim, (process.argv[3] as "fast" | "steady") ?? "fast");
const inp = emptyInput();
let lastStep = -1;
const names: Record<number, string> = {};
for (const [k, v] of Object.entries(EV)) names[v] = k;
for (let t = 0; t < 60 * 180 && sim.phase !== PHASE.DONE; t++) {
	bot.next(inp);
	sim.step(inp);
	for (let e = 0; e < sim.events.n; e++) {
		const ty = sim.events.type[e] as number;
		if (ty === EV.JUMP || ty === EV.LAND || ty === EV.BEEP) continue;
		console.log(
			`t${sim.tick} ${names[ty]} a=${sim.events.a[e]} p=(${sim.px.toFixed(2)},${sim.py.toFixed(2)},${sim.pz.toFixed(2)})`,
		);
	}
	if (bot.stepIndex !== lastStep) {
		lastStep = bot.stepIndex;
		console.log(
			`t${sim.tick} step ${lastStep} p=(${sim.px.toFixed(2)},${sim.py.toFixed(2)},${sim.pz.toFixed(2)}) g=${sim.grounded}`,
		);
	}
	if (process.env.TRACE && sim.tick % 20 === 0)
		console.log(
			`  t${sim.tick} p=(${sim.px.toFixed(2)},${sim.py.toFixed(2)},${sim.pz.toFixed(2)}) g=${sim.grounded} v=(${sim.vx.toFixed(1)},${sim.vy.toFixed(1)},${sim.vz.toFixed(1)})`,
		);
}
console.log(
	`phase=${sim.phase} time=${sim.time.toFixed(2)} shards=${sim.shards}/${course.shards.length} falls=${sim.falls} hash=${sim.hash()}`,
);
