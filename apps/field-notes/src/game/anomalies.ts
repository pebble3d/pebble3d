/** The six anomaly kinds. Visuals live in view/anomaly-view.ts; this is what the sim needs. */
export interface AnomalyDef {
	id: string;
	name: string;
	/** Journal line, shown once documented. */
	note: string;
	/** Height of the subject centre above the floor, metres. */
	y: number;
	/** Subject radius for framing (projected size), metres. */
	r: number;
	/** The exposure (EV offset) at which it reads best: bright ones want less light. */
	idealEv: number;
	/** CSS colour for the HUD. */
	hue: string;
}

export const ANOMALIES: readonly AnomalyDef[] = [
	{
		id: "moth",
		name: "Lantern Moth",
		note: "Hovers at head height. Wings beat slower when observed.",
		y: 1.35,
		r: 0.42,
		idealEv: -2 / 3,
		hue: "#ffb347",
	},
	{
		id: "knot",
		name: "Halo Knot",
		note: "Mirror-bright, knotted on itself. Reflects a sky that is not there.",
		y: 1.2,
		r: 0.42,
		idealEv: 0,
		hue: "#6fe3ff",
	},
	{
		id: "prism",
		name: "Drift Prism",
		note: "Three stones turning against each other. Hums at dusk.",
		y: 1.0,
		r: 0.5,
		idealEv: 1 / 3,
		hue: "#ff6bd0",
	},
	{
		id: "choir",
		name: "Seed Choir",
		note: "A ring of lights that orbit nothing. Counted fourteen.",
		y: 1.15,
		r: 0.62,
		idealEv: -1 / 3,
		hue: "#e8e070",
	},
	{
		id: "bloom",
		name: "Static Bloom",
		note: "Crystal shards growing from the air. Brittle to the eye.",
		y: 0.95,
		r: 0.55,
		idealEv: -1 / 3,
		hue: "#b58cff",
	},
	{
		id: "door",
		name: "Hollow Door",
		note: "A doorframe standing in the grass. The other side is the same yard.",
		y: 1.05,
		r: 1.05,
		idealEv: 0,
		hue: "#bfe6ff",
	},
];
