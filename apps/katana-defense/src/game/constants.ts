/** Game tick rate. The sim always advances in whole ticks of `DT` seconds. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
/** Input buffer: a press stays usable this many sim frames (150 ms). */
export const BUFFER_FRAMES = 9;
/** After a move ends, its follow-up routes stay open this many frames. */
export const LINGER_FRAMES = 10;
/** Frames E must be held at full Focus to trigger Spin Storm. */
export const FOCUS_HOLD_FRAMES = 12;
export const FOCUS_MAX = 100;
export const GRAVITY = 24;
export const PLAYER_RADIUS = 0.35;
export const PLAYER_HEIGHT = 1.7;
export const WALK_SPEED = 4.6;
export const SPRINT_SPEED = 7.2;
export const JUMP_SPEED = 8;
/** Exponential approach rate (1/s) of the player's velocity to the stick target. */
export const PLAYER_ACCEL = 16;
export const PLAYER_TURN_RATE = 16;
export const PLAYER_MAX_HP = 100;
/** Invulnerability after taking a hit, frames. */
export const HURT_IFRAMES = 40;
/** Combo counter resets after this many frames without a hit. */
export const COMBO_TIMEOUT = 150;
/** Max zombies alive at once (pool capacity). */
export const MAX_ZOMBIES = 48;
/** Event queue capacity (per drain). */
export const MAX_EVENTS = 256;
/** Aim assist: at move start, snap facing to the nearest zombie within this range... */
export const ASSIST_RANGE = 4.2;
/** ...and within this half-angle (radians) of the stick/facing direction. */
export const ASSIST_HALF_ANGLE = 1.1;
