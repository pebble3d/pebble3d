import courtyardScene from "../../scenes/courtyard.json" with { type: "json" };
import yardScene from "../../scenes/yard.json" with { type: "json" };
import courtyardWorld from "../data/courtyard.json" with { type: "json" };
import yardWorld from "../data/yard.json" with { type: "json" };
import type { WorldDef } from "./sim.ts";

/** A survey site: one Gaussian-splat capture with its scene, gameplay world and credits. */
export interface Site {
	id: string;
	name: string;
	blurb: string;
	/** Attribution line for the capture (CC BY 4.0). */
	credit: string;
	scene: unknown;
	world: WorldDef;
}

export const SITES: readonly Site[] = [
	{
		id: "yard",
		name: "The Hall Yard",
		blurb:
			"Six anomalies have surfaced in the yard behind the old hall. Find each one and bring back a photograph worth keeping before the light goes.",
		credit:
			"Gaussian-splat capture: “Knock Community Hall” by scbenoit, CC BY 4.0",
		scene: yardScene,
		world: yardWorld as unknown as WorldDef,
	},
	{
		id: "courtyard",
		name: "The Courtyard Flat",
		blurb:
			"Something has moved into a quiet flat and its wisteria courtyard. Six anomalies, two rooms, one roll of film. Mind the furniture.",
		credit:
			"Gaussian-splat capture: “SA3D_R&D_XP47” by Stéphane Agullo (sa3d.fr), CC BY 4.0",
		scene: courtyardScene,
		world: courtyardWorld as unknown as WorldDef,
	},
];

export function siteById(id: string | null): Site {
	const s = SITES.find((x) => x.id === id);
	if (id !== null && !s) throw new Error(`bad site param "${id}"`);
	return s ?? (SITES[0] as Site);
}
