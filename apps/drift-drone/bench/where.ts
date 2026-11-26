// Authoring aid for staged captures: live and ghost positions of the demo race at given ticks.
//   node --experimental-strip-types apps/drift-drone/bench/where.ts <track> <tick>...
import { DEMO_BOT, DroneBot } from "../src/game/bot.ts";
import { EV } from "../src/game/events.ts";
import {
	GHOST_STATE,
	Ghost,
	type GhostRecord,
	recordLap,
} from "../src/game/ghost.ts";
import { emptyInput, InputLog } from "../src/game/input.ts";
import { DroneSim, PHASE } from "../src/game/sim.ts";
import { SITE, trackById } from "../src/game/tracks.ts";
import { nodeHost } from "../test/helpers.ts";

const track = trackById(process.argv[2] ?? "hall-circuit");
const want = new Set(process.argv.slice(3).map(Number));
const host = await nodeHost();
const sim = new DroneSim(host, track, SITE, "assisted");
const bot = new DroneBot(sim, DEMO_BOT);
const log = new InputLog();
const inp = emptyInput();
let best: GhostRecord | null = null;
let ghost: Ghost | null = null;
const f = (a: ArrayLike<number>): string =>
	Array.from(a, (v) => v.toFixed(2)).join(",");
while (sim.phase !== PHASE.FINISHED) {
	bot.next(inp);
	log.push(inp);
	sim.step(inp);
	ghost?.step();
	const e = sim.events;
	for (let k = 0; k < e.length; k++) {
		if (e.type[k] === EV.LAP && (!best || (e.b[k] as number) < best.lapTime))
			best = recordLap(sim, SITE, log, e.a[k] as number, "demo", sim.hash());
		if (
			e.type[k] === EV.GATE &&
			e.a[k] === 0 &&
			sim.phase === PHASE.RACE &&
			best
		) {
			ghost?.free();
			ghost = new Ghost(host, track, SITE, best);
			ghost.arm(1e9);
			ghost.launch();
		}
		if (e.type[k] === EV.GATE) console.log("gate", e.a[k], "tick", sim.tick);
	}
	if (want.has(sim.tick))
		console.log(
			sim.tick,
			"live",
			f(sim.pos),
			"ghost",
			ghost && ghost.state === GHOST_STATE.FLYING ? f(ghost.sim.pos) : "-",
		);
}
