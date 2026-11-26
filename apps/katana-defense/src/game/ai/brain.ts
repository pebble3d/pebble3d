/** Pure zombie decision helpers (unit-tested; the sim calls them every frame). */

export const TARGET_OBJECTIVE = 0;
export const TARGET_PLAYER = 1;
/** A zombie already chasing the player lets go beyond this multiple of its aggro radius. */
export const AGGRO_HYSTERESIS = 1.6;

/**
 * Objective by default; the player when they come within `aggro` metres, kept until they
 * are beyond `aggro * AGGRO_HYSTERESIS`. A dead player is never targeted. A zombie whose
 * path is closer to the objective than `commit` metres stays on the objective.
 */
export function chooseTarget(
	current: number,
	distPlayer: number,
	aggro: number,
	playerAlive: boolean,
	distObjective: number,
	commit: number,
): number {
	if (!playerAlive) return TARGET_OBJECTIVE;
	if (current === TARGET_PLAYER)
		return distPlayer <= aggro * AGGRO_HYSTERESIS
			? TARGET_PLAYER
			: TARGET_OBJECTIVE;
	if (distObjective < commit && distPlayer > aggro * 0.5)
		return TARGET_OBJECTIVE;
	return distPlayer <= aggro ? TARGET_PLAYER : TARGET_OBJECTIVE;
}

/** Start a telegraphed attack when the target's edge is within reach and off cooldown. */
export function shouldAttack(
	edgeDist: number,
	reach: number,
	cooldown: number,
): boolean {
	return cooldown <= 0 && edgeDist <= reach;
}

/**
 * Whether a strike lands on a circle target: within `reach` of the attacker's edge and
 * inside the strike arc (a full-circle slam ignores facing).
 */
export function strikeConnects(
	ax: number,
	az: number,
	aRadius: number,
	heading: number,
	arc: number,
	reach: number,
	tx: number,
	tz: number,
	tRadius: number,
): boolean {
	const dx = tx - ax;
	const dz = tz - az;
	const d = Math.hypot(dx, dz);
	if (d - aRadius - tRadius > reach) return false;
	if (arc >= Math.PI * 2 - 1e-6 || d < 1e-6) return true;
	const fx = Math.sin(heading);
	const fz = Math.cos(heading);
	const cos = (dx * fx + dz * fz) / d;
	const ang = Math.acos(cos > 1 ? 1 : Math.max(cos, -1));
	return ang <= arc / 2 + Math.asin(Math.min(1, tRadius / d));
}

/** Turns `from` toward `to` (radians) by at most `maxStep`, the short way round. */
export function turnToward(from: number, to: number, maxStep: number): number {
	let d = to - from;
	while (d > Math.PI) d -= Math.PI * 2;
	while (d < -Math.PI) d += Math.PI * 2;
	if (d > maxStep) d = maxStep;
	else if (d < -maxStep) d = -maxStep;
	return from + d;
}
