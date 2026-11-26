/** Fixed sim tick (s). */
export const DT = 1 / 60;
/** Settling cap at level load (ticks). */
export const SETTLE_MAX_TICKS = 360;
/** The iron ball. */
export const BALL = { radius: 0.65, mass: 5200 } as const;
/** Launch speed range (m/s) from zero to full charge. */
export const SPEED_MIN = 24;
export const SPEED_MAX = 58;
/** A shot lasts at least this long (ticks) and at most SHOT_MAX_TICKS. */
export const SHOT_MIN_TICKS = 150;
export const SHOT_MAX_TICKS = 600;
/** The shot ends once at most this many blocks are still awake. */
export const SHOT_SETTLED_AWAKE = 6;
export const GRAVITY = 9.81;
