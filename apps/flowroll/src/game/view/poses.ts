/**
 * Keyed poses: one pair of specs (top role, bottom role) per position, a telegraph posture
 * per move, and the in-between arc each transition takes. Coordinates are pair space: metres,
 * y up, the mat centre at the origin. Grips are anchors on the partner's joints, so hands stay
 * on the collar or sleeve through every blend.
 *
 * Conventions: right = fwd × up. Facing +x upright → right is +z. Supine with the head toward
 * +x (fwd +y, up +x) → right is -z.
 */
import type { PosId } from "../graph.ts";
import {
	type JointName,
	norm,
	type Spec,
	type Target,
	type V,
} from "./body.ts";

const n = (x: number, y: number, z: number): V => norm([x, y, z]);
const at = (a: JointName, o?: V): Target => (o ? { a, o } : { a });
const self = (a: JointName, o?: V): Target =>
	o ? { a, o, self: true } : { a, self: true };

export interface PairPose {
	top: Spec;
	bottom: Spec;
}

/** Rotates a spec 180° about y (x → -x, z → -z): the partner's mirror in standing. */
export function rot180(s: Spec): Spec {
	const r = (v: V): V => [-v[0], v[1], -v[2]];
	const rt = (t: Target): Target =>
		Array.isArray(t) ? r(t) : { ...t, o: t.o ? r(t.o) : undefined };
	const out: Spec = {
		p: r(s.p),
		up: r(s.up),
		fwd: r(s.fwd),
		hL: rt(s.hL),
		hR: rt(s.hR),
		fL: rt(s.fL),
		fR: rt(s.fR),
	};
	for (const k of [
		"cUp",
		"cFwd",
		"look",
		"eL",
		"eR",
		"kL",
		"kR",
		"tL",
		"tR",
	] as const) {
		const v = s[k];
		if (v) out[k] = r(v);
	}
	return out;
}

// ---------- standing ----------
const STAND: Spec = {
	p: [-0.37, 0.87, 0],
	up: n(0.2, 1, 0),
	fwd: [1, 0, 0],
	cUp: n(0.28, 1, 0),
	look: n(0.15, 1, 0),
	// right hand on their left lapel, left hand on their right sleeve
	hR: at("chest", [-0.13, 0.05, 0.08]),
	hL: at("elR", [0.02, -0.03, -0.05]),
	fL: [-0.22, 0.07, -0.19],
	fR: [-0.55, 0.07, 0.17],
	kL: n(1, 0, -0.3),
	kR: n(1, 0, 0.3),
	tL: n(1, 0, -0.2),
	tR: n(1, 0, 0.3),
	eL: n(0.2, -1, -0.8),
	eR: n(0, -1, 0.7),
};

const INTRO: Spec = {
	p: [-1.05, 0.93, 0],
	up: n(0.02, 1, 0),
	fwd: [1, 0, 0],
	hR: self("hipR", [0.04, -0.18, 0.06]),
	hL: self("hipL", [0.04, -0.18, -0.06]),
	fL: [-1.03, 0.07, -0.13],
	fR: [-1.07, 0.07, 0.13],
	kL: [1, 0, 0],
	kR: [1, 0, 0],
	tL: [1, 0, 0],
	tR: [1, 0, 0],
	eL: n(-0.3, -1, -0.3),
	eR: n(-0.3, -1, 0.3),
};

// ---------- ground: the bottom lies supine with the head toward +x ----------
const SUPINE = (over: Partial<Spec> = {}): Spec => ({
	p: [0, 0.13, 0],
	up: n(1, 0.08, 0),
	fwd: n(-0.08, 1, 0),
	cUp: n(1, 0.2, 0),
	look: n(1, 0.5, 0),
	hL: [0.25, 0.06, 0.45],
	hR: [0.25, 0.06, -0.45],
	fL: [-0.62, 0.07, 0.24],
	fR: [-0.62, 0.07, -0.24],
	kL: n(0, 1, 0.3),
	kR: n(0, 1, -0.3),
	eL: n(0, -1, 0.5),
	eR: n(0, -1, -0.5),
	...over,
});

