import hallCircuit from "../../tracks/hall-circuit.json" with { type: "json" };
import needle from "../../tracks/needle-and-eaves.json" with { type: "json" };
import yard from "../data/yard.json" with { type: "json" };
import { parseTrack, type SiteDef, type TrackFile } from "./track.ts";

export const SITE: SiteDef = yard as unknown as SiteDef;

/** The shipped tracks, in menu order. */
export const TRACKS: TrackFile[] = [hallCircuit, needle].map((t) =>
	parseTrack(t, SITE),
);

export function trackById(id: string): TrackFile {
	const t = TRACKS.find((k) => k.id === id);
	if (!t) throw new Error(`unknown track "${id}"`);
	return t;
}
