/**
 * The mannequin rig as plain math (no three.js import, so Node tests can check poses).
 * A pose `Spec` gives the pelvis position and the pelvis/chest frames as direction vectors,
 * plus wrist and ankle targets (absolute, or anchored to a joint of the partner or self);
 * `solvePair` turns two specs into joint positions with analytic two-bone IK.
 */

export type V = [number, number, number];

export const J = {
	pelvis: 0,
	chest: 1,
	neck: 2,
	head: 3,
	shL: 4,
	elL: 5,
	wrL: 6,
	shR: 7,
	elR: 8,
	wrR: 9,
	hipL: 10,
	knL: 11,
	anL: 12,
	hipR: 13,
	knR: 14,
	anR: 15,
	toeL: 16,
	toeR: 17,
	handL: 18,
	handR: 19,
} as const;
export type JointName = keyof typeof J;
export const JN = 20;

export const DIM = {
	hipHalf: 0.095,
	spine: 0.28,
	shoulderUp: 0.11,
	shoulderHalf: 0.19,
	neck: 0.19,
	head: 0.12,
	headR: 0.115,
	upper: 0.28,
	fore: 0.25,
	hand: 0.075,
	thigh: 0.44,
	shin: 0.44,
	foot: 0.17,
	// collision radii (gi included)
	rPelvis: 0.13,
	rSpine: 0.125,
	rShoulders: 0.085,
	rUpper: 0.06,
	rFore: 0.045,
	rThigh: 0.078,
	rShin: 0.058,
	rHand: 0.045,
	rFoot: 0.045,
} as const;

/** A target: a point, or a joint of the partner (default) / self plus an offset. */
export type Target = V | { a: JointName; o?: V; self?: boolean };

export interface Spec {
	p: V;
	up: V;
	fwd: V;
	cUp?: V;
	cFwd?: V;
	look?: V;
	hL: Target;
	hR: Target;
	fL: Target;
	fR: Target;
	/** Pole directions (where the elbow / knee points). */
	eL?: V;
	eR?: V;
	kL?: V;
	kR?: V;
	/** Toe directions. */
	tL?: V;
	tR?: V;
}

export interface Frames {
	/** pelvis right/up/fwd, chest right/up/fwd, head up: 7 × 3 */
	f: Float64Array;
}

/** Solved body: joint positions (JN × 3) and frames (7 × 3). */
export class Solved {
	readonly j = new Float64Array(JN * 3);
	readonly f = new Float64Array(7 * 3);
	get(name: JointName, out: V): V {
		const k = J[name] * 3;
		out[0] = this.j[k] as number;
		out[1] = this.j[k + 1] as number;
		out[2] = this.j[k + 2] as number;
		return out;
	}
}

// ---------- tiny vector helpers (allocation-free variants take an out param) ----------
export const v3 = (x: number, y: number, z: number): V => [x, y, z];
export function norm(a: V, out: V = a): V {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	out[0] = a[0] / l;
	out[1] = a[1] / l;
	out[2] = a[2] / l;
	return out;
}
export function cross(a: V, b: V, out: V): V {
	const x = a[1] * b[2] - a[2] * b[1];
	const y = a[2] * b[0] - a[0] * b[2];
	const z = a[0] * b[1] - a[1] * b[0];
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
}
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const _a: V = [0, 0, 0];
const _b: V = [0, 0, 0];
const _c: V = [0, 0, 0];
const _d: V = [0, 0, 0];
const _up: V = [0, 0, 0];
const _fw: V = [0, 0, 0];
const _rt: V = [0, 0, 0];
const _cu: V = [0, 0, 0];
const _cf: V = [0, 0, 0];
const _cr: V = [0, 0, 0];
const _lk: V = [0, 0, 0];

function setJ(s: Solved, k: number, x: number, y: number, z: number): void {
	s.j[k * 3] = x;
	s.j[k * 3 + 1] = y;
	s.j[k * 3 + 2] = z;
}
function getJ(s: Solved, k: number, out: V): V {
	out[0] = s.j[k * 3] as number;
	out[1] = s.j[k * 3 + 1] as number;
	out[2] = s.j[k * 3 + 2] as number;
	return out;
}

/** Orthonormal frame from an up and a forward hint: right = fwd × up. */
function frame(up: V, fwdHint: V, oUp: V, oFwd: V, oRight: V): void {
	norm(up, oUp);
	const d = dot(fwdHint, oUp);
	oFwd[0] = fwdHint[0] - oUp[0] * d;
	oFwd[1] = fwdHint[1] - oUp[1] * d;
	oFwd[2] = fwdHint[2] - oUp[2] * d;
	norm(oFwd);
	cross(oFwd, oUp, oRight);
}

