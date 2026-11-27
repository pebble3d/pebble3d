/**
 * Drives the two mannequins from the sim: picks the keyed pose for the position and roles,
 * leans the attacker into the move's telegraph, blends position changes with an arc
 * (the body that ends on top travels over) plus overshoot and settle, adds breathing, and
 * resolves contacts so the bodies never pass through each other.
 */
import { MOVES, type MoveRef, POSITIONS } from "../graph.ts";
import { ACT, type MatchSim, PHASE } from "../sim.ts";
import {
	frameVec,
	type JointName,
	norm,
	resolveContacts,
	resolveTarget,
	Solved,
	type Spec,
	solveLimbsWith,
	solveTorso,
	type Target,
	type V,
} from "./body.ts";
import {
	ARCS,
	INTRO_POSE,
	type PairPose,
	POSES,
	rot180,
	TELLS,
	type Tell,
} from "./poses.ts";

const TORSO = 36;
const VEC_KEYS = [
	"p",
	"up",
	"fwd",
	"cUp",
	"cFwd",
	"look",
	"eL",
	"eR",
	"kL",
	"kR",
	"tL",
	"tR",
] as const;
const LIMB_KEYS = ["hL", "hR", "fL", "fR"] as const;

/** Flattens a spec's torso vectors (filling defaults) into `out` (36 numbers). */
function flatten(s: Spec, out: Float64Array, toePerp: Uint8Array): void {
	const put = (i: number, v: V): void => {
		out[i * 3] = v[0];
		out[i * 3 + 1] = v[1];
		out[i * 3 + 2] = v[2];
	};
	put(0, s.p);
	put(1, s.up);
	put(2, s.fwd);
	const cUp = s.cUp ?? s.up;
	const cFwd = s.cFwd ?? s.fwd;
	put(3, cUp);
	put(4, cFwd);
	put(5, s.look ?? cUp);
	// default elbow pole: down along the chest, a bit outward; knees: forward
	const cr: V = [
		cFwd[1] * cUp[2] - cFwd[2] * cUp[1],
		cFwd[2] * cUp[0] - cFwd[0] * cUp[2],
		cFwd[0] * cUp[1] - cFwd[1] * cUp[0],
	];
	const el = (side: number): V => [
		-cUp[0] * 0.8 + cr[0] * side * 0.45 - cFwd[0] * 0.2,
		-cUp[1] * 0.8 + cr[1] * side * 0.45 - cFwd[1] * 0.2,
		-cUp[2] * 0.8 + cr[2] * side * 0.45 - cFwd[2] * 0.2,
	];
	put(6, s.eL ?? el(-1));
	put(7, s.eR ?? el(1));
	put(8, s.kL ?? s.fwd);
	put(9, s.kR ?? s.fwd);
	toePerp[0] = s.tL ? 0 : 1;
	toePerp[1] = s.tR ? 0 : 1;
	put(10, s.tL ?? s.kL ?? s.fwd);
	put(11, s.tR ?? s.kR ?? s.fwd);
}

/** A mutable spec whose vectors are views of a flat torso array. */
class LiveSpec {
	readonly flat = new Float64Array(TORSO);
	readonly toePerp = new Uint8Array(2);
	readonly spec: Spec;
	constructor() {
		const v = (): V => [0, 0, 0];
		this.spec = {
			p: v(),
			up: v(),
			fwd: v(),
			cUp: v(),
			cFwd: v(),
			look: v(),
			eL: v(),
			eR: v(),
			kL: v(),
			kR: v(),
			tL: v(),
			tR: v(),
			hL: v(),
			hR: v(),
			fL: v(),
			fR: v(),
		};
	}
	/** Writes the flat array back into the spec's vectors. */
	sync(): Spec {
		const s = this.spec as unknown as Record<string, V | undefined>;
		for (let i = 0; i < VEC_KEYS.length; i++) {
			const key = VEC_KEYS[i] as string;
			let vec = s[key];
			if (!vec) {
				vec = [0, 0, 0];
				s[key] = vec;
			}
			vec[0] = this.flat[i * 3] as number;
			vec[1] = this.flat[i * 3 + 1] as number;
			vec[2] = this.flat[i * 3 + 2] as number;
		}
		if (this.toePerp[0]) s.tL = undefined;
		if (this.toePerp[1]) s.tR = undefined;
		return this.spec;
	}
}

const ease = (t: number): number =>
	t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
