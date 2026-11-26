/** Tower types. */
export const TOWER = { SPARK: 0, MORTAR: 1, FROST: 2, LANCE: 3 } as const;
export const TOWER_TYPES = 4;
export const MAX_LEVEL = 3;

export interface TowerDef {
	readonly name: string;
	readonly blurb: string;
	readonly cost: number;
	/** Per level (index 0..2). */
	readonly range: readonly number[];
	readonly damage: readonly number[];
	/** Ticks between shots / pulses. */
	readonly period: readonly number[];
	/** Mortar splash radius, Frost slow factor, Lance beam half width. */
	readonly extra: readonly number[];
	/** Upgrade price to level 2 and 3. */
	readonly upgrade: readonly number[];
}

export const TOWERS: readonly TowerDef[] = [
	{
		name: "Spark",
		blurb: "Rapid arc bolts, first in line",
		cost: 60,
		range: [7, 8, 9],
		damage: [7, 12, 20],
		period: [10, 9, 8],
		extra: [0, 0, 0],
		upgrade: [50, 90],
	},
	{
		name: "Mortar",
		blurb: "Lobbed shells, wide splash",
		cost: 100,
		range: [12, 13, 14],
		damage: [26, 46, 78],
		period: [96, 86, 76],
		extra: [2.3, 2.7, 3.1],
		upgrade: [80, 140],
	},
	{
		name: "Frost",
		blurb: "Chill field, slows everything",
		cost: 80,
		range: [5, 5.8, 6.6],
		damage: [3, 5, 8],
		period: [30, 30, 30],
		extra: [0.55, 0.45, 0.35],
		upgrade: [60, 110],
	},
	{
		name: "Lance",
		blurb: "Piercing beam through the column",
		cost: 150,
		range: [13, 14, 15],
		damage: [40, 70, 115],
		period: [130, 120, 108],
		extra: [0.9, 1.0, 1.1],
		upgrade: [120, 200],
	},
];

/** Mortar shell flight time, ticks. */
export const SHELL_TICKS = 45;
/** Frost slow lasts this long after a pulse, ticks. */
export const SLOW_TICKS = 40;

/** Enemy kinds. */
export const KIND = { MITE: 0, GLIDER: 1, BRUTE: 2 } as const;
export const KINDS = 3;

export interface KindDef {
	readonly name: string;
	readonly hp: number;
	readonly speed: number;
	readonly gold: number;
	readonly damage: number;
	readonly radius: number;
}

export const KIND_DEFS: readonly KindDef[] = [
	{ name: "Mite", hp: 9, speed: 4.0, gold: 0.4, damage: 1, radius: 0.28 },
	{ name: "Glider", hp: 48, speed: 2.9, gold: 3, damage: 3, radius: 0.5 },
	{ name: "Brute", hp: 440, speed: 1.9, gold: 25, damage: 15, radius: 0.95 },
];

/** Enemy hit points scale with the wave. */
export function hpScale(wave: number): number {
	return 1 + 0.35 * (wave - 1) + 0.04 * (wave - 1) * (wave - 1);
}

export function sellValue(invested: number): number {
	return Math.floor(invested * 0.7);
}
