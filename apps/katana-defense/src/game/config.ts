import archetypesJson from "../data/archetypes.json" with { type: "json" };
import arenaJson from "../data/arena.json" with { type: "json" };
import movesJson from "../data/moves.json" with { type: "json" };
import wavesJson from "../data/waves.json" with { type: "json" };
import { parseArchetypes } from "./ai/archetypes.ts";
import type { ArenaDef } from "./arena.ts";
import { parseMoves, type RawMoveFile } from "./combat/moves.ts";
import type { SimConfig } from "./sim.ts";
import type { WaveFile } from "./waves/director.ts";

export const ARENA = arenaJson as unknown as ArenaDef;
export const MOVES = parseMoves(movesJson as unknown as RawMoveFile);
export const ARCHETYPES = parseArchetypes(
	archetypesJson as Record<string, unknown>,
);
export const WAVES = wavesJson as unknown as WaveFile;

/** The shipped game data with run options. */
export function defaultConfig(
	opts: Partial<
		Omit<SimConfig, "arena" | "moves" | "archetypes" | "waves">
	> = {},
): SimConfig {
	return {
		seed: 1,
		...opts,
		arena: ARENA,
		moves: MOVES,
		archetypes: ARCHETYPES,
		waves: WAVES,
	};
}