/** Torso joints and frames from the spec (limbs come later). */
export function solveTorso(sp: Spec, s: Solved): void {
	frame(sp.up, sp.fwd, _up, _fw, _rt);
	frame(sp.cUp ?? sp.up, sp.cFwd ?? sp.fwd, _cu, _cf, _cr);
	norm(sp.look ?? (_cu as V), _lk);
	const D = DIM;
	const [px, py, pz] = sp.p;
	setJ(s, J.pelvis, px, py, pz);
	const cx = px + (_up[0] + _cu[0]) * D.spine * 0.5;
	const cy = py + (_up[1] + _cu[1]) * D.spine * 0.5;
	const cz = pz + (_up[2] + _cu[2]) * D.spine * 0.5;
	setJ(s, J.chest, cx, cy, cz);
	const nx = cx + _cu[0] * D.neck;
	const ny = cy + _cu[1] * D.neck;
	const nz = cz + _cu[2] * D.neck;
	setJ(s, J.neck, nx, ny, nz);
	setJ(
		s,
		J.head,
		nx + _lk[0] * D.head + _cf[0] * 0.02,
		ny + _lk[1] * D.head + _cf[1] * 0.02,
		nz + _lk[2] * D.head + _cf[2] * 0.02,
	);
	for (const side of [-1, 1]) {
		const k = side < 0 ? J.shL : J.shR;
		setJ(
			s,
			k,
			cx + _cu[0] * D.shoulderUp + _cr[0] * D.shoulderHalf * side,
			cy + _cu[1] * D.shoulderUp + _cr[1] * D.shoulderHalf * side,
			cz + _cu[2] * D.shoulderUp + _cr[2] * D.shoulderHalf * side,
		);
		const h = side < 0 ? J.hipL : J.hipR;
		setJ(
			s,
			h,
			px + _rt[0] * D.hipHalf * side - _up[0] * 0.03,
			py + _rt[1] * D.hipHalf * side - _up[1] * 0.03,
			pz + _rt[2] * D.hipHalf * side - _up[2] * 0.03,
		);
	}
	const f = s.f;
	const put = (i: number, v: V): void => {
		f[i * 3] = v[0];
		f[i * 3 + 1] = v[1];
		f[i * 3 + 2] = v[2];
	};
	put(0, _rt);
	put(1, _up);
	put(2, _fw);
	put(3, _cr);
	put(4, _cu);
	put(5, _cf);
	put(6, _lk);
}

export function frameVec(s: Solved, i: number, out: V): V {
	out[0] = s.f[i * 3] as number;
	out[1] = s.f[i * 3 + 1] as number;
	out[2] = s.f[i * 3 + 2] as number;
	return out;
}

/** Resolves a target to a world point. Partner limb anchors read `partner` as solved so far. */
export function resolveTarget(
	t: Target,
	self: Solved,
	partner: Solved,
	out: V,
): V {
	if (Array.isArray(t)) {
		out[0] = t[0];
		out[1] = t[1];
		out[2] = t[2];
		return out;
	}
	getJ(t.self ? self : partner, J[t.a], out);
	if (t.o) {
		out[0] = (out[0] as number) + t.o[0];
		out[1] = (out[1] as number) + t.o[1];
		out[2] = (out[2] as number) + t.o[2];
	}
	return out;
}

/**
 * Two-bone IK from `root` to `target` with segment lengths a, b, bending toward `pole`.
 * Writes the middle joint and the (possibly clamped) end joint.
 */
export function ik(
	root: V,
	target: V,
	a: number,
	b: number,
	pole: V,
	mid: V,
	end: V,
): void {
	_a[0] = target[0] - root[0];
	_a[1] = target[1] - root[1];
	_a[2] = target[2] - root[2];
	let d = Math.hypot(_a[0], _a[1], _a[2]);
	norm(_a);
	d = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, d));
	const cosA = (a * a + d * d - b * b) / (2 * a * d);
	const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
	// pole component orthogonal to the limb axis
	const pd = dot(pole, _a);
	_b[0] = pole[0] - _a[0] * pd;
	_b[1] = pole[1] - _a[1] * pd;
	_b[2] = pole[2] - _a[2] * pd;
	if (Math.hypot(_b[0], _b[1], _b[2]) < 1e-6) {
		// pole parallel to the limb: pick any perpendicular
		cross(_a, Math.abs(_a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], _b);
	}
	norm(_b);
	for (let i = 0; i < 3; i++) {
		mid[i] =
			(root[i] as number) +
			(_a[i] as number) * a * cosA +
			(_b[i] as number) * a * sinA;
		end[i] = (root[i] as number) + (_a[i] as number) * d;
	}
}

