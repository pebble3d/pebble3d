import type { AnimState, CharacterFrame } from "../types.ts";

/** Below this XZ speed (m/s) the character is idle and keeps its facing. */
export const IDLE_SPEED = 0.1;
/** Walk/run boundary as a fraction of `sprintSpeed`. */
export const RUN_FRACTION = 0.75;

/**
 * Animation state from the character's sim state. Airborne: rising -> jump, else fall.
 * Grounded: XZ speed < 0.1 -> idle, < 0.75 * sprintSpeed -> walk, otherwise run.
 */
export function pickAnimState(f: CharacterFrame): AnimState {
	if (!f.grounded) return f.vy > 0 ? "jump" : "fall";
	const speed = Math.hypot(f.vx, f.vz);
	if (speed < IDLE_SPEED) return "idle";
	if (speed < RUN_FRACTION * f.sprintSpeed) return "walk";
	return "run";
}

/** Playback-rate clamp for speed-matched locomotion. */
const TIME_SCALE_MIN = 0.6;
const TIME_SCALE_MAX = 1.6;

/**
 * Playback rate that matches a clip's authored ground speed to the sim's:
 * `clamp(speed / authoredSpeed, 0.6, 1.6)`, or 1 when the clip has no authored speed.
 */
export function locomotionTimeScale(
	speed: number,
	authoredSpeed: number | undefined,
): number {
	if (authoredSpeed === undefined) return 1;
	return Math.min(
		TIME_SCALE_MAX,
		Math.max(TIME_SCALE_MIN, speed / authoredSpeed),
	);
}
