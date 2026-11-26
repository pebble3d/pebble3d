// Dev helper: run a level JSON (or a candidate placement list) headless and trace the ball.
// node --experimental-strip-types bench/try.ts <level.json> [placements-json] [every]
import { readFileSync } from "node:fs";
import { parseLevel } from "../src/puzzle/level.ts";
import { loadNodeEngine } from "../src/puzzle/node-engine.ts";
import { PuzzleSim } from "../src/puzzle/sim.ts";

const level = parseLevel(
	JSON.parse(readFileSync(process.argv[2] as string, "utf8")),
);
const placements = process.argv[3]
	? JSON.parse(process.argv[3])
	: level.solution;
const every = Number(process.argv[4] ?? 15);
const engine = await loadNodeEngine();
const sim = new PuzzleSim(engine, level, placements);
while (sim.status === "running") {
	sim.step();
	sim.drain((e) => {
		if (e.kind !== "impact")
			console.log(
				`  ${e.tick} ${e.kind} (${e.x.toFixed(2)},${e.y.toFixed(2)}) ${e.strength.toFixed(2)}`,
			);
	});
	if (sim.tick % every === 0) {
		let line = `${sim.tick} ball ${sim.ballX().toFixed(2)},${sim.ballY().toFixed(2)}`;
		if (process.env.ALL)
			for (const [sid, id] of sim.ids) {
				if (!/marble|block|plank/.test(sid)) continue;
				const t = sim.world.transformOf(id) as Float32Array;
				const ang =
					(2 * Math.atan2(t[5] as number, t[6] as number) * 180) / Math.PI;
				line += ` | ${sid} ${t[0]?.toFixed(2)},${t[1]?.toFixed(2)} ${ang.toFixed(0)}°`;
			}
		console.log(line);
	}
}
console.log(sim.result());