const _r: V = [0, 0, 0];
const _t: V = [0, 0, 0];
const _m: V = [0, 0, 0];
const _e: V = [0, 0, 0];
const _p: V = [0, 0, 0];

/** Default poles in the body frame: elbows down-and-out, knees forward. */
function defaultPole(s: Solved, limb: number, out: V): V {
	const f = s.f;
	const side = limb === 0 || limb === 2 ? -1 : 1;
	if (limb < 2) {
		// elbows: -cUp mostly, a bit outward and back
		for (let i = 0; i < 3; i++)
			out[i] =
				-(f[12 + i] as number) * 0.8 +
				(f[9 + i] as number) * side * 0.45 -
				(f[15 + i] as number) * 0.2;
	} else for (let i = 0; i < 3; i++) out[i] = f[6 + i] as number;
	return out;
}

const LIMB_ROOT = [J.shL, J.shR, J.hipL, J.hipR];
const LIMB_MID = [J.elL, J.elR, J.knL, J.knR];
const LIMB_END = [J.wrL, J.wrR, J.anL, J.anR];

function solveLimbs(sp: Spec, targets: V[], s: Solved): void {
	const D = DIM;
	const poles = [sp.eL, sp.eR, sp.kL, sp.kR];
	for (let l = 0; l < 4; l++) {
		getJ(s, LIMB_ROOT[l] as number, _r);
		const tg = targets[l] as V;
		const pole = poles[l] ?? defaultPole(s, l, _p);
		const arm = l < 2;
		ik(_r, tg, arm ? D.upper : D.thigh, arm ? D.fore : D.shin, pole, _m, _e);
		const mk = LIMB_MID[l] as number;
		const ek = LIMB_END[l] as number;
		setJ(s, mk, _m[0], _m[1], _m[2]);
		setJ(s, ek, _e[0], _e[1], _e[2]);
		if (arm) {
			// hand continues the forearm
			_c[0] = _e[0] - _m[0];
			_c[1] = _e[1] - _m[1];
			_c[2] = _e[2] - _m[2];
			norm(_c);
			setJ(
				s,
				l === 0 ? J.handL : J.handR,
				_e[0] + _c[0] * D.hand,
				_e[1] + _c[1] * D.hand,
				_e[2] + _c[2] * D.hand,
			);
		} else {
			// toes: given direction, else the knee's pole made perpendicular to the shin
			const td = l === 2 ? sp.tL : sp.tR;
			_c[0] = _e[0] - _m[0];
			_c[1] = _e[1] - _m[1];
			_c[2] = _e[2] - _m[2];
			norm(_c);
			if (td) norm(td, _d);
			else {
				const q = pole;
				const k = dot(q, _c);
				_d[0] = q[0] - _c[0] * k;
				_d[1] = q[1] - _c[1] * k;
				_d[2] = q[2] - _c[2] * k;
				norm(_d);
			}
			setJ(
				s,
				l === 2 ? J.toeL : J.toeR,
				_e[0] + _d[0] * D.foot,
				_e[1] + _d[1] * D.foot,
				_e[2] + _d[2] * D.foot,
			);
		}
	}
}

const LIMB_KEYS = ["hL", "hR", "fL", "fR"] as const;
const isLimbAnchor = (t: Target): boolean =>
	!Array.isArray(t) &&
	!(
		t.a === "pelvis" ||
		t.a === "chest" ||
		t.a === "neck" ||
		t.a === "head" ||
		t.a.startsWith("sh") ||
		t.a.startsWith("hip")
	);

const _tg: V[][] = [
	[
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	],
	[
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	],
];

/**
 * Solves both bodies. Pass 1 resolves torso anchors and solves limbs; pass 2 re-resolves
 * anchors on partner limbs (grips on a sleeve or a wrist) against pass-1 joints.
 * With `targetsOut`, the resolved targets are written there instead of solving limbs
 * (used for blending two keys).
 */
