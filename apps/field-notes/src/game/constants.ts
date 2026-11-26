/** Fixed sim tick, seconds (60 Hz). */
export const DT = 1 / 60;
export const TICKS_PER_SECOND = 60;
/** Frames on the roll. */
export const FILM = 12;
/** Daylight for one survey, ticks (5 minutes). */
export const DAY_TICKS = 5 * 60 * TICKS_PER_SECOND;
/** An anomaly materialises when the player comes this close (horizontal metres). */
export const REVEAL_RADIUS = 4.2;
/** The signal meter starts picking an anomaly up at this distance. */
export const SIGNAL_RADIUS = 13;
/** Capsule centre to eye height, metres (capsule centre sits 0.8 m above the floor). */
export const EYE_ABOVE_CENTER = 0.72;
/** The photo camera sits this far ahead of the capsule centre (in front of the face). */
export const EYE_FORWARD = 0.22;
/** Photo camera limits. */
export const FOV_MIN = 16;
export const FOV_MAX = 72;
export const FOV_DEFAULT = 50;
export const PITCH_MIN = -1.1;
export const PITCH_MAX = 0.9;
export const FOCUS_MIN = 0.4;
export const FOCUS_MAX = 40;
export const EV_MIN = -2;
export const EV_MAX = 2;
/** Exposure steps are a third of a stop. */
export const EV_STEP = 1 / 3;
/** Ticks between shutter releases (film advance). */
export const SHUTTER_COOLDOWN = 36;
/** Ticks the developed print stays on screen. */
export const DEVELOP_TICKS = 170;
/** Ticks between the last documented anomaly (or last frame) and the results. */
export const WRAP_TICKS = 150;
/** Star thresholds on a photo's 0..100 score. */
export const STAR_1 = 40;
export const STAR_2 = 65;
export const STAR_3 = 85;
/** Score bonus for each documented anomaly, and per remaining second when all six are in. */
export const DOCUMENT_BONUS = 50;
export const TIME_BONUS_PER_SECOND = 1;
/** The frame's aspect ratio for scoring (the viewfinder shows the same 16:9 frame). */
export const FRAME_ASPECT = 16 / 9;
