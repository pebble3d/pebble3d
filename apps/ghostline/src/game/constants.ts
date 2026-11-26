/** Fixed sim tick, seconds (the engine steps at 60 Hz). */
export const DT = 1 / 60;
export const TICK_HZ = 60;
/** Marble radius, metres. */
export const MARBLE_RADIUS = 0.5;
export const MARBLE_MASS = 1;
/** Ticks of the 3-2-1 countdown before the clock starts (world frozen). */
export const COUNTDOWN_TICKS = 150;
/** Centerline sample spacing, metres. */
export const TRACK_DS = 0.5;
/** Ticks the marble stays frozen at a checkpoint after a fall before it rolls again. */
export const RESPAWN_FREEZE = 45;
/** After the finish line the run keeps simulating this long (coast-down), then ends. */
export const FINISH_COAST_TICKS = 150;
/** Hard cap on a run (5 minutes): the clock stops and the run is a DNF. */
export const MAX_RUN_TICKS = 60 * 60 * 5;