export function solvePair(a: Spec, b: Spec, sa: Solved, sb: Solved): void {
	solveTorso(a, sa);
	solveTorso(b, sb);
	const specs = [a, b];
	const sol = [sa, sb];
	for (let pass = 0; pass < 2; pass++) {
		for (let i = 0; i < 2; i++) {
			const sp = specs[i] as Spec;
			const me = sol[i] as Solved;
			const other = sol[1 - i] as Solved;
			const tg = _tg[i] as V[];
			for (let l = 0; l < 4; l++) {
				const t = sp[LIMB_KEYS[l] as (typeof LIMB_KEYS)[number]];
				if (pass === 0 && isLimbAnchor(t))
					// fall back to the partner's chest for the first pass
					resolveTarget({ a: "chest" }, me, other, tg[l] as V);
				else resolveTarget(t, me, other, tg[l] as V);
			}
		}
		for (let i = 0; i < 2; i++)
			solveLimbs(specs[i] as Spec, _tg[i] as V[], sol[i] as Solved);
	}
}

/** Resolves a spec pair's four targets per body into `out` (2 × 4 points) given solved bodies. */
export function resolveTargets(
	a: Spec,
	b: Spec,
	sa: Solved,
	sb: Solved,
	out: V[][],
): void {
	const specs = [a, b];
	const sol = [sa, sb];
	for (let i = 0; i < 2; i++)
		for (let l = 0; l < 4; l++) {
			const sp = specs[i] as Spec;
			resolveTarget(
				sp[LIMB_KEYS[l] as (typeof LIMB_KEYS)[number]],
				sol[i] as Solved,
				sol[1 - i] as Solved,
				(out[i] as V[])[l] as V,
			);
		}
}

/** Solves limbs of one body from explicit world targets (after blending). */
export function solveLimbsWith(sp: Spec, targets: V[], s: Solved): void {
	solveLimbs(sp, targets, s);
}

// ---------- collision capsules (for tests and debug) ----------

export const CAPSULES: [number, number, number][] = [
	// [jointA, jointB, radius]
	[J.hipL, J.hipR, DIM.rPelvis],
	[J.pelvis, J.chest, DIM.rSpine],
	[J.shL, J.shR, DIM.rShoulders],
	[J.head, J.head, DIM.headR],
	[J.shL, J.elL, DIM.rUpper],
	[J.elL, J.wrL, DIM.rFore],
	[J.shR, J.elR, DIM.rUpper],
	[J.elR, J.wrR, DIM.rFore],
	[J.wrL, J.handL, DIM.rHand],
	[J.wrR, J.handR, DIM.rHand],
	[J.hipL, J.knL, DIM.rThigh],
	[J.knL, J.anL, DIM.rShin],
	[J.hipR, J.knR, DIM.rThigh],
	[J.knR, J.anR, DIM.rShin],
	[J.anL, J.toeL, DIM.rFoot],
	[J.anR, J.toeR, DIM.rFoot],
];
export const CAPSULE_NAMES = [
	"pelvis",
	"spine",
	"shoulders",
	"head",
	"upperL",
	"foreL",
	"upperR",
	"foreR",
	"handL",
	"handR",
	"thighL",
	"shinL",
	"thighR",
	"shinR",
	"footL",
	"footR",
];

/** Closest points between segments p1-q1 and p2-q2: returns the distance; writes the
 * direction from the second segment's closest point to the first's into `dir` (if given). */
export function segDist(p1: V, q1: V, p2: V, q2: V, dir?: V): number {
	const d1x = q1[0] - p1[0];
	const d1y = q1[1] - p1[1];
	const d1z = q1[2] - p1[2];
	const d2x = q2[0] - p2[0];
	const d2y = q2[1] - p2[1];
	const d2z = q2[2] - p2[2];
	const rx = p1[0] - p2[0];
	const ry = p1[1] - p2[1];
	const rz = p1[2] - p2[2];
	const a = d1x * d1x + d1y * d1y + d1z * d1z;
	const e = d2x * d2x + d2y * d2y + d2z * d2z;
	const f = d2x * rx + d2y * ry + d2z * rz;
	let s = 0;
	let t = 0;
	if (a <= 1e-9 && e <= 1e-9) {
		s = 0;
		t = 0;
	} else if (a <= 1e-9) {
		t = Math.min(1, Math.max(0, f / e));
	} else {
		const c = d1x * rx + d1y * ry + d1z * rz;
		if (e <= 1e-9) s = Math.min(1, Math.max(0, -c / a));
		else {
			const b = d1x * d2x + d1y * d2y + d1z * d2z;
			const den = a * e - b * b;
			s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = Math.min(1, Math.max(0, -c / a));
			} else if (t > 1) {
				t = 1;
				s = Math.min(1, Math.max(0, (b - c) / a));
			}
		}
	}
	const x = p1[0] + d1x * s - (p2[0] + d2x * t);
	const y = p1[1] + d1y * s - (p2[1] + d2y * t);
	const z = p1[2] + d1z * s - (p2[2] + d2z * t);
	const l = Math.hypot(x, y, z);
	if (dir) {
		if (l > 1e-6) {
			dir[0] = x / l;
			dir[1] = y / l;
			dir[2] = z / l;
		} else {
			dir[0] = 0;
			dir[1] = 1;
			dir[2] = 0;
		}
	}
	return l;
}

