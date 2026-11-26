import { parseScene } from "@pebble3d/sdk/schema";
import { addPiece, cloneDoc, type GardenDoc } from "../src/garden/doc.ts";
import type { Placement } from "../src/garden/gardens.ts";
import { loadNodeEngine } from "../src/garden/node-engine.ts";
import { pieceByKey } from "../src/garden/pieces.ts";
import { type Engine, GardenSim } from "../src/garden/sim.ts";

let engine: Engine | null = null;
export async function nodeEngine(): Promise<Engine> {
	engine ??= await loadNodeEngine();
	return engine;
}

export function withPieces(
	doc: GardenDoc,
	placements: readonly Placement[],
): GardenDoc {
	const d = cloneDoc(doc);
	for (const p of placements) {
		const piece = pieceByKey(p.piece);
		if (!piece) throw new Error(`no piece ${p.piece}`);
		addPiece(d, piece, p.position, p.rotation);
	}
	return d;
}

export async function simOf(doc: GardenDoc): Promise<GardenSim> {
	return new GardenSim(await nodeEngine(), parseScene(doc));
}

/** State hash after `n` ticks of a fresh sim of `doc`. */
export async function hashAfter(doc: GardenDoc, n: number): Promise<string> {
	const sim = await simOf(doc);
	sim.run(n);
	const h = sim.hash();
	sim.dispose();
	return h;
}
