import {
	bodyType,
	ENTITY_DEFAULTS,
	mergePrefab,
	type Scene,
} from "@pebble3d/sdk/schema";
import type { BodyKind } from "./pieces.ts";

/**
 * A scene entity with its prefab merged and the engine defaults applied: what the view
 * draws in edit mode and what the sim spawns. One function for both, so the first frame
 * of Play matches the edit view exactly.
 */
export interface ResolvedEntity {
	id: string;
	index: number;
	prefab: string | undefined;
	primitive: "box" | "sphere" | "capsule" | "plane" | "cylinder" | null;
	/** Set when the mesh is a glTF (drawn as a proxy, not simulated). */
	gltf: string | null;
	position: [number, number, number];
	rotation: [number, number, number, number];
	scale: [number, number, number];
	color: string;
	roughness: number;
	metalness: number;
	emissive: string | undefined;
	castShadow: boolean;
	body: BodyKind | null;
	/** Kept in the file but not simulated by the sandbox (glTF, character, spawner). */
	unsupported: boolean;
	role: "pebble" | "goal" | null;
}

/** Goal-rule roles come from entity ids: `pebble` is the marble, `goal*` the bowl. */
export function roleOf(id: string): ResolvedEntity["role"] {
	if (id === "pebble") return "pebble";
	if (id === "goal" || id.startsWith("goal-")) return "goal";
	return null;
}

export function resolveScene(scene: Scene): ResolvedEntity[] {
	return scene.entities.map((raw, index) => {
		const e = mergePrefab(scene, raw);
		const mat = e.mesh?.material;
		const unsupported =
			e.mesh?.gltf !== undefined ||
			e.character !== undefined ||
			e.spawner !== undefined;
		return {
			id: e.id,
			index,
			prefab: raw.prefab,
			primitive: e.mesh?.primitive ?? null,
			gltf: e.mesh?.gltf?.url ?? null,
			position: [...(e.transform?.position ?? ENTITY_DEFAULTS.position)],
			rotation: [...(e.transform?.rotation ?? ENTITY_DEFAULTS.rotation)],
			scale: [...(e.transform?.scale ?? ENTITY_DEFAULTS.scale)],
			color: mat?.color ?? ENTITY_DEFAULTS.material.color,
			roughness: mat?.roughness ?? ENTITY_DEFAULTS.material.roughness,
			metalness: mat?.metalness ?? ENTITY_DEFAULTS.material.metalness,
			emissive: mat?.emissive,
			castShadow: e.mesh?.castShadow ?? ENTITY_DEFAULTS.castShadow,
			body: e.body ? bodyType(e) : null,
			unsupported,
			role: roleOf(e.id),
		} satisfies ResolvedEntity;
	});
}