export interface Hit {
	a: string;
	b: string;
	depth: number;
}

/** Penetrations deeper than `tol` between the two bodies' capsules. */
export function penetrations(sa: Solved, sb: Solved, tol: number): Hit[] {
	const hits: Hit[] = [];
	const p1: V = [0, 0, 0];
	const q1: V = [0, 0, 0];
	const p2: V = [0, 0, 0];
	const q2: V = [0, 0, 0];
	for (let i = 0; i < CAPSULES.length; i++) {
		const ca = CAPSULES[i] as [number, number, number];
		getJ(sa, ca[0], p1);
		getJ(sa, ca[1], q1);
		for (let k = 0; k < CAPSULES.length; k++) {
			const cb = CAPSULES[k] as [number, number, number];
			getJ(sb, cb[0], p2);
			getJ(sb, cb[1], q2);
			const depth = ca[2] + cb[2] - segDist(p1, q1, p2, q2);
			if (depth > tol)
				hits.push({
					a: CAPSULE_NAMES[i] as string,
					b: CAPSULE_NAMES[k] as string,
					depth,
				});
		}
	}
	return hits;
}

/** Joints sunk below the mat (y < radius - tol). */
export function belowFloor(s: Solved, tol: number): string[] {
	const out: string[] = [];
	const p: V = [0, 0, 0];
	for (let i = 0; i < CAPSULES.length; i++) {
		const c = CAPSULES[i] as [number, number, number];
		for (const k of [c[0], c[1]]) {
			getJ(s, k, p);
			if (p[1] < c[2] - tol) out.push(CAPSULE_NAMES[i] as string);
		}
	}
	return [...new Set(out)];
}

// ---------- contact resolver (runtime and tests) ----------

/** Capsules of each limb (indices into CAPSULES). */
const LIMB_CAPS = [
	[4, 5, 8],
	[6, 7, 9],
	[10, 11, 14],
	[12, 13, 15],
];
const TORSO_CAPS = [0, 1, 2, 3];
/** Allowed overlap: grips squeeze cloth, legs wrap around a gi. */
export const TOL_HAND = 0.05;
export const TOL_LIMB = 0.03;
/** A gi on a soft mat: knees and feet may rest this far into it. */
export const TOL_FLOOR = 0.03;

const _p1: V = [0, 0, 0];
const _q1: V = [0, 0, 0];
const _p2: V = [0, 0, 0];
const _q2: V = [0, 0, 0];
const _dir: V = [0, 0, 0];
const _push: V = [0, 0, 0];

/** Deepest overlap of capsule `ci` of body `s` against all capsules of `o`; push dir in _push. */
function capDepth(
	s: Solved,
	ci: number,
	o: Solved,
	from: number[] | null,
): number {
	const ca = CAPSULES[ci] as [number, number, number];
	getJ(s, ca[0], _p1);
	getJ(s, ca[1], _q1);
	let best = -1;
	const n = from ? from.length : CAPSULES.length;
	for (let k = 0; k < n; k++) {
		const cb = CAPSULES[from ? (from[k] as number) : k] as [
			number,
			number,
			number,
		];
		getJ(o, cb[0], _p2);
		getJ(o, cb[1], _q2);
		const d = ca[2] + cb[2] - segDist(_p1, _q1, _p2, _q2, _dir);
		if (d > best) {
			best = d;
			_push[0] = _dir[0];
			_push[1] = _dir[1];
			_push[2] = _dir[2];
		}
	}
	return best;
}