export const POSES: Record<PosId, PairPose> = {
	standing: { top: STAND, bottom: rot180(STAND) },
	closedGuard: {
		// top kneels in posture between the legs, hands on the hips
		top: {
			p: [-0.34, 0.5, 0],
			up: n(0.1, 1, 0),
			fwd: [1, 0, 0],
			cUp: n(0.18, 1, 0),
			look: n(0.25, 1, 0),
			hR: at("pelvis", [0.08, 0.13, 0.12]),
			hL: at("pelvis", [0.08, 0.13, -0.12]),
			fL: [-0.82, 0.07, -0.17],
			fR: [-0.82, 0.07, 0.17],
			kL: n(1, -1, -0.3),
			kR: n(1, -1, 0.3),
			tL: n(-1, -0.3, 0),
			tR: n(-1, -0.3, 0),
			eL: n(-0.2, -0.3, -1),
			eR: n(-0.2, -0.3, 1),
		},
		// bottom: legs locked around the waist, hands on the sleeves
		bottom: SUPINE({
			p: [-0.06, 0.2, 0],
			up: n(1, 0.4, 0),
			fwd: n(-0.4, 1, 0),
			cUp: n(1, 0.32, 0),
			hL: at("wrR", [0.02, 0.03, 0.02]),
			hR: at("wrL", [0.02, 0.03, -0.02]),
			fL: [-0.64, 0.68, -0.05],
			fR: [-0.64, 0.64, 0.05],
			kL: n(0, 0.25, 1),
			kR: n(0, 0.25, -1),
			tL: n(0, 0, -1),
			tR: n(0, 0, 1),
			eL: n(0, -1, 0.6),
			eR: n(0, -1, -0.6),
		}),
	},
	halfGuard: {
		// top flattens chest to chest, head beside theirs, right leg trapped
		top: {
			p: [-0.04, 0.42, 0.1],
			up: n(1, 0.02, -0.08),
			fwd: [0, -1, 0],
			cUp: n(1, 0.06, -0.3),
			look: n(1, 0.1, -0.35),
			hR: [0.62, 0.06, -0.26],
			hL: [0.1, 0.06, -0.42],
			fL: [-0.6, 0.06, -0.38],
			fR: [-0.72, 0.14, 0.12],
			kL: n(0, -1, -0.5),
			kR: n(0.2, -1, 0.3),
			tL: n(-0.3, -1, 0),
			tR: n(-1, -0.2, 0),
			eL: n(-0.3, 0.5, -1),
			eR: n(0, 0.6, 1),
		},
		bottom: SUPINE({
			fwd: n(-0.05, 1, 0.3),
			hL: at("chest", [0.0, 0.1, 0.15]),
			hR: at("neck", [0.02, -0.05, -0.1]),
			fL: [-0.66, 0.14, 0.01],
			fR: [-0.64, 0.2, 0.2],
			kL: n(0, 0.6, 1),
			kR: n(0, 0.6, -1),
			eL: n(0, -0.3, 1),
			eR: n(0, -1, -0.8),
		}),
	},
	sideControl: {
		// top across the chest from their left side, knees on the mat, crossface
		top: {
			p: [0.08, 0.43, 0.29],
			up: n(0.22, 0.12, -1),
			fwd: [0, -1, 0],
			cUp: n(0.3, 0.05, -1),
			look: n(0.4, 0.2, -1),
			hR: [0.78, 0.06, -0.1],
			hL: [-0.18, 0.06, -0.32],
			fL: [-0.06, 0.07, 0.74],
			fR: [0.3, 0.07, 0.76],
			kL: n(-0.2, -1, -0.6),
			kR: n(0.2, -1, -0.6),
			tL: n(0, -0.3, 1),
			tR: n(0, -0.3, 1),
			eL: n(-1, 0.5, 0.2),
			eR: n(1, 0.6, 0.2),
		},
		bottom: SUPINE({
			hL: at("hipL", [0, -0.03, 0.06]),
			hR: at("neck", [0, -0.02, -0.06]),
			eL: n(0, -1, 1),
			eR: n(0.2, -1, -1),
		}),
	},
	kneeOnBelly: {
		// top pops up: right knee on the belly, left leg posted wide
		top: {
			p: [0.0, 0.66, 0.3],
			up: n(0, 1, 0.12),
			fwd: n(0, -0.25, -1),
			cUp: n(0.05, 1, -0.05),
			look: n(0, 1, -0.3),
			hR: at("chest", [0.1, 0.12, -0.1]),
			hL: at("pelvis", [0.02, 0.12, 0.08]),
			fR: [-0.26, 0.29, 0.18],
			fL: [-0.45, 0.07, 0.74],
			kR: n(0.2, -0.2, -1),
			kL: n(-0.3, 0.3, 0.4),
			tR: n(-0.4, -0.2, -1),
			tL: n(0.1, 0, -1),
			eR: n(1, -0.5, 0.4),
			eL: n(-1, -0.5, 0.4),
		},
		bottom: SUPINE({
			hL: at("knR", [0.03, 0.02, 0.05]),
			hR: at("knR", [0.05, 0.03, -0.06]),
			eL: n(0, -1, 1),
			eR: n(0, -1, -1),
		}),
	},
	mount: {
		top: {
			p: [0.06, 0.44, 0],
			up: n(0.12, 1, 0),
			fwd: [1, 0, 0],
			cUp: n(0.25, 1, 0),
			look: n(0.3, 1, 0),
			hL: at("chest", [0.1, 0.14, -0.09]),
			hR: at("chest", [0.1, 0.14, 0.09]),
			fL: [-0.3, 0.07, -0.33],
			fR: [-0.3, 0.07, 0.33],
			kL: n(1, -0.8, -0.6),
			kR: n(1, -0.8, 0.6),
			tL: n(-1, -0.4, 0),
			tR: n(-1, -0.4, 0),
			eL: n(-0.2, 0, -1),
			eR: n(-0.2, 0, 1),
		},
		bottom: SUPINE({
			hL: at("hipR", [0.02, 0, 0.05]),
			hR: at("hipL", [0.02, 0, -0.05]),
			fL: [-0.72, 0.07, 0.2],
			fR: [-0.72, 0.07, -0.2],
			eL: n(0, -1, 1),
			eR: n(0, -1, -1),
		}),
	},
	back: {
		// top sits behind, hooks in, seat-belt grip
		top: {
			p: [-0.2, 0.14, 0],
			up: n(-0.45, 1, 0),
			fwd: n(1, 0.45, 0),
			cUp: n(-0.2, 1, 0),
			look: n(0.1, 1, 0.15),
			hR: at("chest", [0.13, 0.06, -0.04]),
			hL: at("chest", [0.13, -0.03, 0.04]),
			fL: [0.38, 0.2, -0.25],
			fR: [0.38, 0.2, 0.25],
			kL: n(0, 0.7, -1),
			kR: n(0, 0.7, 1),
			tL: n(1, 0, 0.3),
			tR: n(1, 0, -0.3),
			eL: n(0, -0.2, -1),
			eR: n(0, 0.3, 1),
		},
		bottom: {
			p: [0.16, 0.15, 0],
			up: n(-0.3, 1, 0),
			fwd: n(1, 0.3, 0),
			cUp: n(-0.15, 1, 0),
			look: n(0.1, 1, 0),
			hL: at("wrL", [0.04, 0.02, 0.03]),
			hR: at("wrR", [0.04, 0.03, -0.03]),
			fL: [0.9, 0.07, -0.18],
			fR: [0.9, 0.07, 0.18],
			kL: n(0.3, 1, -0.1),
			kR: n(0.3, 1, 0.1),
			eL: n(0.3, -1, -0.5),
			eR: n(0.3, -1, 0.5),
		},
	},
	armbar: {
		// finish: both on their backs. The finisher lies side-on to the defender (head away),
		// hips tight to the trapped shoulder so the arm passes between their thighs, the left
		// leg over the face and the right leg across the chest; the arm runs straight up their
		// torso with the wrist held at their chest. Hips lift into it as the squeeze builds.
		top: {
			p: [0.36, 0.13, -0.42],
			up: n(0, 0.06, -1),
			fwd: [0, 1, 0],
			cUp: n(0, 0.2, -1),
			look: n(0, 0.7, -1),
			hL: at("wrR", [0.05, 0.02, 0.0]),
			hR: at("wrR", [-0.05, 0.03, 0.0]),
			fL: [0.64, 0.3, 0.2],
			fR: [0.18, 0.32, 0.2],
			kL: n(0.25, 1, 0),
			kR: n(-0.25, 1, 0),
			tL: n(0, -0.4, 1),
			tR: n(0, -0.4, 1),
			eL: n(1, 0.4, 0),
			eR: n(-1, 0.4, 0),
		},
		bottom: SUPINE({
			fwd: n(-0.05, 1, -0.2),
			hR: [0.36, 0.42, -0.72],
			eR: n(0, 1, 0.3),
			hL: [0.12, 0.06, 0.46],
			eL: n(0, -0.5, 1),
		}),
	},
	triangle: {
		// finisher on their back, legs locked around head and arm
		top: SUPINE({
			p: [0.05, 0.16, 0],
			up: n(1, 0.25, 0),
			fwd: n(-0.25, 1, 0),
			cUp: n(1, 0.25, 0),
			hL: at("head", [-0.06, 0.08, 0.05]),
			hR: at("wrL", [0, 0.03, 0]),
			// shins lock in a figure four behind their neck
			fL: at("neck", [-0.14, 0.24, -0.24]),
			fR: at("neck", [-0.08, 0.25, 0.14]),
			kL: n(0, 0.3, 1),
			kR: n(0, 0.3, -1),
			tL: n(0, 0, -1),
			tR: n(0, 0, 1),
		}),
		// defender kneeling, head pulled down onto the finisher's hips
		bottom: {
			p: [-0.55, 0.48, 0],
			up: n(0.7, 1, 0),
			fwd: n(1, -0.6, 0),
			cUp: n(1, 0.3, 0),
			look: n(1, -0.2, 0),
			hL: at("pelvis", [0.06, 0.12, -0.18]),
			hR: at("chest", [0.0, 0.14, 0.12]),
			fL: [-0.95, 0.07, -0.17],
			fR: [-0.95, 0.07, 0.17],
			kL: n(1, -1, -0.3),
			kR: n(1, -1, 0.3),
			tL: n(-1, -0.3, 0),
			tR: n(-1, -0.3, 0),
		},
	},
	kimura: {
		// finisher in side control, figure-four on their far arm bent behind
		top: {
			p: [0.06, 0.43, 0.3],
			up: n(0.2, 0.3, -1),
			fwd: n(0, -1, -0.3),
			cUp: n(0.25, 0.5, -1),
			look: n(0.2, 0.6, -1),
			hR: at("wrR", [0.02, 0.03, 0]),
			hL: at("elR", [0.0, 0.06, 0.03]),
			fL: [-0.12, 0.07, 0.88],
			fR: [0.38, 0.07, 0.9],
			kL: n(-0.2, -1, -0.6),
			kR: n(0.2, -1, -0.6),
			tL: n(0, -0.3, 1),
			tR: n(0, -0.3, 1),
			eL: n(-1, 0.3, 0),
			eR: n(1, 0.5, 0),
		},
		bottom: SUPINE({
			fwd: n(-0.05, 1, 0.35),
			hR: [0.05, 0.3, -0.3],
			hL: at("hipL", [0, -0.03, 0.07]),
			eR: n(0.5, 0.2, -1),
			eL: n(0, -1, 1),
		}),
	},
	rnc: {
		top: {
			p: [-0.19, 0.14, 0],
			up: n(-0.5, 1, 0),
			fwd: n(1, 0.5, 0),
			cUp: n(-0.25, 1, 0),
			look: n(0.15, 1, 0.25),
			hR: at("neck", [0.07, -0.02, -0.12]),
			hL: at("head", [-0.08, 0.02, 0.0]),
			fL: [0.38, 0.2, -0.25],
			fR: [0.38, 0.2, 0.25],
			kL: n(0, 0.7, -1),
			kR: n(0, 0.7, 1),
			tL: n(1, 0, 0.3),
			tR: n(1, 0, -0.3),
			eR: n(0.3, -0.6, 1),
			eL: n(-0.3, 0.6, -1),
		},
		bottom: {
			p: [0.16, 0.15, 0],
			up: n(-0.4, 1, 0),
			fwd: n(1, 0.4, 0),
			cUp: n(-0.3, 1, 0),
			look: n(0.2, 1, 0),
			hL: at("wrR", [0.03, -0.02, 0.0]),
			hR: at("elR", [0.03, -0.02, 0.0]),
			fL: [0.88, 0.07, -0.2],
			fR: [0.88, 0.07, 0.2],
			kL: n(0.3, 1, -0.1),
			kR: n(0.3, 1, 0.1),
			eL: n(0.4, -1, -0.5),
			eR: n(0.4, -1, 0.5),
		},
	},
};

