/** Fixed sim tick (s). The engine steps at 60 Hz. */
export const DT = 1 / 60;
export const TICKS_PER_SECOND = 60;

/** Arena interior is [-ARENA_HALF, ARENA_HALF] on X and Z. */
export const ARENA_HALF = 15;
export const WALL_THICK = 0.8;
export const WALL_HEIGHT = 3.6;
/** Stone pillars (cover from rolling boulders): centre XZ and half size. */
export const PILLARS: readonly (readonly [number, number])[] = [
	[-7.5, -7.5],
	[7.5, -7.5],
	[-7.5, 7.5],
	[7.5, 7.5],
];
export const PILLAR_HALF = 0.85;
export const PILLAR_HEIGHT = 3.2;

/** Rocks spawn in this height band above the arena (about 2.3 s of fall: the telegraph). */
export const SPAWN_Y_MIN = 24;
export const SPAWN_Y_MAX = 30;
/** Spawn XZ inset from the walls. */
export const SPAWN_INSET = 0.8;

/** Player capsule (KCC): half height of the cylinder part and radius. */
export const PLAYER_HALF_HEIGHT = 0.55;
export const PLAYER_RADIUS = 0.38;
export const PLAYER_CENTER_Y = PLAYER_HALF_HEIGHT + PLAYER_RADIUS + 0.02;
export const PLAYER_SPEED = 5.2;
export const PLAYER_SPRINT = 8.4;
export const PLAYER_JUMP = 6.2;
/** Mass the KCC pushes rubble with (kg). */
export const PLAYER_MASS = 110;
export const MAX_HP = 100;
/** Sprint stamina, seconds of sprint. */
export const STAMINA_MAX = 2.6;
export const STAMINA_REGEN = 0.8;
/** Ticks of invulnerability after a heavy hit. */
export const INVULN_TICKS = 50;
/** Knockback after a hit: ticks of forced movement. */
export const KNOCK_TICKS = 14;

/**
 * Live rock cap per engine build: past it the oldest rocks crumble away. Sized from
 * `bench/bodies.ts` so a late wave stays near 4-5 ms of sim per tick (the deterministic
 * build's enhanced-determinism math is the slower one).
 */
export const MAX_ROCKS = 1400;
export const MAX_ROCKS_FAST = 1800;
/** Hard capacity of the rock table (cap plus one tick of spawns). */
export const ROCK_CAPACITY = 4096;
/** At most this many rocks crumble per tick (spreads the cost and the dust). */
export const CRUMBLE_PER_TICK = 6;

export const WAVE_TICKS = 1500;
export const BREATHER_TICKS = 210;
/** Title -> first wave countdown (ticks) after START. */
export const COUNTDOWN_TICKS = 150;

export const NEAR_MISS_RANGE = 1.6;
export const NEAR_MISS_POINTS = 50;
export const MULT_STEP = 0.1;
export const MULT_MAX = 4;
export const POINTS_PER_SECOND = 10;

export const MAX_EVENTS = 256;
export const MAX_PICKUPS = 8;
export const PICKUP_RADIUS = 1.0;