function limbDepth(s: Solved, l: number, o: Solved): number {
	const caps = LIMB_CAPS[l] as number[];
	let best = -1;
	let px = 0;
	let py = 1;
	let pz = 0;
	for (let i = 0; i < caps.length; i++) {
		const tol = i === 2 && l < 2 ? TOL_HAND : TOL_LIMB;
		const d = capDepth(s, caps[i] as number, o, null) - tol;
		if (d > best) {
			best = d;
			px = _push[0];
			py = _push[1];
			pz = _push[2];
		}
	}
	// the mat is a contact too: joints may rest up to TOL_FLOOR into it, never deeper
	for (let i = 0; i < caps.length; i++) {
		const c = CAPSULES[caps[i] as number] as [number, number, number];
		for (const k of [c[0], c[1]]) {
			if (k === LIMB_ROOT[l]) continue;
			const d = c[2] - (s.j[k * 3 + 1] as number) - TOL_FLOOR;
			if (d > best) {
				best = d;
				px = 0;
				py = 1;
				pz = 0;
			}
		}
	}
	_push[0] = px;
	_push[1] = py;
	_push[2] = pz;
	return best;
}

const _axis: V = [0, 0, 0];
const _pole: V = [0, 0, 0];
const _bestPole: V = [0, 0, 0];
const _bestPush: V = [0, 0, 0];
const _tmpT: V = [0, 0, 0];
const _root: V = [0, 0, 0];
const _mid: V = [0, 0, 0];
const _end: V = [0, 0, 0];
const ANGLES = [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI];

function rotateAbout(v: V, axis: V, ang: number, out: V): V {
	const c = Math.cos(ang);
	const s = Math.sin(ang);
	const d = dot(axis, v);
	const cx = axis[1] * v[2] - axis[2] * v[1];
	const cy = axis[2] * v[0] - axis[0] * v[2];
	const cz = axis[0] * v[1] - axis[1] * v[0];
	out[0] = v[0] * c + cx * s + axis[0] * d * (1 - c);
	out[1] = v[1] * c + cy * s + axis[1] * d * (1 - c);
	out[2] = v[2] * c + cz * s + axis[2] * d * (1 - c);
	return out;
}

function solveOneLimb(
	sp: Spec,
	s: Solved,
	l: number,
	target: V,
	pole: V,
): void {
	const arm = l < 2;
	getJ(s, LIMB_ROOT[l] as number, _root);
	ik(
		_root,
		target,
		arm ? DIM.upper : DIM.thigh,
		arm ? DIM.fore : DIM.shin,
		pole,
		_mid,
		_end,
	);
	setJ(s, LIMB_MID[l] as number, _mid[0], _mid[1], _mid[2]);
	setJ(s, LIMB_END[l] as number, _end[0], _end[1], _end[2]);
	_c[0] = _end[0] - _mid[0];
	_c[1] = _end[1] - _mid[1];
	_c[2] = _end[2] - _mid[2];
	norm(_c);
	if (arm) {
		setJ(
			s,
			l === 0 ? J.handL : J.handR,
			_end[0] + _c[0] * DIM.hand,
			_end[1] + _c[1] * DIM.hand,
			_end[2] + _c[2] * DIM.hand,
		);
	} else {
		const td = l === 2 ? sp.tL : sp.tR;
		if (td) norm(td, _d);
		else {
			const k = dot(pole, _c);
			_d[0] = pole[0] - _c[0] * k;
			_d[1] = pole[1] - _c[1] * k;
			_d[2] = pole[2] - _c[2] * k;
			norm(_d);
		}
		setJ(
			s,
			l === 2 ? J.toeL : J.toeR,
			_end[0] + _d[0] * DIM.foot,
			_end[1] + _d[1] * DIM.foot,
			_end[2] + _d[2] * DIM.foot,
		);
	}
}

const _shift: V = [0, 0, 0];

/**
 * Removes interpenetration after `solvePair` (or a blended solve): first separates the
 * torsos by lifting body `upper` (default: the one whose pelvis is higher), then for each
 * limb tries other bend directions about its axis and finally pushes its target out.
 * `targets[i][l]` are the world targets used for the solve (updated in place).
 */
