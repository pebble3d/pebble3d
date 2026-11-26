/** Arena geometry for gameplay collision (XZ): a bounds rectangle and box obstacles. */

export interface ArenaBox {
	x: number;
	z: number;
	hx: number;
	hz: number;
	h: number;
}

export interface ArenaDef {
	bounds: { min: [number, number]; max: [number, number] };
	objective: { x: number; z: number; radius: number; hp: number; name: string };
	playerStart: [number, number];
	spawns: { x: number; z: number; weight: number }[];
	obstacles: ArenaBox[];
}

/** Collision result scratch: the corrected position. */
export interface Pos2 {
	x: number;
	z: number;
}

/**
 * Pushes a circle of radius `r` at `p` out of the obstacles and back inside the bounds
 * (and out of the objective circle when `objR > 0`). Mutates `p`. Allocation-free.
 */
export function collideArena(
	arena: ArenaDef,
	p: Pos2,
	r: number,
	objR: number,
): void {
	const obs = arena.obstacles;
	for (let i = 0; i < obs.length; i++) {
		const b = obs[i] as ArenaBox;
		const dx = p.x - b.x;
		const dz = p.z - b.z;
		const cx = dx < -b.hx ? -b.hx : Math.min(dx, b.hx);
		const cz = dz < -b.hz ? -b.hz : Math.min(dz, b.hz);
		const ox = dx - cx;
		const oz = dz - cz;
		const d2 = ox * ox + oz * oz;
		if (d2 >= r * r) continue;
		if (d2 > 1e-10) {
			const d = Math.sqrt(d2);
			p.x += (ox / d) * (r - d);
			p.z += (oz / d) * (r - d);
		} else {
			// centre inside the box: leave by the nearest face
			const px = b.hx - Math.abs(dx);
			const pz = b.hz - Math.abs(dz);
			if (px < pz) p.x = b.x + Math.sign(dx || 1) * (b.hx + r);
			else p.z = b.z + Math.sign(dz || 1) * (b.hz + r);
		}
	}
	if (objR > 0) {
		const o = arena.objective;
		const dx = p.x - o.x;
		const dz = p.z - o.z;
		const rr = objR + r;
		const d2 = dx * dx + dz * dz;
		if (d2 < rr * rr) {
			const d = Math.sqrt(d2) || 1e-6;
			p.x = o.x + (dx / d) * rr;
			p.z = o.z + (dz / d) * rr;
		}
	}
	const { min, max } = arena.bounds;
	if (p.x < min[0] + r) p.x = min[0] + r;
	else if (p.x > max[0] - r) p.x = max[0] - r;
	if (p.z < min[1] + r) p.z = min[1] + r;
	else if (p.z > max[1] - r) p.z = max[1] - r;
}
