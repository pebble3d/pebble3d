// biome-ignore-all format: Shared Contracts block, kept verbatim from the M1 plan.
import type {
	RenderEntity,
	RenderSettings,
	RenderStats,
} from "@pebble3d/renderer/types";

export type { RenderEntity, RenderSettings, RenderStats };

// Shared Contracts (sdk side). Do not change these shapes.
export interface SimEntry { sceneId: string; desc: EntityDescJson }   // EntityDescJson = Task 2 JSON shape
export interface ExpandedScene { settings: RenderSettings; sim: SimEntry[]; render: RenderEntity[]; pendingHulls: string[] /* sceneIds */ }
export interface GameStats extends RenderStats { physicsMs: number; activeBodies: number; sleepingBodies: number; build: 'deterministic'|'fast'; tick: number; errors: string[] }

// engine-core `EntityDesc` JSON (serde camelCase), as accepted by `World.spawn`.
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type ColliderJson =
	| { shape: "box"; halfExtents: Vec3 }
	| { shape: "sphere"; radius: number }
	| { shape: "capsule"; halfHeight: number; radius: number }
	/** Flat xyz triples. Empty while the sceneId is listed in `ExpandedScene.pendingHulls`. */
	| { shape: "convexHull"; points: number[] }
	/** `fixInternalEdges`: smooth contacts across triangle seams (rolling balls). */
	| {
			shape: "trimesh";
			vertices: number[];
			indices: number[];
			fixInternalEdges?: boolean;
	  }
	| { shape: "plane" };

export interface BodyJson {
	type: "dynamic" | "static" | "kinematic";
	mass?: number;
	friction: number;
	restitution: number;
	linearDamping: number;
	angularDamping: number;
	ccd: boolean;
	collider: ColliderJson;
}

export interface CharacterJson {
	speed: number;
	sprintSpeed: number;
	jumpSpeed: number;
	maxSlopeDeg: number;
	stepHeight: number;
	snap: number;
	/** Horizontal acceleration, m/s²; 0 = instant. */
	accel: number;
	/** Move with a supporting kinematic body; omitted (false) by default. */
	ridePlatforms?: boolean;
}

export interface SpawnerJson {
	/** Body template; its `position` is ignored (spawns land uniformly in the area). */
	template: EntityDescJson;
	/** Spawns per second. */
	rate: number;
	count: number;
	areaMin: Vec3;
	areaMax: Vec3;
	seed: number;
}

export interface EntityDescJson {
	name?: string;
	position: Vec3;
	rotation: Quat;
	body?: BodyJson | null;
	character?: CharacterJson | null;
	spawner?: SpawnerJson | null;
}
