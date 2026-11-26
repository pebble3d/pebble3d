import {
	ARENA_HALF,
	SPAWN_INSET,
	SPAWN_Y_MAX,
	SPAWN_Y_MIN,
	TICKS_PER_SECOND,
	WAVE_TICKS,
} from "./constants.ts";
import type { Rng } from "./rng.ts";
import { KIND, type Kind } from "./rocks.ts";

/** Wave patterns: each becomes one or more engine spawners when its tick comes. */
export const PATTERN = {
	/** Uniform rain over the whole arena. */
	RAIN: 0,
	/** A burst aimed at the player's position when it fires. */
	VOLLEY: 1,
	/** A band of rocks sweeping across the arena. */
	SLIDE: 2,
	/** A ring of rocks around the player (stand still: near-miss bonanza). */
	RING: 3,
	/** Heavy rain over one half of the arena. */
	HALF: 4,
	/** Meteors: molten boulders that detonate on landing. */
	METEORS: 5,
} as const;
export type Pattern = (typeof PATTERN)[keyof typeof PATTERN];

export const PATTERN_CALLOUTS: Record<number, string> = {
	[PATTERN.RAIN]: "",
	[PATTERN.VOLLEY]: "Targeted",
	[PATTERN.SLIDE]: "Rockslide",
	[PATTERN.RING]: "Encircled",
	[PATTERN.HALF]: "Cave-in",
	[PATTERN.METEORS]: "Meteor shower",
};

/** One scheduled pattern of a wave. Rates are spawns per second, totals over `ticks`. */
export interface WaveOrder {
	/** Tick offset into the wave. */
	at: number;
	pattern: Pattern;
	kind: Kind;
	/** Spawns per second across all of the order's spawners. */
	rate: number;
	/** Total spawns. */
	count: number;
	/** Sweep axis (0 = X, 1 = Z) and direction for SLIDE; half index for HALF. */
	param: number;
}

export const WAVE_NAMES = [
	"Gravel Shower",
	"First Stones",
	"Loose Ridge",
	"Shifting Ground",
	"Boulder Season",
	"Falling Sky",
	"Avalanche",
	"Starfall",
	"The Mountain Breaks",
];

export function waveName(n: number): string {
	return WAVE_NAMES[Math.min(n, WAVE_NAMES.length) - 1] ?? `Wave ${n}`;
}

/** Background rain for wave `n` (1-based) as [kind, rate per second]. */
export function rainRates(n: number): [Kind, number][] {
	const out: [Kind, number][] = [
		[KIND.PEBBLE, Math.min(4 + 2.4 * (n - 1), 28)],
		[KIND.ROCK, Math.min(0.9 + 0.6 * (n - 1), 7.5)],
	];
	if (n >= 2) out.push([KIND.BOULDER, Math.min(0.18 + 0.13 * (n - 2), 1.4)]);
	if (n >= 3) out.push([KIND.SLAB, Math.min(0.35 + 0.18 * (n - 3), 1.6)]);
	return out;
}

/**
 * The wave plan: background rain in 2.5 s chunks (each chunk is its own spawner with its
 * own seed) plus `1 + n/2` special patterns spread through the wave. Deterministic for
 * `(n, rng state)`. The result is sorted by `at`.
 */
export function planWave(n: number, rng: Rng): WaveOrder[] {
	const out: WaveOrder[] = [];
	const chunk = Math.round(2.5 * TICKS_PER_SECOND);
	for (let at = 0; at < WAVE_TICKS - chunk / 2; at += chunk) {
		for (const [kind, rate] of rainRates(n)) {
			const count = Math.round((rate * chunk) / TICKS_PER_SECOND);
			if (count > 0)
				out.push({ at, pattern: PATTERN.RAIN, kind, rate, count, param: 0 });
		}
	}
	const unlocked: Pattern[] = [PATTERN.VOLLEY];
	if (n >= 2) unlocked.push(PATTERN.SLIDE, PATTERN.HALF);
	if (n >= 3) unlocked.push(PATTERN.RING);
	if (n >= 4) unlocked.push(PATTERN.METEORS);
	const specials = Math.min(1 + Math.floor(n / 2), 6);
	const span = WAVE_TICKS - 300;
	for (let i = 0; i < specials; i++) {
		const at = 150 + Math.floor(((i + rng.range(0.1, 0.9)) / specials) * span);
		// The newest unlock is favoured so each wave shows off its new trick.
		const pick =
			i === 0 && n > 1
				? (unlocked[unlocked.length - 1] as Pattern)
				: (unlocked[rng.int(unlocked.length)] as Pattern);
		out.push(special(pick, n, at, rng));
	}
	// Hunter volleys: from wave 2 a small burst aimed at the player every few seconds, so
	// standing still is never safe.
	if (n >= 2) {
		const every = Math.max(200, 520 - 45 * n);
		for (let at = 260 + rng.int(120); at < WAVE_TICKS - 120; at += every)
			out.push({
				at,
				pattern: PATTERN.VOLLEY,
				kind: n >= 5 && rng.next() < 0.4 ? KIND.BOULDER : KIND.ROCK,
				rate: 6,
				count: 2 + Math.floor(n / 4),
				param: 1,
			});
	}
	out.sort((a, b) => a.at - b.at);
	return out;
}

function special(p: Pattern, n: number, at: number, rng: Rng): WaveOrder {
	switch (p) {
		case PATTERN.VOLLEY:
			return {
				at,
				pattern: p,
				kind: n >= 3 ? KIND.BOULDER : KIND.ROCK,
				rate: 5,
				count: 3 + Math.floor(n / 3),
				param: 0,
			};
		case PATTERN.SLIDE:
			return {
				at,
				pattern: p,
				kind: KIND.ROCK,
				rate: 30,
				count: 54 + 6 * n,
				param: rng.int(4),
			};
		case PATTERN.RING:
			return {
				at,
				pattern: p,
				kind: KIND.ROCK,
				rate: 40,
				count: 10 + Math.min(n, 6),
				param: 0,
			};
		case PATTERN.HALF:
			return {
				at,
				pattern: p,
				kind: KIND.PEBBLE,
				rate: 60,
				count: 150 + 15 * n,
				param: rng.int(4),
			};
		default:
			return {
				at,
				pattern: PATTERN.METEORS,
				kind: KIND.METEOR,
				rate: 2.5,
				count: 3 + Math.floor(n / 2),
				param: 0,
			};
	}
}

/** The arena-wide spawn box. */
export const ARENA_BOX = {
	min: [
		-ARENA_HALF + SPAWN_INSET,
		SPAWN_Y_MIN,
		-ARENA_HALF + SPAWN_INSET,
	] as const,
	max: [
		ARENA_HALF - SPAWN_INSET,
		SPAWN_Y_MAX,
		ARENA_HALF - SPAWN_INSET,
	] as const,
};
