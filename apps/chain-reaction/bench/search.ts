// Dev helper: brute-force small solutions for a level (level design / par sanity check).
// node --experimental-strip-types bench/search.ts <level.json> <k> [c0,r0,c1,r1] [kinds,...]
// Tries every combination of k placements (all inventory kinds and dirs, free cells in the
// optional cell rectangle) and prints the ones that solve the level.
import { readFileSync } from "node:fs";
import { placementError } from "../src/puzzle/compose.ts";
import { type Placement, parseLevel } from "../src/puzzle/level.ts";
import { loadNodeEngine } from "../src/puzzle/node-engine.ts";
import { PART_DIRS } from "../src/puzzle/parts.ts";
import { PuzzleSim } from "../src/puzzle/sim.ts";

const level = parseLevel(
	JSON.parse(readFileSync(process.argv[2] as string, "utf8")),
);
const k = Number(process.argv[3] ?? 1);
const rect = (
	process.argv[4] ?? `0,0,${level.grid.cols - 1},${level.grid.rows - 1}`
)
	.split(",")
	.map(Number) as [number, number, number, number];
const kinds = (process.argv[5]?.split(",") ??
	Object.keys(level.inventory)) as Placement["part"][];
const engine = await loadNodeEngine();
const cands: Placement[] = [];
for (const part of kinds)
	for (const dir of PART_DIRS[part])
		for (let c = rect[0]; c <= rect[2]; c++)
			for (let r = rect[1]; r <= rect[3]; r++) {
				const p: Placement = { part, cell: [c, r], dir };
				if (!placementError(level, [p])) cands.push(p);
			}
console.log(`${cands.length} candidates, k=${k}`);
let tried = 0;
let found = 0;
const t0 = performance.now();
const pick: Placement[] = [];
function rec(start: number): void {
	if (pick.length === k) {
		if (placementError(level, pick)) return;
		tried++;
		const sim = new PuzzleSim(engine, level, pick);
		const r = sim.run();
		sim.dispose();
		if (r.status === "solved") {
			found++;
			console.log(r.tick, JSON.stringify(pick));
		}
		return;
	}
	for (let i = start; i < cands.length; i++) {
		pick.push(cands[i] as Placement);
		rec(i + 1);
		pick.pop();
	}
}
rec(0);
console.log(
	`tried ${tried}, solved ${found}, ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
