/**
 * 2D (XZ) overlap tests between attack shapes and circular targets. All allocation-free.
 * Facing `(fx, fz)` must be unit length.
 */

/** A circle of radius `radius` around `(px, pz)` against a target circle. */
export function circleHits(
	px: number,
	pz: number,
	radius: number,
	tx: number,
	tz: number,
	tr: number,
): boolean {
	const dx = tx - px;
	const dz = tz - pz;
	const r = radius + tr;
	return dx * dx + dz * dz <= r * r;
}

/**
 * A sector of `radius` and full angle `arc` (radians) centred on the facing. The target
 * counts when its circle reaches the sector: inside the radius and within the half-angle
 * widened by the target's angular size. Targets overlapping the apex always count.
 */
export function arcHits(
	px: number,
	pz: number,
	fx: number,
	fz: number,
	radius: number,
	arc: number,
	tx: number,
	tz: number,
	tr: number,
): boolean {
	const dx = tx - px;
	const dz = tz - pz;
	const d2 = dx * dx + dz * dz;
	const r = radius + tr;
	if (d2 > r * r) return false;
	const d = Math.sqrt(d2);
	if (d <= tr) return true;
	if (arc >= Math.PI * 2) return true;
	const cos = (dx * fx + dz * fz) / d;
	const ang = Math.acos(cos > 1 ? 1 : Math.max(cos, -1));
	const widen = Math.asin(Math.min(tr / d, 1));
	return ang <= arc / 2 + widen;
}

/** A capsule from `(px, pz)` along the facing for `length`, half-width `width`. */
export function lineHits(
	px: number,
	pz: number,
	fx: number,
	fz: number,
	length: number,
	width: number,
	tx: number,
	tz: number,
	tr: number,
): boolean {
	const dx = tx - px;
	const dz = tz - pz;
	let t = dx * fx + dz * fz;
	if (t < 0) t = 0;
	else if (t > length) t = length;
	const cx = dx - fx * t;
	const cz = dz - fz * t;
	const r = width + tr;
	return cx * cx + cz * cz <= r * r;
}
