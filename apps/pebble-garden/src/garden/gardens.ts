import g1 from "../../gardens/01-first-roll.json";
import g2 from "../../gardens/02-domino-terrace.json";
import g3 from "../../gardens/03-turning-rake.json";
import g4 from "../../gardens/04-rock-garden.json";
import type { GardenDoc, Quat, Vec3 } from "./doc.ts";

/** A piece placement in a reference solution (and in the demo script). */
export interface Placement {
	piece: string;
	position: Vec3;
	rotation?: Quat;
}

/**
 * The starter gardens. Each file is a plain scene JSON (exactly what Export writes); the
 * metadata here is the sandbox's own. Challenge gardens have a `pebble` and a `goal`
 * bowl: their own entities are locked, the player adds pieces, and `solution` is a
 * reference that the tests prove reaches the goal.
 */
export interface GardenInfo {
	key: string;
	name: string;
	blurb: string;
	/** Challenge: pieces the reference solution needs (3 stars at or under par). */
	par: number | null;
	solution: Placement[];
	doc: GardenDoc;
}

export const GARDENS: readonly GardenInfo[] = [
	{
		key: "first-roll",
		name: "First Roll",
		blurb:
			"The pebble rolls off the chute and away. Guide it into the walled bowl.",
		par: 1,
		solution: [
			{
				piece: "wall",
				position: [2.5, 0.3, 0.2],
				rotation: [0, -0.5, 0, 0.866025],
			},
		],
		doc: g1 as unknown as GardenDoc,
	},
	{
		key: "domino-terrace",
		name: "Domino Terrace",
		blurb: "Nine dominoes stand between you and the bowl. Start the run.",
		par: 1,
		solution: [{ piece: "sphere", position: [-3.35, 2.6, 0] }],
		doc: g2 as unknown as GardenDoc,
	},
	{
		key: "turning-rake",
		name: "The Turning Rake",
		blurb:
			"The pebble will not move by itself. Kinematic rakes turn when you press Play.",
		par: 1,
		solution: [{ piece: "rake", position: [-0.5, 0.15, -1] }],
		doc: g3 as unknown as GardenDoc,
	},
	{
		key: "rock-garden",
		name: "Rock Garden",
		blurb:
			"A free sandbox: a boulder ramp, a domino arc, a rake and a roller. Make it yours.",
		par: null,
		solution: [],
		doc: g4 as unknown as GardenDoc,
	},
];

export const CHALLENGES = GARDENS.filter((g) => g.par !== null);

export function gardenByKey(key: string): GardenInfo | undefined {
	return GARDENS.find((g) => g.key === key);
}
