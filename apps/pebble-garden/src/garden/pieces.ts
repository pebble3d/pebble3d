import type { SceneInput } from "@pebble3d/sdk/schema";

/** One raw (unparsed) scene entity, exactly as it appears in the exported JSON. */
export type EntityInput = NonNullable<SceneInput["entities"]>[number];
/** One raw prefab definition. */
export type PrefabInput = NonNullable<SceneInput["prefabs"]>[string];
export type BodyKind = "dynamic" | "static" | "kinematic";

/**
 * The garden palette. A piece is either a bare primitive (written inline into the entity)
 * or a prefab: the prefab definition is added to the scene's `prefabs` table the first
 * time it is used and the entity just references it, so an exported garden reads like a
 * hand-written scene.
 */
export interface Piece {
	key: string;
	label: string;
	/** One-line description for the palette tooltip. */
	blurb: string;
	/** Keyboard shortcut shown on the palette (1-9, 0). */
	hotkey?: string;
	/** Prefab name (the definition is `prefab`); absent for inline primitives. */
	prefabName?: string;
	prefab?: PrefabInput;
	/** Inline entity fields for a primitive piece (everything but id and position). */
	inline?: Omit<EntityInput, "id">;
	/** Placement rotation (quaternion) applied on top of the prefab's. */
	rotation?: [number, number, number, number];
	/** Preferred entity id stem ("pebble" and "goal" are special to the goal rules). */
	idStem: string;
}

/** Palette colours: raked sand, basalt, granite, cedar, moss, vermilion. */
export const COLORS = {
	sand: "#e8dcc4",
	cream: "#e6dccb",
	granite: "#9a958c",
	basalt: "#45403d",
	cedar: "#b8743f",
	darkCedar: "#6e4128",
	moss: "#6f8f4e",
	vermilion: "#d9482f",
	ink: "#2b2724",
	jade: "#4f9d8c",
} as const;

const S = Math.SQRT1_2;

