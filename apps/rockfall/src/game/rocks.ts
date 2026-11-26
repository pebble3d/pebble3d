import { Rng } from "./rng.ts";

/** Rock kinds, ordered by threat. Ids index `ROCK_KINDS`. */
export const KIND = {
	PEBBLE: 0,
	ROCK: 1,
	SLAB: 2,
	BOULDER: 3,
	METEOR: 4,
} as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export interface RockKind {
	id: Kind;
	name: string;
	/** Mean bounding radius (m) of the variants. */
	radius: number;
	/** Body mass (kg): pebbles scatter under the player, boulders barely budge. */
	mass: number;
	friction: number;
	restitution: number;
	/** Damage on a direct hit. */
	damage: number;
	/** Downward speed (m/s) above which it hurts. */
	lethalSpeed: number;
	/** Number of shape variants (one spawner template each). */
	variants: number;
	/** Hull points per variant. */
	points: number;
	/** Axis squash (x, y, z) applied to the variant shapes. */
	squash: readonly [number, number, number];
	/** Ground telegraph ring tint (sRGB hex). */
	tint: string;
}

export const ROCK_KINDS: readonly RockKind[] = [
	{
		id: KIND.PEBBLE,
		name: "pebble",
		radius: 0.2,
		mass: 2,
		friction: 0.8,
		restitution: 0.15,
		damage: 3,
		lethalSpeed: 7,
		variants: 4,
		points: 8,
		squash: [1, 0.75, 0.9],
		tint: "#d8c8a8",
	},
	{
		id: KIND.ROCK,
		name: "rock",
		radius: 0.46,
		mass: 24,
		friction: 0.85,
		restitution: 0.1,
		damage: 14,
		lethalSpeed: 5,
		variants: 4,
		points: 11,
		squash: [1.05, 0.78, 0.95],
		tint: "#ffb347",
	},
	{
		id: KIND.SLAB,
		name: "slab",
		radius: 0.72,
		mass: 90,
		friction: 0.9,
		restitution: 0.05,
		damage: 20,
		lethalSpeed: 5,
		variants: 2,
		points: 10,
		squash: [1.25, 0.32, 0.85],
		tint: "#ff8a3d",
	},
	{
		id: KIND.BOULDER,
		name: "boulder",
		radius: 1.1,
		mass: 420,
		friction: 0.9,
		restitution: 0.08,
		damage: 32,
		lethalSpeed: 3.5,
		variants: 3,
		points: 14,
		squash: [1.05, 0.88, 1],
		tint: "#ff4b2b",
	},
	{
		id: KIND.METEOR,
		name: "meteor",
		radius: 0.78,
		mass: 300,
		friction: 0.8,
		restitution: 0.05,
		damage: 40,
		lethalSpeed: 3.5,
		variants: 2,
		points: 14,
		squash: [1, 0.95, 1],
		tint: "#ff2a6a",
	},
];

/** Radius of one variant: the kind's mean radius, +-12% by variant. */
export function variantRadius(kind: Kind, variant: number): number {
	const k = ROCK_KINDS[kind] as RockKind;
	const spread = k.variants > 1 ? variant / (k.variants - 1) - 0.5 : 0;
	return k.radius * (1 + spread * 0.24);
}

/**
 * Hull points (flat xyz) of a rock variant: a Fibonacci sphere with seeded radial jitter,
 * squashed per kind. Deterministic, so the physics hull (Rust, convex hull of these points)
 * and the rendered geometry (three's ConvexGeometry of the same points) match exactly.
 */
export function rockPoints(kind: Kind, variant: number): number[] {
	const k = ROCK_KINDS[kind] as RockKind;
	const rng = new Rng(0x5eed + kind * 101 + variant * 7919);
	const r = variantRadius(kind, variant);
	const n = k.points;
	const out: number[] = [];
	// Per-variant anisotropy on top of the kind's squash: no two variants share a silhouette.
	const sx = k.squash[0] * rng.range(0.85, 1.2);
	const sy = k.squash[1] * rng.range(0.8, 1.15);
	const sz = k.squash[2] * rng.range(0.8, 1.1);
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < n; i++) {
		// Jittered Fibonacci directions (even coverage, so the hull never degenerates) with
		// deep radial jitter, so the hull reads as a broken stone rather than a ball.
		const y = 1 - (2 * (i + rng.range(0.2, 0.8))) / n;
		const ring = Math.sqrt(Math.max(0, 1 - y * y));
		const th = golden * i + rng.range(-0.5, 0.5);
		const j = rng.range(0.62, 1.12) * r;
		out.push(
			round4(Math.cos(th) * ring * j * sx),
			round4(y * j * sy),
			round4(Math.sin(th) * ring * j * sz),
		);
	}
	return out;
}

/** Rounded to 1e-4 so the JSON template is compact and exactly reproducible. */
function round4(v: number): number {
	return Math.round(v * 1e4) / 1e4;
}

/** The engine `EntityDesc` template body for a rock variant. */
export function rockBody(kind: Kind, variant: number): Record<string, unknown> {
	const k = ROCK_KINDS[kind] as RockKind;
	return {
		type: "dynamic",
		mass: k.mass,
		friction: k.friction,
		restitution: k.restitution,
		// Damping settles piles fast, so they fall asleep (cheap) between impacts.
		angularDamping: 1.2,
		linearDamping: 0.05,
		ccd: kind >= KIND.BOULDER,
		collider: { shape: "convexHull", points: rockPoints(kind, variant) },
	};
}
