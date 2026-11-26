import { FRAME_ASPECT, STAR_1, STAR_2, STAR_3 } from "./constants.ts";

/**
 * Photo camera pose and settings. Yaw uses the engine's third-person convention (yaw 0 looks
 * down -Z); negative pitch looks down. `focus` is metres along the look direction.
 */
export interface PhotoCam {
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
	fovDeg: number;
	focus: number;
	ev: number;
}

export interface Subject {
	x: number;
	y: number;
	z: number;
	r: number;
	idealEv: number;
}

/** Where a point lands in the frame: u right, v down, both 0..1 inside; depth along look. */
export interface Projection {
	u: number;
	v: number;
	depth: number;
}

export interface PhotoScore {
	/** In frame at all (centre inside the frame, in front of the camera). */
	inFrame: boolean;
	composition: number;
	fill: number;
	focus: number;
	exposure: number;
	/** 1, or the crop penalty when the subject spills out of the frame. */
	crop: number;
	occluded: boolean;
	/** 0..100. */
	total: number;
	stars: number;
}

export function emptyScore(): PhotoScore {
	return {
		inFrame: false,
		composition: 0,
		fill: 0,
		focus: 0,
		exposure: 0,
		crop: 1,
		occluded: false,
		total: 0,
		stars: 0,
	};
}

const DEG = Math.PI / 180;

function smoothstep(a: number, b: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

/** Projects a world point through the photo camera. Returns false behind the camera. */
export function project(
	cam: PhotoCam,
	px: number,
	py: number,
	pz: number,
	out: Projection,
): boolean {
	const sy = Math.sin(cam.yaw);
	const cy = Math.cos(cam.yaw);
	const sp = Math.sin(cam.pitch);
	const cp = Math.cos(cam.pitch);
	// forward f = (-sy cp, sp, -cy cp), right r = (cy, 0, -sy), up = r x f
	const fx = -sy * cp;
	const fy = sp;
	const fz = -cy * cp;
	const rx = cy;
	const rz = -sy;
	// up = r x f, with r.y = 0
	const upx = -rz * fy;
	const upy = rz * fx - rx * fz;
	const upz = rx * fy;
	const dx = px - cam.x;
	const dy = py - cam.y;
	const dz = pz - cam.z;
	const depth = dx * fx + dy * fy + dz * fz;
	out.depth = depth;
	if (depth <= 1e-3) {
		out.u = -1;
		out.v = -1;
		return false;
	}
	const x = dx * rx + dz * rz;
	const y = dx * upx + dy * upy + dz * upz;
	const tanH = Math.tan((cam.fovDeg * DEG) / 2);
	const ndcX = x / (depth * tanH * FRAME_ASPECT);
	const ndcY = y / (depth * tanH);
	out.u = (ndcX + 1) / 2;
	out.v = (1 - ndcY) / 2;
	return true;
}

/** The look direction of a photo camera (unit vector) into `out[0..2]`. */
export function lookDir(cam: PhotoCam, out: Float64Array | number[]): void {
	const cp = Math.cos(cam.pitch);
	out[0] = -Math.sin(cam.yaw) * cp;
	out[1] = Math.sin(cam.pitch);
	out[2] = -Math.cos(cam.yaw) * cp;
}

/** Thirds power points, frame units. */
const THIRDS = [1 / 3, 2 / 3] as const;

/** Composition: the subject on a rule-of-thirds power point, or (for less) dead centre. */
export function compositionScore(u: number, v: number): number {
	let best = Number.POSITIVE_INFINITY;
	for (const pu of THIRDS)
		for (const pv of THIRDS) {
			const d = Math.hypot((u - pu) * FRAME_ASPECT, v - pv);
			if (d < best) best = d;
		}
	const thirds = 1 - smoothstep(0.05, 0.32, best);
	const dc = Math.hypot((u - 0.5) * FRAME_ASPECT, v - 0.5);
	const centre = 0.5 * (1 - smoothstep(0.04, 0.26, dc));
	return Math.max(thirds, centre);
}

/** Fill: the subject's diameter as a fraction of the frame height; best between 22% and 55%. */
export function fillScore(fill: number): number {
	if (fill < 0.22) return smoothstep(0.04, 0.22, fill);
	if (fill <= 0.55) return 1;
	return 1 - smoothstep(0.55, 1.05, fill);
}

/** Focus tolerance (metres) at a subject depth: deeper subjects forgive more. */
export function focusTolerance(depth: number): number {
	return 0.08 * depth + 0.1;
}

export function focusScore(focus: number, depth: number): number {
	const tol = focusTolerance(depth);
	return 1 - smoothstep(tol, tol * 4, Math.abs(focus - depth));
}

export function exposureScore(ev: number, idealEv: number): number {
	return 1 - smoothstep(0.34, 1.6, Math.abs(ev - idealEv));
}

export function starsOf(total: number): number {
	return total >= STAR_3 ? 3 : total >= STAR_2 ? 2 : total >= STAR_1 ? 1 : 0;
}

/** Weights of the four criteria (sum 1). */
export const WEIGHTS = {
	composition: 0.35,
	fill: 0.25,
	focus: 0.25,
	exposure: 0.15,
} as const;
/** Score multiplier when something solid stands between the lens and the subject. */
export const OCCLUDED_FACTOR = 0.4;

const _p: Projection = { u: 0, v: 0, depth: 0 };

/**
 * Scores one subject in one photo. Allocation-free: writes `out`. `occluded` comes from the
 * caller (a physics ray from the lens to the subject centre).
 */
export function scorePhoto(
	cam: PhotoCam,
	s: Subject,
	occluded: boolean,
	out: PhotoScore,
): PhotoScore {
	out.occluded = occluded;
	const front = project(cam, s.x, s.y, s.z, _p);
	const u = _p.u;
	const v = _p.v;
	out.inFrame = front && _p.depth > 0.3 && u >= 0 && u <= 1 && v >= 0 && v <= 1;
	if (!out.inFrame) {
		out.composition = out.fill = out.focus = out.exposure = 0;
		out.crop = 1;
		out.total = 0;
		out.stars = 0;
		return out;
	}
	const tanH = Math.tan((cam.fovDeg * DEG) / 2);
	const fill = s.r / (_p.depth * tanH);
	// Radius in frame-height units; how far the subject spills past the nearest edge.
	const rad = fill / 2;
	const spill = Math.max(
		0,
		rad - u * FRAME_ASPECT,
		rad - (1 - u) * FRAME_ASPECT,
		rad - v,
		rad - (1 - v),
	);
	out.crop = 1 - 0.45 * smoothstep(0, rad * 0.8 + 1e-6, spill);
	out.composition = compositionScore(u, v);
	out.fill = fillScore(fill);
	out.focus = focusScore(cam.focus, _p.depth);
	out.exposure = exposureScore(cam.ev, s.idealEv);
	const raw =
		WEIGHTS.composition * out.composition +
		WEIGHTS.fill * out.fill +
		WEIGHTS.focus * out.focus +
		WEIGHTS.exposure * out.exposure;
	out.total = Math.round(
		100 * raw * out.crop * (occluded ? OCCLUDED_FACTOR : 1),
	);
	out.stars = starsOf(out.total);
	return out;
}

/** The yaw/pitch that centre the camera's look on a point (no roll). */
export function aimAt(
	cx: number,
	cy: number,
	cz: number,
	px: number,
	py: number,
	pz: number,
	out: { yaw: number; pitch: number },
): void {
	const dx = px - cx;
	const dy = py - cy;
	const dz = pz - cz;
	out.yaw = Math.atan2(-dx, -dz);
	out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