export function resolveContacts(
	specs: Spec[],
	sol: Solved[],
	targets: V[][],
	iters = 2,
): void {
	const sa = sol[0] as Solved;
	const sb = sol[1] as Solved;
	// torso vs torso: lift the higher body
	const upper = (sa.j[1] as number) >= (sb.j[1] as number) ? 0 : 1;
	const su = sol[upper] as Solved;
	const so = sol[1 - upper] as Solved;
	let lift = 0;
	for (const ci of TORSO_CAPS) {
		const d = capDepth(su, ci, so, TORSO_CAPS) - 0.01;
		if (d > lift) lift = d;
	}
	if (lift > 0) {
		_shift[0] = 0;
		_shift[1] = lift;
		_shift[2] = 0;
		for (let k = 0; k < JN; k++)
			su.j[k * 3 + 1] = (su.j[k * 3 + 1] as number) + lift;
		// limbs re-solve below from their (unchanged) targets
		const sp = specs[upper] as Spec;
		for (let l = 0; l < 4; l++) {
			const tg = (targets[upper] as V[])[l] as V;
			const poles = [sp.eL, sp.eR, sp.kL, sp.kR];
			solveOneLimb(sp, su, l, tg, poles[l] ?? defaultPole(su, l, _pole));
		}
	}
	for (let it = 0; it < iters; it++) {
		let any = false;
		for (let i = 0; i < 2; i++) {
			const s = sol[i] as Solved;
			const o = sol[1 - i] as Solved;
			const sp = specs[i] as Spec;
			const poles = [sp.eL, sp.eR, sp.kL, sp.kR];
			for (let l = 0; l < 4; l++) {
				const d0 = limbDepth(s, l, o);
				if (d0 <= 0) continue;
				any = true;
				const tg = (targets[i] as V[])[l] as V;
				const base = poles[l] ?? defaultPole(s, l, _pole);
				getJ(s, LIMB_ROOT[l] as number, _root);
				_axis[0] = tg[0] - _root[0];
				_axis[1] = tg[1] - _root[1];
				_axis[2] = tg[2] - _root[2];
				norm(_axis);
				let best = d0;
				_bestPole[0] = base[0];
				_bestPole[1] = base[1];
				_bestPole[2] = base[2];
				_bestPush[0] = _push[0];
				_bestPush[1] = _push[1];
				_bestPush[2] = _push[2];
				for (let a = 1; a < ANGLES.length && best > 0; a++) {
					rotateAbout(base, _axis, ANGLES[a] as number, _tmpT);
					solveOneLimb(sp, s, l, tg, _tmpT);
					const d = limbDepth(s, l, o);
					// a different bend must win clearly, so poses do not flip for nothing
					if (d < best - 0.02) {
						best = d;
						_bestPole[0] = _tmpT[0];
						_bestPole[1] = _tmpT[1];
						_bestPole[2] = _tmpT[2];
						_bestPush[0] = _push[0];
						_bestPush[1] = _push[1];
						_bestPush[2] = _push[2];
					}
				}
				if (best > 0) {
					tg[0] = (tg[0] as number) + _bestPush[0] * (best + 0.005);
					tg[1] = (tg[1] as number) + _bestPush[1] * (best + 0.005);
					tg[2] = (tg[2] as number) + _bestPush[2] * (best + 0.005);
					if (tg[1] < 0.05) tg[1] = 0.05;
				}
				solveOneLimb(sp, s, l, tg, _bestPole);
			}
		}
		if (!any) break;
	}
	separate(specs, sol, targets, 40);
}

const TORSO_JOINTS = [
	J.pelvis,
	J.chest,
	J.neck,
	J.head,
	J.shL,
	J.shR,
	J.hipL,
	J.hipR,
];
/** Which limb a capsule belongs to (-1 for torso capsules). */
const CAP_LIMB = [-1, -1, -1, -1, 0, 0, 1, 1, 0, 1, 2, 2, 3, 3, 2, 3];
const _sep: V = [0, 0, 0];

function capTol(i: number, k: number): number {
	const ti = CAP_LIMB[i] === -1;
	const tk = CAP_LIMB[k] === -1;
	if (ti && tk) return 0.01;
	if (i === 8 || i === 9 || k === 8 || k === 9) return TOL_HAND;
	return TOL_LIMB;
}

/**
 * Last resort after limb re-bending: if any capsule pair still overlaps past its tolerance,
 * slide the upper body's torso out along the separation direction (biased upward), push the
 * offending limb's target the same way, and re-solve its limbs. Feet and hands that are not
 * involved stay planted on their targets.
 */
