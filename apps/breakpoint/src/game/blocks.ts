/** Block kinds: every structure is built from these few box shapes (one InstancedMesh each). */
export const KIND = {
	BRICK: 0,
	HALF: 1,
	SLAB: 2,
	BEAM: 3,
	DRUM: 4,
	CAP: 5,
} as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export interface KindDef {
	name: string;
	/** Collider half extents, metres. */
	half: [number, number, number];
	/** kg / m³ (stone ~2000; the solver likes moderate mass ratios). */
	density: number;
	friction: number;
}

export const KINDS: readonly KindDef[] = [
	{ name: "brick", half: [0.45, 0.225, 0.225], density: 1900, friction: 0.75 },
	{ name: "half", half: [0.225, 0.225, 0.225], density: 1900, friction: 0.75 },
	{ name: "slab", half: [0.9, 0.12, 0.45], density: 2100, friction: 0.8 },
	{ name: "beam", half: [1.35, 0.2, 0.225], density: 1700, friction: 0.7 },
	{ name: "drum", half: [0.32, 0.35, 0.32], density: 2200, friction: 0.8 },
	{ name: "cap", half: [0.55, 0.14, 0.55], density: 2100, friction: 0.8 },
];

export function kindMass(k: Kind): number {
	const d = KINDS[k] as KindDef;
	return d.density * 8 * d.half[0] * d.half[1] * d.half[2];
}

/** Stone palettes; a structure picks one and each block jitters within it. */
export const STONES = {
	sandstone: 0,
	limestone: 1,
	slate: 2,
	terracotta: 3,
} as const;
export type Stone = (typeof STONES)[keyof typeof STONES];

/** One block of a structure, in its rest pose. */
export interface BlockSpec {
	kind: Kind;
	x: number;
	y: number;
	z: number;
	/** Rotation about +Y, radians. */
	yaw: number;
	stone: Stone;
	/** 0..1 per-block colour jitter (seeded). */
	tint: number;
}