/** Ease with a little overshoot past 1 before settling (the "settle"). */
function settleEase(t: number): number {
	if (t >= 1) return 1;
	const c1 = 1.25;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

/** Blend seconds per move kind: throws and sweeps travel further than a pass. */
const TRANS_SEC: Record<string, number> = {
	takedown: 0.95,
	sweep: 0.9,
	reversal: 0.9,
	pull: 0.8,
	sub: 0.75,
};
const TRANS_DEFAULT = 0.65;

/** Seconds the blend into a move's target position takes. */
export function transitionSeconds(moveIndex: number): number {
	const mr = MOVES[moveIndex];
	return mr ? (TRANS_SEC[mr.def.kind] ?? TRANS_DEFAULT) : TRANS_DEFAULT;
}
const _t: V = [0, 0, 0];
const _u: V = [0, 0, 0];

export class Rig {
	readonly sol: [Solved, Solved] = [new Solved(), new Solved()];
	/** Displayed torso + targets per body (what is on screen now). */
	private readonly disp = [new LiveSpec(), new LiveSpec()];
	private readonly dispTg: V[][] = [
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
	/** Transition snapshot. */
	private readonly snap = [new Float64Array(TORSO), new Float64Array(TORSO)];
	private readonly snapTg: V[][] = [
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
	private readonly goal = [new LiveSpec(), new LiveSpec()];
	private readonly tellFlat = new Float64Array(TORSO);
	private readonly tellToe = new Uint8Array(2);
	private readonly tg: V[] = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	];
	private transT = 1;
	private transLift = 0;
	private transUpper = 0;
	private transSec = TRANS_DEFAULT;
	private lastTrans = -999;
	private lastKey = "";
	private time = 0;
	private started = false;
	/** Decaying per-body pelvis kicks (recoil, thud) and a struggle jitter. */
	readonly kick = [new Float64Array(3), new Float64Array(3)];
	/** Tension 0..1 for the submission squeeze look. */
	tension = 0;
	tapping = false;

	/** Pose key for a frozen gallery/title view instead of the sim. */
	frozen: { pose: PairPose; top: number } | null = null;

	/** Adds a pelvis impulse to body `p` (pair space, metres), decays over ~0.3 s. */
	punch(p: number, x: number, y: number, z: number): void {
		const k = this.kick[p] as Float64Array;
		k[0] = (k[0] as number) + x;
		k[1] = (k[1] as number) + y;
		k[2] = (k[2] as number) + z;
	}

	update(sim: MatchSim | null, dt: number): void {
		this.time += dt;
		let pp: PairPose;
		let top = 0;
		let key: string;
		if (this.frozen) {
			pp = this.frozen.pose;
			top = this.frozen.top;
			key = `frozen`;
		} else if (!sim || sim.phase === PHASE.INTRO) {
			pp = INTRO_POSE;
			key = "intro";
		} else {
			pp = POSES[(POSITIONS[sim.pos] as { id: keyof typeof POSES }).id];
			top = sim.top;
			key = `${sim.pos}:${sim.top}`;
		}
		// new position: snapshot what is on screen and start a blend
		const transTick = sim && !this.frozen ? sim.transTick : -1;
		if (
			this.started &&
			(key !== this.lastKey || transTick !== this.lastTrans)
		) {
			for (let p = 0; p < 2; p++) {
				(this.snap[p] as Float64Array).set((this.disp[p] as LiveSpec).flat);
				for (let l = 0; l < 4; l++) {
					const s = (this.snapTg[p] as V[])[l] as V;
					const d = (this.dispTg[p] as V[])[l] as V;
					s[0] = d[0];
					s[1] = d[1];
					s[2] = d[2];
				}
			}
			this.transT = 0;
			const mv =
				sim && sim.lastMove >= 0 ? (MOVES[sim.lastMove] as MoveRef).def.id : "";
			this.transLift =
				key === "intro" || this.lastKey === "intro" ? 0 : (ARCS[mv] ?? 0.12);
			this.transUpper = top;
			this.transSec = mv
				? (TRANS_SEC[(MOVES[(sim as MatchSim).lastMove] as MoveRef).def.kind] ??
					TRANS_DEFAULT)
				: 0.9;
		}
		this.lastKey = key;
		this.lastTrans = transTick;
		const T = this.transT;
		this.transT = Math.min(1, this.transT + dt / this.transSec);

		// goal torso per body: base pose, telegraph, breathing
		for (let p = 0; p < 2; p++) {
			const g = this.goal[p] as LiveSpec;
			const spec = p === top ? pp.top : pp.bottom;
			flatten(spec, g.flat, g.toePerp);
			if (sim && !this.frozen && sim.act !== ACT.IDLE && sim.actor === p) {
				const tell = this.tellFor(sim);
				if (tell) {
					const w =
						sim.act === ACT.TELEGRAPH
							? ease(Math.min(1, sim.actT / Math.max(1, sim.telDur)))
							: 1;
					// a hint of anticipation: pull back slightly before committing
					const anti =
						sim.act === ACT.TELEGRAPH && w < 0.25
							? Math.sin((w / 0.25) * Math.PI) * 0.15
							: 0;
					this.applyTell(g, tell, w - anti, this.mirrorTell(sim, p));
				}
			}
			// breathing: chest rises; heavier when gassed
			const gas = sim ? (sim.gas[p] as number) : 1;
			const held = sim && !this.frozen ? (sim.held[p] as number) : 0;
			// K breathe: big, slow breaths; L posture: hips sink, chest upright
			const breathing = (held & 32) !== 0;
			const rate = breathing ? 2.2 : 1.6 + (1 - gas) * 2.4;
			const amp = breathing ? 0.03 : 0.006 + (1 - gas) * 0.014;
			if ((held & 64) !== 0 && !breathing)
				g.flat[1] = (g.flat[1] as number) - 0.035;
			// J grip: a small pull back on the grips
			if ((held & 16) !== 0 && !breathing && sim && sim.act === ACT.IDLE)
				g.flat[10] = (g.flat[10] as number) + 0.03;
			const b = Math.sin(this.time * rate + p * 1.7) * amp;
			g.flat[1] = (g.flat[1] as number) + b * 0.6;
			g.flat[9] = (g.flat[9] as number) + b * 2;
			const k = this.kick[p] as Float64Array;
			g.flat[0] = (g.flat[0] as number) + (k[0] as number);
			g.flat[1] = (g.flat[1] as number) + (k[1] as number);
			g.flat[2] = (g.flat[2] as number) + (k[2] as number);
			const decay = Math.exp(-dt * 9);
			k[0] = (k[0] as number) * decay;
			k[1] = (k[1] as number) * decay;
			k[2] = (k[2] as number) * decay;
		}
		// the finisher squeezes: arches with tension
		if (sim && !this.frozen && sim.isSub()) {
			const a = this.goal[sim.top] as LiveSpec;
			// hips lift into the lock as the squeeze builds (the armbar most of all)
			const lift = sim.position.id === "armbar" ? 0.12 : 0.04;
			a.flat[1] = (a.flat[1] as number) + this.tension * lift;
			const d = this.goal[1 - sim.top] as LiveSpec;
			d.flat[10] = (d.flat[10] as number) - this.tension * 0.15;
		}

		// blend from the snapshot
		const w = this.started ? settleEase(T) : 1;
		const lift = this.transLift * Math.sin(Math.min(1, T) * Math.PI);
		for (let p = 0; p < 2; p++) {
			const dsp = this.disp[p] as LiveSpec;
			const g = this.goal[p] as LiveSpec;
			const s = this.snap[p] as Float64Array;
			for (let i = 0; i < TORSO; i++)
				dsp.flat[i] = this.started
					? (s[i] as number) + ((g.flat[i] as number) - (s[i] as number)) * w
					: (g.flat[i] as number);
			dsp.toePerp.set(g.toePerp);
			if (p === this.transUpper) dsp.flat[1] = (dsp.flat[1] as number) + lift;
			for (let v = 1; v < 12; v++) {
				_t[0] = dsp.flat[v * 3] as number;
				_t[1] = dsp.flat[v * 3 + 1] as number;
				_t[2] = dsp.flat[v * 3 + 2] as number;
				norm(_t);
				dsp.flat[v * 3] = _t[0];
				dsp.flat[v * 3 + 1] = _t[1];
				dsp.flat[v * 3 + 2] = _t[2];
			}
			solveTorso(dsp.sync(), this.sol[p] as Solved);
		}
		// targets: resolve the goal's anchors against the displayed partner, then blend
		for (let p = 0; p < 2; p++) {
			const spec = p === top ? pp.top : pp.bottom;
			const me = this.sol[p] as Solved;
			const other = this.sol[1 - p] as Solved;
			const tell =
				sim && !this.frozen && sim.act !== ACT.IDLE && sim.actor === p
					? this.tellFor(sim)
					: null;
			const tw =
				tell && sim
					? sim.act === ACT.TELEGRAPH
						? ease(Math.min(1, sim.actT / Math.max(1, sim.telDur)))
						: 1
					: 0;
			const mirror = sim ? this.mirrorTell(sim, p) : false;
			for (let l = 0; l < 4; l++) {
				const key4 = LIMB_KEYS[l] as (typeof LIMB_KEYS)[number];
				const out = this.tg[l] as V;
				resolveTarget(spec[key4], me, other, out);
				const tt = tell?.[key4];
				if (tt && tw > 0) {
					resolveTarget(mirror ? mirrorTarget(tt) : tt, me, other, _u);
					out[0] = (out[0] as number) + (_u[0] - out[0]) * tw;
					out[1] = (out[1] as number) + (_u[1] - out[1]) * tw;
					out[2] = (out[2] as number) + (_u[2] - out[2]) * tw;
				}
				// tapping: the defender's free hand pats the partner three times a second
				if (this.tapping && sim && p !== sim.top && l === 0) {
					resolveTarget(
						{
							a: "hipL",
							o: [0, 0.12 + Math.abs(Math.sin(this.time * 10)) * 0.1, 0],
						},
						me,
						other,
						out,
					);
				}
				const d = (this.dispTg[p] as V[])[l] as V;
				const s = (this.snapTg[p] as V[])[l] as V;
				if (this.started) {
					d[0] = s[0] + (out[0] - s[0]) * w;
					d[1] = s[1] + (out[1] - s[1]) * w;
					d[2] = s[2] + (out[2] - s[2]) * w;
				} else {
					d[0] = out[0];
					d[1] = out[1];
					d[2] = out[2];
				}
				if (d[1] < 0.05) d[1] = 0.05;
			}
		}
		for (let p = 0; p < 2; p++)
			solveLimbsWith(
				(this.disp[p] as LiveSpec).spec,
				this.dispTg[p] as V[],
				this.sol[p] as Solved,
			);
		// limb anchors on partner limbs were read from last frame: one more pass settles them
		resolveContacts(
			[(this.disp[0] as LiveSpec).spec, (this.disp[1] as LiveSpec).spec],
			this.sol,
			this.dispTg,
			2,
		);
		this.started = true;
	}

	/** Pair centre (between the pelvises) for the camera. */
	centre(out: V): V {
		const a = this.sol[0] as Solved;
		const b = this.sol[1] as Solved;
		out[0] = ((a.j[0] as number) + (b.j[0] as number)) * 0.5;
		out[1] = ((a.j[1] as number) + (b.j[1] as number)) * 0.5;
		out[2] = ((a.j[2] as number) + (b.j[2] as number)) * 0.5;
		return out;
	}

	/** Head position of body p (for HUD labels). */
	head(p: number, out: V): V {
		return (this.sol[p] as Solved).get("head", out);
	}

	private tellFor(sim: MatchSim): Tell | null {
		const mr = sim.moveRef();
		return mr ? (TELLS[mr.def.tell] ?? null) : null;
	}

	/** Standing tells are authored for the body on the -x side. */
	private mirrorTell(sim: MatchSim, p: number): boolean {
		return sim.pos === 0 && p !== sim.top;
	}

	private applyTell(g: LiveSpec, t: Tell, w: number, mirror: boolean): void {
		const tf = this.tellFlat;
		tf.set(g.flat);
		const r = (v: V): V => {
			if (!mirror) return v;
			_mv[0] = -v[0];
			_mv[1] = v[1];
			_mv[2] = -v[2];
			return _mv;
		};
		if (t.dp) {
			const d = r(t.dp);
			tf[0] = (tf[0] as number) + d[0];
			tf[1] = (tf[1] as number) + d[1];
			tf[2] = (tf[2] as number) + d[2];
		}
		const setv = (i: number, v: V | undefined): void => {
			if (!v) return;
			const q = r(v);
			tf[i * 3] = q[0];
			tf[i * 3 + 1] = q[1];
			tf[i * 3 + 2] = q[2];
		};
		setv(1, t.up);
		setv(3, t.cUp);
		setv(8, t.kL);
		setv(9, t.kR);
		void this.tellToe;
		for (let i = 0; i < TORSO; i++)
			g.flat[i] =
				(g.flat[i] as number) + ((tf[i] as number) - (g.flat[i] as number)) * w;
	}

	/** Frame vector of a solved body (for effects). */
	frame(p: number, i: number, out: V): V {
		return frameVec(this.sol[p] as Solved, i, out);
	}
}

const _mv: V = [0, 0, 0];
const _mo: V = [0, 0, 0];
const _mt: { a: JointName; o: V; self?: boolean } = { a: "chest", o: _mo };
/** Mirrors a target through 180° about y into scratch storage (no allocation). */
function mirrorTarget(t: Target): Target {
	if (Array.isArray(t)) {
		_mv[0] = -t[0];
		_mv[1] = t[1];
		_mv[2] = -t[2];
		return _mv;
	}
	_mt.a = t.a;
	_mt.self = t.self;
	_mo[0] = t.o ? -t.o[0] : 0;
	_mo[1] = t.o ? t.o[1] : 0;
	_mo[2] = t.o ? -t.o[2] : 0;
	return _mt;
}

export { rot180 };