function separate(
	specs: Spec[],
	sol: Solved[],
	targets: V[][],
	iters: number,
): void {
	for (let it = 0; it < iters; it++) {
		let worst = 0;
		let wi = -1;
		let wk = -1;
		for (let i = 0; i < CAPSULES.length; i++) {
			const ca = CAPSULES[i] as [number, number, number];
			getJ(sol[0] as Solved, ca[0], _p1);
			getJ(sol[0] as Solved, ca[1], _q1);
			for (let k = 0; k < CAPSULES.length; k++) {
				const cb = CAPSULES[k] as [number, number, number];
				getJ(sol[1] as Solved, cb[0], _p2);
				getJ(sol[1] as Solved, cb[1], _q2);
				const d =
					ca[2] + cb[2] - segDist(_p1, _q1, _p2, _q2, _dir) - capTol(i, k);
				if (d > worst) {
					worst = d;
					wi = i;
					wk = k;
					_sep[0] = _dir[0];
					_sep[1] = _dir[1];
					_sep[2] = _dir[2];
				}
			}
		}
		// the mat: torso pieces lift their body, limb ends lift their target
		let fworst = 0;
		let fb = -1;
		let fc = -1;
		for (let b = 0; b < 2; b++) {
			const sb = sol[b] as Solved;
			for (let i = 0; i < CAPSULES.length; i++) {
				const c = CAPSULES[i] as [number, number, number];
				for (const k of [c[0], c[1]]) {
					const d = c[2] - TOL_FLOOR - (sb.j[k * 3 + 1] as number);
					if (d > fworst) {
						fworst = d;
						fb = b;
						fc = i;
					}
				}
			}
		}
		if (fworst > worst) {
			const sb = sol[fb] as Solved;
			const sp = specs[fb] as Spec;
			const poles = [sp.eL, sp.eR, sp.kL, sp.kR];
			const limb = CAP_LIMB[fc] as number;
			const m = fworst + 0.003;
			if (limb < 0) {
				for (const k of TORSO_JOINTS)
					sb.j[k * 3 + 1] = (sb.j[k * 3 + 1] as number) + m;
				for (let l = 0; l < 4; l++)
					solveOneLimb(
						sp,
						sb,
						l,
						(targets[fb] as V[])[l] as V,
						poles[l] ?? defaultPole(sb, l, _pole),
					);
			} else {
				const tg = (targets[fb] as V[])[limb] as V;
				tg[1] += m;
				solveOneLimb(
					sp,
					sb,
					limb,
					tg,
					poles[limb] ?? defaultPole(sb, limb, _pole),
				);
			}
			continue;
		}
		if (worst <= 0) return;
		// move the body whose pelvis is higher; _sep points from body 1 to body 0
		const mover =
			((sol[0] as Solved).j[1] as number) >= ((sol[1] as Solved).j[1] as number)
				? 0
				: 1;
		const sign = mover === 0 ? 1 : -1;
		let dx = _sep[0] * sign;
		let dy = _sep[1] * sign;
		let dz = _sep[2] * sign;
		if (dy < 0.35) {
			dy = 0.35;
			norm([dx, dy, dz], _sep);
			dx = _sep[0];
			dy = _sep[1];
			dz = _sep[2];
		}
		const m = worst + 0.004;
		const s = sol[mover] as Solved;
		for (const k of TORSO_JOINTS) {
			s.j[k * 3] = (s.j[k * 3] as number) + dx * m;
			s.j[k * 3 + 1] = (s.j[k * 3 + 1] as number) + dy * m;
			s.j[k * 3 + 2] = (s.j[k * 3 + 2] as number) + dz * m;
		}
		const limb = CAP_LIMB[mover === 0 ? wi : wk] as number;
		if (limb >= 0) {
			const tg = (targets[mover] as V[])[limb] as V;
			tg[0] += dx * m;
			tg[1] += dy * m;
			tg[2] += dz * m;
		}
		const sp = specs[mover] as Spec;
		const poles = [sp.eL, sp.eR, sp.kL, sp.kR];
		for (let l = 0; l < 4; l++)
			solveOneLimb(
				sp,
				s,
				l,
				(targets[mover] as V[])[l] as V,
				poles[l] ?? defaultPole(s, l, _pole),
			);
		// the other body's limb, if it was the offender, gives way too
		const other = 1 - mover;
		const ol = CAP_LIMB[other === 0 ? wi : wk] as number;
		if (ol >= 0) {
			const tg = (targets[other] as V[])[ol] as V;
			tg[0] -= dx * m * 0.5;
			tg[1] -= dy * m * 0.5;
			tg[2] -= dz * m * 0.5;
			const so = sol[other] as Solved;
			const spo = specs[other] as Spec;
			const po = [spo.eL, spo.eR, spo.kL, spo.kR];
			solveOneLimb(spo, so, ol, tg, po[ol] ?? defaultPole(so, ol, _pole));
		}
	}
}

/** Solves a pair and resolves contacts; the resolved targets are left in `targets`. */
export function solvePairResolved(
	a: Spec,
	b: Spec,
	sa: Solved,
	sb: Solved,
	targets: V[][],
): void {
	solvePair(a, b, sa, sb);
	resolveTargets(a, b, sa, sb, targets);
	resolveContacts([a, b], [sa, sb], targets, 3);
}
