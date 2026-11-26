import { Vector3 } from "three/webgpu";

export interface TwoBoneResult {
	/** Unit direction shoulder -> elbow. */
	upperDir: Vector3;
	/** Unit direction elbow -> wrist. */
	foreDir: Vector3;
	/** Unit hinge axis, `upperDir x pole-side`; the bend rotates about it. */
	hinge: Vector3;
	/** Elbow position. */
	elbow: Vector3;
}

const _d = new Vector3();
const _n = new Vector3();
const _w = new Vector3();

/**
 * Analytic two-bone IK (law of cosines). From `root` with segment lengths `a` and `b`,
 * reaches toward `target` (clamped to 99.9 % of full extension, and to a minimum fold), the
 * middle joint bending toward `pole` (a world direction; only its component perpendicular to
 * root->target matters, with a fallback when they are parallel). Writes into `out`; does not
 * allocate. The hinge is `d x n` (d = root->target, n = the pole side), so with a bone frame
 * of X = segment and Z = hinge both segments share the hinge axis (Bip01 elbows and knees).
 */
export function solveTwoBone(
	root: Vector3,
	target: Vector3,
	pole: Vector3,
	a: number,
	b: number,
	out: TwoBoneResult,
): TwoBoneResult {
	_d.subVectors(target, root);
	let dist = _d.length();
	if (dist < 1e-6) {
		_d.set(0, -1, 0);
		dist = 1e-6;
	} else _d.multiplyScalar(1 / dist);
	const maxR = (a + b) * 0.999;
	const minR = Math.abs(a - b) + 1e-4;
	dist = Math.min(maxR, Math.max(minR, dist));
	// pole side, perpendicular to d
	_n.copy(pole).addScaledVector(_d, -pole.dot(_d));
	if (_n.lengthSq() < 1e-10) {
		// pole parallel to the reach: any perpendicular will do
		_n.set(0, 1, 0).addScaledVector(_d, -_d.y);
		if (_n.lengthSq() < 1e-10) _n.set(1, 0, 0).addScaledVector(_d, -_d.x);
	}
	_n.normalize();
	const cosA = Math.min(
		1,
		Math.max(-1, (a * a + dist * dist - b * b) / (2 * a * dist)),
	);
	const sinA = Math.sqrt(1 - cosA * cosA);
	out.upperDir.copy(_d).multiplyScalar(cosA).addScaledVector(_n, sinA);
	out.elbow.copy(root).addScaledVector(out.upperDir, a);
	_w.copy(root).addScaledVector(_d, dist);
	out.foreDir.subVectors(_w, out.elbow).normalize();
	out.hinge.crossVectors(_d, _n).normalize();
	return out;
}
