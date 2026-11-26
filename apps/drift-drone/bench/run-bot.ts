// Flies the demo bot headless and prints its gates and laps (authoring aid for tracks):
//   node --experimental-strip-types apps/drift-drone/bench/run-bot.ts [track] [v] [demo]
import { DEFAULT_BOT, DEMO_BOT, DroneBot } from "../src/game/bot.ts";
import { EV } from "../src/game/events.ts";
import { emptyInput } from "../src/game/input.ts";
import { DroneSim, PHASE } from "../src/game/sim.ts";
import { SITE, trackById } from "../src/game/tracks.ts";
import { nodeHost } from "../test/helpers.ts";

const NAMES = [
	"",
	"count",
	"go",
	"gate",
	"lap",
	"crash",
	"respawn",
	"finish",
	"bump",
];
const track = trackById(process.argv[2] ?? "hall-circuit");
const verbose = process.argv[3] === "v";
const tune = process.argv.includes("demo") ? DEMO_BOT : DEFAULT_BOT;
const host = await nodeHost();
const sim = new DroneSim(host, track, SITE, "assisted");
const bot = new DroneBot(sim, tune);
const inp = emptyInput();
const fmt = (a: ArrayLike<number>): string =>
	Array.from(a, (v) => v.toFixed(2)).join(",");
while (sim.phase !== PHASE.FINISHED && sim.tick < 60 * 120) {
	bot.next(inp);
	sim.step(inp);
	const e = sim.events;
	for (let k = 0; k < e.length; k++) {
		const t = e.type[k] as number;
		if (
			t === EV.GATE ||
			t === EV.LAP ||
			t === EV.CRASH ||
			t === EV.FINISH ||
			(verbose && t === EV.BUMP)
		)
			console.log(
				sim.tick,
				NAMES[t],
				e.a[k],
				(e.b[k] as number).toFixed(3),
				fmt(sim.pos),
			);
	}
	if (verbose && sim.tick % 30 === 0)
		console.log(
			"  t",
			sim.tick,
			fmt(sim.pos),
			"v",
			sim.speed().toFixed(2),
			"up",
			(sim.up[1] as number).toFixed(2),
			bot.current,
		);
}
console.log({
	laps: sim.lapTimes.map((t) => t.toFixed(3)),
	finish: sim.finishTime.toFixed(3),
	crashes: sim.crashes,
	tick: sim.tick,
	hash: sim.hash(),
});