export const PIECES: readonly Piece[] = [
	{
		key: "box",
		label: "Block",
		blurb: "A 1 m stone block (dynamic)",
		hotkey: "1",
		idStem: "block",
		inline: {
			mesh: {
				primitive: "box",
				material: { color: COLORS.cream, roughness: 0.8 },
			},
			body: { type: "dynamic" },
			transform: { scale: [0.8, 0.8, 0.8] },
		},
	},
	{
		key: "sphere",
		label: "Ball",
		blurb: "A granite ball (dynamic)",
		hotkey: "2",
		idStem: "ball",
		inline: {
			mesh: {
				primitive: "sphere",
				material: { color: COLORS.granite, roughness: 0.6 },
			},
			body: { type: "dynamic", restitution: 0.2 },
			transform: { scale: [0.7, 0.7, 0.7] },
		},
	},
	{
		key: "cylinder",
		label: "Drum",
		blurb: "A short cylinder (dynamic)",
		hotkey: "3",
		idStem: "drum",
		inline: {
			mesh: {
				primitive: "cylinder",
				material: { color: COLORS.jade, roughness: 0.45 },
			},
			body: { type: "dynamic" },
			transform: { scale: [0.8, 0.6, 0.8] },
		},
	},
	{
		key: "capsule",
		label: "Capsule",
		blurb: "A rounded capsule (dynamic)",
		hotkey: "4",
		idStem: "capsule",
		inline: {
			mesh: {
				primitive: "capsule",
				material: { color: COLORS.moss, roughness: 0.7 },
			},
			body: { type: "dynamic" },
			transform: { scale: [0.5, 1.2, 0.5] },
		},
	},
	{
		key: "plank",
		label: "Plank",
		blurb: "A cedar plank to build ramps and ledges (static)",
		hotkey: "5",
		idStem: "plank",
		prefabName: "plank",
		prefab: {
			mesh: {
				primitive: "box",
				material: { color: COLORS.cedar, roughness: 0.65 },
			},
			body: { type: "static", friction: 0.4 },
			transform: { scale: [2.4, 0.12, 0.8] },
		},
		// A gentle 15-degree slope down towards +x.
		rotation: [0, 0, -0.130526, 0.991445],
	},
	{
		key: "domino",
		label: "Domino",
		blurb: "A tall thin tile that topples (dynamic)",
		hotkey: "6",
		idStem: "domino",
		prefabName: "domino",
		prefab: {
			mesh: {
				primitive: "box",
				material: { color: COLORS.ink, roughness: 0.6 },
			},
			body: { type: "dynamic", friction: 0.6 },
			transform: { scale: [0.16, 1, 0.5] },
		},
	},
	{
		key: "pebble",
		label: "Pebble",
		blurb: "The marble. Get it to rest in the bowl (dynamic)",
		hotkey: "7",
		idStem: "pebble",
		prefabName: "pebble",
		prefab: {
			mesh: {
				primitive: "sphere",
				material: { color: COLORS.vermilion, roughness: 0.2 },
			},
			body: {
				type: "dynamic",
				friction: 0.6,
				restitution: 0.15,
				angularDamping: 0.25,
				linearDamping: 0.02,
				ccd: true,
			},
			transform: { scale: [0.42, 0.42, 0.42] },
		},
	},
	{
		key: "boulder",
		label: "Boulder",
		blurb: "A heavy basalt boulder (dynamic)",
		hotkey: "8",
		idStem: "boulder",
		prefabName: "boulder",
		prefab: {
			mesh: {
				primitive: "sphere",
				material: { color: COLORS.basalt, roughness: 0.85 },
			},
			body: { type: "dynamic", mass: 6 },
			transform: { scale: [1, 1, 1] },
		},
	},
	{
		key: "wall",
		label: "Wall",
		blurb: "A low granite wall (static)",
		hotkey: "9",
		idStem: "wall",
		prefabName: "wall",
		prefab: {
			mesh: {
				primitive: "box",
				material: { color: COLORS.granite, roughness: 0.9 },
			},
			body: { type: "static" },
			transform: { scale: [3, 0.6, 0.3] },
		},
	},
	{
		key: "pillar",
		label: "Pillar",
		blurb: "A standing stone (static)",
		hotkey: "0",
		idStem: "pillar",
		prefabName: "pillar",
		prefab: {
			mesh: {
				primitive: "cylinder",
				material: { color: COLORS.granite, roughness: 0.85 },
			},
			body: { type: "static" },
			transform: { scale: [0.6, 1.6, 0.6] },
		},
	},
	{
		key: "rake",
		label: "Rake",
		blurb: "A kinematic arm that sweeps round its own up axis",
		idStem: "rake",
		prefabName: "rake",
		prefab: {
			mesh: {
				primitive: "box",
				material: { color: COLORS.darkCedar, roughness: 0.55 },
			},
			body: { type: "kinematic" },
			transform: { scale: [3, 0.3, 0.3] },
		},
	},
	{
		key: "roller",
		label: "Roller",
		blurb: "A kinematic drum that turns like a conveyor wheel",
		idStem: "roller",
		prefabName: "roller",
		prefab: {
			mesh: {
				primitive: "cylinder",
				material: { color: COLORS.darkCedar, roughness: 0.5 },
			},
			body: { type: "kinematic", friction: 1 },
			transform: { scale: [0.5, 2, 0.5] },
		},
		// Lying down, its axis along z.
		rotation: [S, 0, 0, S],
	},
	{
		key: "goal",
		label: "Bowl",
		blurb: "The goal: a moss bowl the pebble must rest in (static)",
		idStem: "goal",
		prefabName: "bowl",
		prefab: {
			mesh: {
				primitive: "cylinder",
				material: { color: COLORS.moss, roughness: 0.9 },
			},
			body: { type: "static" },
			transform: { scale: [1.6, 0.1, 1.6] },
		},
	},
];

export function pieceByKey(key: string): Piece | undefined {
	return PIECES.find((p) => p.key === key);
}
