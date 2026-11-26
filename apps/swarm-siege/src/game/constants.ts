/** Fixed sim step (60 Hz). */
export const DT = 1 / 60;
/** Agent pool capacity (slots). */
export const MAX_AGENTS = 32768;
export const MAX_TOWERS = 64;
export const MAX_SHELLS = 128;
export const MAX_DEBRIS = 320;
/** VFX events carried per snapshot (counters stay exact; only effects are capped). */
export const MAX_EVENTS = 768;
/** Play area half extent (metres). Build cells cover [-HALF, HALF]. */
export const HALF = 40;
export const CELL = 2;
export const CELLS = (HALF * 2) / CELL; // 40 x 40 build grid
/** Spatial hash for agent queries. */
export const GRID_HALF = 48;
export const GRID_CELL = 2;
export const GRID_N = (GRID_HALF * 2) / GRID_CELL;
/** Path lane half width; agents spread within LANE_SPREAD of the centre line. */
export const LANE_HALF = 2.6;
export const LANE_SPREAD = 2.1;
/** Build cells must keep this far (centre to path centre line). */
export const BUILD_CLEAR = 4.2;
export const CORE_X = 0;
export const CORE_Z = 31;
export const CORE_HP = 200;
export const WAVES = 12;
export const START_GOLD = 260;
/** Build-phase lengths, ticks. */
export const FIRST_BUILD_TICKS = 20 * 60;
export const BUILD_TICKS = 12 * 60;
