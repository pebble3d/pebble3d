import lacquer from "../../ghosts/lacquer.par.json" with { type: "json" };
import sunfold from "../../ghosts/sunfold.par.json" with { type: "json" };
import undertow from "../../ghosts/undertow.par.json" with { type: "json" };
import { courseById } from "./courses.ts";
import { acceptGhost, type GhostRecord } from "./ghost.ts";

/** Shipped par ghosts (bench/record-par.ts): seed + inputs + the hash they must reproduce. */
const PAR: Record<string, unknown> = { sunfold, lacquer, undertow };

export function parGhost(courseId: string): GhostRecord | null {
	const g = PAR[courseId];
	return acceptGhost(g, courseById(courseId));
}