export const INTRO_POSE: PairPose = { top: INTRO, bottom: rot180(INTRO) };

/** A telegraph: how the attacker (and sometimes the defender) shifts before the window. */
export interface Tell {
	/** Pelvis offset, pair space (applied for the attacker's actual role). */
	dp?: V;
	up?: V;
	cUp?: V;
	hL?: Target;
	hR?: Target;
	fL?: Target;
	fR?: Target;
	kL?: V;
	kR?: V;
}

export const TELLS: Record<string, Tell> = {
	// standing (authored for the -x player; mirrored for the other)
	levelChange: {
		dp: [0.06, -0.24, 0],
		up: n(0.7, 1, 0),
		cUp: n(0.9, 1, 0),
		fL: [-0.12, 0.07, -0.2],
	},
	reapLeg: {
		dp: [0.08, 0, 0.06],
		up: n(0.1, 1, 0.1),
		fR: [0.1, 0.28, 0.2],
		kR: n(1, 0.3, 0.3),
	},
	sitBack: { dp: [-0.1, -0.2, 0], up: n(-0.25, 1, 0), cUp: n(-0.1, 1, 0) },
	// guard top
	standUp: { dp: [-0.06, 0.18, 0], up: n(0, 1, 0), cUp: n(0, 1, 0) },
	stack: { dp: [0.12, 0.06, 0], up: n(0.6, 1, 0), cUp: n(0.9, 1, 0) },
	// guard bottom
	scissor: { dp: [0, 0.03, 0.1], kR: n(0.4, 1, -0.4), fR: [-0.55, 0.42, -0.3] },
	hipUp: { dp: [-0.05, 0.12, 0.05], up: n(1, 0.5, 0.2) },
	legShoot: { dp: [0, 0.08, -0.06], fL: [-0.25, 0.85, -0.25] },
	// half guard
	kneeSlide: { dp: [-0.05, 0.05, -0.08], fR: [-0.35, 0.08, 0.28] },
	figureFour: { dp: [0.04, 0.06, 0.04], cUp: n(1, 0.3, -0.5) },
	underhook: {
		dp: [-0.03, 0.08, 0.1],
		up: n(1, 0.4, 0.3),
		cUp: n(1, 0.5, 0.4),
	},
	kneeIn: { kL: n(0.3, 1, -0.4), fL: [-0.3, 0.3, -0.05] },
	duckUnder: { dp: [-0.12, 0.08, 0.15], up: n(0.7, 0.5, 0.5) },
	// side control / knee on belly
	stepOver: { dp: [0, 0.12, -0.05], fL: [0.05, 0.3, 0.3] },
	kneeUp: { dp: [0, 0.18, 0.05], up: n(0.2, 0.7, -1) },
	shrimp: { dp: [-0.1, 0.03, -0.14], up: n(1, 0.1, -0.35) },
	legPummel: {
		dp: [-0.06, 0.06, -0.08],
		fL: [-0.35, 0.4, 0.15],
		kL: n(0.2, 1, 0),
	},
	spinArm: { dp: [0.06, 0.1, 0], cUp: n(0.6, 1, -0.3) },
	// mount
	sitHigh: { dp: [0.12, 0.06, 0], up: n(0, 1, 0) },
	bridge: { dp: [0, 0.2, 0], up: n(1, 0.35, 0) },
	// back
	armUnder: { cUp: n(0.1, 1, 0.1), hR: { a: "neck", o: [0.08, -0.03, -0.06] } },
	turnIn: { dp: [0, 0.05, 0.08], up: n(-0.2, 1, 0.35) },
	shoulderWalk: { dp: [-0.06, -0.06, 0.1], up: n(-0.8, 1, 0) },
};

/**
 * How a transition travels: the body that ends on top arcs over (metres of lift at the
 * middle of the blend). Moves not listed use a small default.
 */
export const ARCS: Record<string, number> = {
	doubleLeg: 0.15,
	osoto: 0.2,
	pullGuard: 0.15,
	scissor: 0.2,
	underhook: 0.18,
	backTake: 0.15,
	upa: 0.22,
	turnInB: 0.18,
	stackPass: 0.1,
	kneeCut: 0.1,
	mountStep: 0.12,
	kobMount: 0.15,
	takeBackM: 0.15,
	slideOut: 0.2,
};
