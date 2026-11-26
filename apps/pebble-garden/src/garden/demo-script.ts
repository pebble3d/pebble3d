import {
	addPiece,
	emptyDoc,
	findEntity,
	type GardenDoc,
	type Quat,
	setMaterial,
	setTransform,
	type Vec3,
} from "./doc.ts";
import { pieceByKey } from "./pieces.ts";

/**
 * The `?demo=1` contraption, as data: a pebble chute on a standing stone, a walled moss
 * bowl, and a guide wall that turns the rolling pebble into the bowl. The browser demo
 * performs these steps through the editor (ghost preview, place, inspector edits); the
 * tests apply them straight to a doc and prove the result reaches the goal.
 */
export type DemoStep =
	| { kind: "place"; piece: string; at: Vec3; rot?: Quat; label: string }
	| { kind: "scale"; scale: Vec3; label: string }
	| { kind: "color"; color: string; label: string };

const Y90: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

export const DEMO_STEPS: readonly DemoStep[] = [
	{ kind: "place", piece: "goal", at: [3.5, -0.03, 3], label: "bowl" },
	{ kind: "scale", scale: [2, 0.1, 2], label: "widen the bowl" },
	{ kind: "place", piece: "wall", at: [3.5, 0.3, 4.05], label: "back wall" },
	{ kind: "scale", scale: [2.4, 0.6, 0.3], label: "fit the wall" },
	{
		kind: "place",
		piece: "wall",
		at: [2.45, 0.3, 3],
		rot: Y90,
		label: "left wall",
	},
	{ kind: "scale", scale: [1.8, 0.6, 0.3], label: "fit the wall" },
	{
		kind: "place",
		piece: "wall",
		at: [4.55, 0.3, 3],
		rot: Y90,
		label: "right wall",
	},
	{ kind: "scale", scale: [1.8, 0.6, 0.3], label: "fit the wall" },
	{
		kind: "place",
		piece: "pillar",
		at: [-6.3, 0.95, 0],
		label: "standing stone",
	},
	{ kind: "scale", scale: [0.6, 1.9, 0.6], label: "raise the stone" },
	{
		kind: "place",
		piece: "plank",
		at: [-5, 1.4, 0],
		rot: [0, 0, -0.190809, 0.981627],
		label: "chute",
	},
	{ kind: "scale", scale: [3, 0.12, 1], label: "lengthen the chute" },
	{ kind: "place", piece: "pebble", at: [-6.1, 2.3, 0], label: "pebble" },
	{
		kind: "place",
		piece: "wall",
		at: [2.5, 0.3, 0.2],
		rot: [0, -0.5, 0, 0.866025],
		label: "guide wall",
	},
	{ kind: "color", color: "#4f9d8c", label: "paint the guide jade" },
];

/** Applies the demo steps to a doc (each scale / colour edits the last placed piece). */
export function buildDemoDoc(
	steps: readonly DemoStep[] = DEMO_STEPS,
): GardenDoc {
	const d = emptyDoc();
	let last: string | null = null;
	for (const s of steps) {
		if (s.kind === "place") {
			const p = pieceByKey(s.piece);
			if (!p) throw new Error(`no piece ${s.piece}`);
			last = addPiece(d, p, s.at, s.rot);
		} else if (last) {
			const e = findEntity(d, last);
			const pos = (e?.transform?.position ?? [0, 0, 0]) as Vec3;
			const rot = (e?.transform?.rotation ?? [0, 0, 0, 1]) as Quat;
			if (s.kind === "scale") setTransform(d, last, pos, rot, s.scale);
			else setMaterial(d, last, { color: s.color });
		}
	}
	return d;
}
