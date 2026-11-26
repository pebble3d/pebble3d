export interface MoveKeys {
	f: boolean;
	b: boolean;
	l: boolean;
	r: boolean;
}

/**
 * Turns WASD-style keys into a normalised world-space XZ move direction relative to the
 * camera yaw (radians about +Y; yaw 0 looks down -Z). Writes `out[0] = x`, `out[1] = z`.
 * Opposing keys cancel; no input writes `[0, 0]`. Allocation-free.
 */
export function cameraRelativeInput(
	keys: MoveKeys,
	yaw: number,
	out: Float32Array,
): void {
	const fwd = (keys.f ? 1 : 0) - (keys.b ? 1 : 0);
	const right = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
	if (fwd === 0 && right === 0) {
		out[0] = 0;
		out[1] = 0;
		return;
	}
	const s = Math.sin(yaw);
	const c = Math.cos(yaw);
	// forward = (-sin, -cos), right = (cos, -sin)
	const x = -s * fwd + c * right;
	const z = -c * fwd - s * right;
	const inv = 1 / Math.hypot(x, z);
	out[0] = x * inv;
	out[1] = z * inv;
}
