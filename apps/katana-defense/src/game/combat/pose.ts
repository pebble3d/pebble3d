/** Pose channels: armYaw, armPitch, bladeYaw, bladePitch, reach, grip. */
export const POSE_CHANNELS = 6;
/** Default hand reach from the chest pivot, metres. */
export const DEFAULT_REACH = 0.42;

/**
 * Sword pose keys: `[frame, armYaw, armPitch, bladeYaw, bladePitch, reach?, grip?]`.
 * Angles are degrees in character space: arm = direction from the chest pivot to the sword
 * hand, blade = the blade's direction. `reach` is the hand's distance from the pivot in
 * metres (default 0.42) and `grip` the left hand's weight on the hilt (1 = two-handed,
 * 0 = one-handed; default 1). `samplePose` writes the six channels at a fractional frame into
 * `out`, easing between keys with smoothstep; `from` (when given) replaces the first key so
 * a move starts from wherever the sword was. Allocation-free.
 */
export function samplePose(
	keys: number[][],
	frame: number,
	out: Float32Array,
	from: Float32Array | null,
): void {
	const n = keys.length;
	const first = keys[0] as number[];
	if (n === 1 || frame <= (first[0] as number)) {
		writeKey(first, from, out);
		return;
	}
	for (let i = 0; i < n - 1; i++) {
		const a = keys[i] as number[];
		const b = keys[i + 1] as number[];
		const fa = a[0] as number;
		const fb = b[0] as number;
		if (frame > fb) continue;
		let t = (frame - fa) / (fb - fa || 1);
		t = t * t * (3 - 2 * t);
		for (let k = 0; k < POSE_CHANNELS; k++) {
			const va = i === 0 && from ? (from[k] as number) : channel(a, k);
			out[k] = va + (channel(b, k) - va) * t;
		}
		return;
	}
	writeKey(keys[n - 1] as number[], null, out);
}

/** Channel `c` of a key (or of `rest`, which has no frame), with the reach/grip defaults. */
export function channel(key: number[], c: number, offset = 1): number {
	const v = key[c + offset];
	if (v !== undefined) return v;
	return c === 4 ? DEFAULT_REACH : c === 5 ? 1 : 0;
}

function writeKey(
	k: number[],
	from: Float32Array | null,
	out: Float32Array,
): void {
	for (let i = 0; i < POSE_CHANNELS; i++)
		out[i] = from ? (from[i] as number) : channel(k, i);
}

/**
 * Character-space unit direction for a (yaw, pitch) in degrees: yaw + turns toward the
 * character's right (-X when it faces +Z), pitch + is up. Writes `[x, y, z]` into `out`.
 */
export function poseDir(
	yawDeg: number,
	pitchDeg: number,
	out: { x: number; y: number; z: number },
): void {
	const y = (yawDeg * Math.PI) / 180;
	const p = (pitchDeg * Math.PI) / 180;
	const c = Math.cos(p);
	out.x = -Math.sin(y) * c;
	out.y = Math.sin(p);
	out.z = Math.cos(y) * c;
}
