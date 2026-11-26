// Dev aid: runs a garden JSON (plus optional solution pieces) headless and prints the
// pebble's path and the result. node --experimental-strip-types bench/try-garden.ts <file> ['[{"piece":"wall","position":[x,y,z],"rotation":[...]}]']
import { readFileSync } from "node:fs";
import { parseScene } from "@pebble3d/sdk/schema";
import { addPiece, type GardenDoc } from "../src/garden/doc.ts";
import { loadNodeEngine } from "../src/garden/node-engine.ts";
import { pieceByKey } from "../src/garden/pieces.ts";
import { GardenSim } from "../src/garden/sim.ts";

const doc = JSON.parse(
	readFileSync(process.argv[2] as string, "utf8"),
) as GardenDoc;
const sol = JSON.parse(process.argv[3] ?? "[]") as {
	piece: string;
	position: [number, number, number];
	rotation?: [number, number, number, number];
}[];
for (const s of sol)
	addPiece(doc, pieceByKey(s.piece)!, s.position, s.rotation);
const sim = new GardenSim(await loadNodeEngine(), parseScene(doc));
for (let t = 0; t < 1800 && sim.status === "running"; t++) {
	sim.step();
	sim.drain(() => {});
	if (t % 30 === 0 && sim.goalMode)
		console.log(
			t,
			sim.pebbleX().toFixed(2),
			sim.pebbleY().toFixed(2),
			sim.pebbleZ().toFixed(2),
		);
}
console.log(sim.status, sim.reason, sim.tick, sim.hash());
for (const e of sim.entities) {
	const slot = sim.slots[e.index] as number;
	if (slot < 0 || e.body !== "dynamic") continue;
	const c = sim.views.curr;
	console.log(
		e.id,
		[0, 1, 2, 3, 4, 5, 6]
			.map((k) => (c[slot * 8 + k] as number).toFixed(2))
			.join(" "),
	);
}
