/**
 * Flowroll's match sim: a deterministic fixed-tick (60 Hz) state machine over the position
 * graph in graph.ts. No physics, no wall clock, no Math.random: the state is a pure function
 * of the config and the per-tick input bytes (input.ts), so a replay of the input log
 * reproduces `hash()` exactly. The renderer only reads this object.
 *
 * One exchange: a player launches a move (direction key, grip permitting) → TELEGRAPH (their
 * posture shifts; the defender may already counter: an early read) → WINDOW (a shrinking
 * ring; the attacker presses J on the beat; the move name is revealed) → resolve: attack
 * strength (grip, beat timing, gas) against defence (correct counter, read timing, grip, gas).
 * Submissions open a tension contest: the attacker holds J to squeeze (burning gas), the
 * defender times the escape key on each beat.
 */
import {
	correctCounter,
	counterIndex,
	DIRS,
	type Dir,
	MOVES,
	type MoveRef,
	moveIndex,
	POS_INDEX,
	POSITIONS,
	type PositionDef,
	type Role,
} from "./graph.ts";
import { DIR_BITS, IN } from "./input.ts";

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const PHASE = { INTRO: 0, LIVE: 1, OVER: 2 } as const;
export const PHASE_NAMES = ["intro", "live", "over"] as const;
export const ACT = { IDLE: 0, TELEGRAPH: 1, WINDOW: 2 } as const;

/** Every tunable number in one place (README "Sourced numbers" explains the rules ones). */
export const TUNE = {
	introTicks: 120,
	roundTicks: 180 * TICK_HZ,
	window: 36,
	/** Tick inside the window where the ring meets the target. */
	beat: 26,
	beatHalf: 14,
	settle: 40,
	recover: 42,
	momentum: 180,
	gripGain: 0.55,
	gripDecay: 0.12,
	breatheGripDecay: 0.8,
	gripGas: 0.04,
	gasRegen: 0.06,
	breatheRegen: 0.17,
	postureGas: 0.02,
	crushedGas: 0.015,
	stallTicks: 5 * TICK_HZ,
	nearMiss: 0.06,
	// submissions
	subStart: 0.3,
	squeeze: 0.33,
	squeezeGas: 0.07,
	slack: 0.1,
	slip: 0.3,
	subBeatEvery: 42,
	subBeatHalf: 9,
	escapeRelief: 0.09,
	escapeGain: 0.24,
	panic: 0.05,
} as const;

export const EV = {
	START: 0,
	LAUNCH: 1,
	REVEAL: 2,
	BEAT: 3,
	COUNTER_PICK: 4,
	SUCCESS: 5,
	STUFFED: 6,
	NEAR: 7,
	WRONG: 8,
	SUB_START: 9,
	SUB_BEAT: 10,
	SUB_PANIC: 11,
	ESCAPE: 12,
	TAP: 13,
	STALL: 14,
	TIME: 15,
	RELEASE: 16,
	SUB_PULSE: 17,
} as const;

export interface SimConfig {
	seed: number;
	/** Live ticks; 0 = untimed (tutorial). */
	roundTicks?: number;
	introTicks?: number;
}

export interface Segment {
	tick: number;
	pos: number;
	top: number;
}
export interface ScoreMark {
	tick: number;
	player: number;
	points: number;
	adv: number;
	label: string;
}

const EV_CAP = 16;
const gf = (g: number): number => 0.55 + 0.45 * g;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export class MatchSim {
	readonly seed: number;
	readonly roundTicks: number;
	readonly introTicks: number;
	tick = 0;
	phase: number = PHASE.INTRO;
	/** Ticks of live time elapsed. */
	liveTick = 0;
	pos = POS_INDEX.standing;
	/** Which player holds the "top" role (standing: arbitrary, 0). */
	top = 0;
	readonly grip = new Float64Array(2);
	readonly gas = new Float64Array([1, 1]);
	readonly points = new Int32Array(2);
	readonly adv = new Int32Array(2);
	readonly stall = new Int32Array(2);
	readonly recover = new Int32Array(2);
	readonly momentum = new Int32Array(2);
	/** Ticks each player spent in a dominant role (referee decision on a full tie). */
	readonly control = new Int32Array(2);
	readonly held = new Uint8Array(2);
	readonly prev = new Uint8Array(2);
	settle = 0;
	// the exchange in progress
	act: number = ACT.IDLE;
	actor = -1;
	move = -1;
	actT = 0;
	telDur = 0;
	/** Attacker's beat grade (0..1), -1 until pressed. */
	grade = -1;
	/** Defender's counter (index into their role's counters), -1 none. */
	counter = -1;
	/** Read quality of the defender's counter (1 = during the telegraph). */
	read = 0;
	counterT = -1;
	// submission contest
	tension = 0;
	escape = 0;
	subMove = -1;
	subT = 0;
	subBeatTaken = false;
	/** Last resolved exchange for presentation: move, actor, outcome (1 ok, 0 stuffed). */
	lastMove = -1;
	lastActor = -1;
	lastOk = 0;
	lastTick = -1;
	/** Previous position/top before the last transition (the renderer blends from it). */
	fromPos = POS_INDEX.standing;
	fromTop = 0;
	transTick = -100;
	winner = -1;
	method = "";
	readonly timeline: Segment[] = [];
	readonly marks: ScoreMark[] = [];
	// events this tick
	evN = 0;
	readonly evType = new Int8Array(EV_CAP);
	readonly evA = new Int16Array(EV_CAP);
	readonly evB = new Int16Array(EV_CAP);
	readonly evV = new Float64Array(EV_CAP);

	constructor(cfg: SimConfig) {
		this.seed = cfg.seed >>> 0;
		this.roundTicks = cfg.roundTicks ?? TUNE.roundTicks;
		this.introTicks = cfg.introTicks ?? TUNE.introTicks;
		this.timeline.push({ tick: 0, pos: this.pos, top: 0 });
	}

	// ---------- queries ----------

	get position(): PositionDef {
		return POSITIONS[this.pos] as PositionDef;
	}
	roleOf(p: number): Role {
		return p === this.top ? "top" : "bottom";
	}
	isSub(): boolean {
		return this.position.kind === "sub";
	}
	/** Live seconds left (or elapsed when untimed). */
	clock(): number {
		if (this.roundTicks === 0) return this.liveTick / TICK_HZ;
		return Math.max(0, this.roundTicks - this.liveTick) / TICK_HZ;
	}
	moveRef(): MoveRef | null {
		return this.move >= 0 ? (MOVES[this.move] as MoveRef) : null;
	}
	/** 0..1 progress of the window ring (1 = just opened, beat at ring = 0). */
	ringT(): number {
		if (this.act !== ACT.WINDOW) return 1;
		return 1 - this.actT / TUNE.beat;
	}
	/** Ticks to the next submission beat. */
	subBeatIn(): number {
		const k = this.subT % TUNE.subBeatEvery;
		return k === 0 ? 0 : TUNE.subBeatEvery - k;
	}
	canLaunch(p: number): boolean {
		return (
			this.phase === PHASE.LIVE &&
			this.act === ACT.IDLE &&
			this.settle === 0 &&
			!this.isSub() &&
			(this.recover[p] as number) === 0
		);
	}
	/** Defender role for the exchange in progress. */
	private defRole(): Role {
		if (this.pos === POS_INDEX.standing) return "top";
		return this.roleOf(1 - this.actor);
	}

	// ---------- step ----------

	step(in0: number, in1: number): void {
		this.evN = 0;
		this.prev[0] = this.held[0] as number;
		this.prev[1] = this.held[1] as number;
		this.held[0] = in0;
		this.held[1] = in1;
		this.tick++;
		if (this.phase === PHASE.OVER) return;
		if (this.phase === PHASE.INTRO) {
			if (this.tick >= this.introTicks) {
				this.phase = PHASE.LIVE;
				this.emit(EV.START, -1, -1, 0);
			}
			return;
		}
		this.liveTick++;
		if (this.settle > 0) this.settle--;
		for (let p = 0; p < 2; p++) {
			if ((this.recover[p] as number) > 0)
				this.recover[p] = (this.recover[p] as number) - 1;
			if ((this.momentum[p] as number) > 0)
				this.momentum[p] = (this.momentum[p] as number) - 1;
		}
		this.trackControl();
		if (this.isSub()) this.stepSub();
		else {
			this.stepBodies();
			this.stepExchange();
		}
		if (
			this.phase === PHASE.LIVE &&
			this.roundTicks > 0 &&
			this.liveTick >= this.roundTicks
		)
			this.timeUp();
	}

	private pressed(p: number, bit: number): boolean {
		return (
			((this.held[p] as number) & bit) !== 0 &&
			((this.prev[p] as number) & bit) === 0
		);
	}
	private holding(p: number, bit: number): boolean {
		return ((this.held[p] as number) & bit) !== 0;
	}
	private pressedDir(p: number): Dir | null {
		for (let k = 0; k < 4; k++)
			if (this.pressed(p, DIR_BITS[k] as number)) return DIRS[k] as Dir;
		return null;
	}

	private trackControl(): void {
		const id = this.position.id;
		if (id === "standing" || id === "closedGuard" || id === "halfGuard") return;
		this.control[this.top] = (this.control[this.top] as number) + 1;
	}

	/** Grip, gas, posture and stalling while no submission is on. */
	private stepBodies(): void {
		const T = TUNE;
		for (let p = 0; p < 2; p++) {
			const o = 1 - p;
			const breathing = this.holding(p, IN.BREATHE);
			const posture = this.holding(p, IN.POSTURE) && !breathing;
			const gripping =
				this.holding(p, IN.GRIP) && !breathing && !this.inMyWindow(p);
			let g = this.grip[p] as number;
			let gas = this.gas[p] as number;
			if (breathing) {
				g -= T.breatheGripDecay * DT;
				gas += T.breatheRegen * DT;
			} else if (gripping) {
				const opPost = this.holding(o, IN.POSTURE) ? 0.6 : 1;
				g += T.gripGain * (0.45 + 0.55 * gas) * opPost * DT;
				gas -= T.gripGas * DT;
			} else {
				g -= T.gripDecay * DT;
				gas += T.gasRegen * DT;
			}
			if (posture) gas -= T.postureGas * DT;
			// being pinned under a dominant position is tiring
			const id = this.position.id;
			if (
				p !== this.top &&
				(id === "sideControl" ||
					id === "mount" ||
					id === "back" ||
					id === "kneeOnBelly")
			)
				gas -= T.crushedGas * DT;
			this.grip[p] = clamp01(g);
			this.gas[p] = clamp01(gas);
			// stalling: posture held with no exchange of your own
			// stalling: posture held while no exchange is in progress at all
			if (posture && this.actor < 0) {
				this.stall[p] = (this.stall[p] as number) + 1;
				if ((this.stall[p] as number) >= T.stallTicks) {
					this.stall[p] = 0;
					this.adv[o] = (this.adv[o] as number) + 1;
					this.mark(o, 0, 1, "Stalling");
					this.emit(EV.STALL, p, o, 0);
				}
			} else if (!posture && (this.stall[p] as number) > 0)
				this.stall[p] = (this.stall[p] as number) - 1;
		}
	}

	private inMyWindow(p: number): boolean {
		return this.act !== ACT.IDLE && this.actor === p;
	}

	private stepExchange(): void {
		const T = TUNE;
		if (this.act === ACT.IDLE) {
			// launches: a direction press with grip enough; first come, ties to more grip
			let best = -1;
			let bestMove = -1;
			for (let p = 0; p < 2; p++) {
				if (!this.canLaunch(p)) continue;
				if (this.holding(p, IN.BREATHE)) continue;
				const d = this.pressedDir(p);
				if (!d) continue;
				const mi = moveIndex(this.pos, this.roleOf(p), d);
				if (mi < 0) continue;
				const def = (MOVES[mi] as MoveRef).def;
				if ((this.grip[p] as number) < def.grip) continue;
				if (
					best < 0 ||
					(this.grip[p] as number) > (this.grip[best] as number) ||
					((this.grip[p] as number) === (this.grip[best] as number) &&
						(this.tick & 1) === p)
				) {
					best = p;
					bestMove = mi;
				}
			}
			if (best >= 0) this.launch(best, bestMove);
			return;
		}
		this.actT++;
		const a = this.actor;
		const d = 1 - a;
		// attacker beat press
		if (this.grade < 0 && this.pressed(a, IN.GRIP)) {
			if (this.act === ACT.TELEGRAPH) this.grade = 0.15;
			else
				this.grade = Math.max(0, 1 - Math.abs(this.actT - T.beat) / T.beatHalf);
			this.emit(EV.BEAT, a, -1, this.grade);
		}
		// defender counter: first direction press locks it
		if (this.counter < 0) {
			const dir = this.pressedDir(d);
			if (dir) {
				const ci = counterIndex(this.pos, this.defRole(), dir);
				if (ci >= 0) {
					this.counter = ci;
					this.counterT = this.tick;
					this.read =
						this.act === ACT.TELEGRAPH ? 1 : 0.7 - 0.4 * (this.actT / T.window);
					this.emit(EV.COUNTER_PICK, d, ci, this.read);
				}
			}
		}
		if (this.act === ACT.TELEGRAPH && this.actT >= this.telDur) {
			this.act = ACT.WINDOW;
			this.actT = 0;
			this.emit(EV.REVEAL, a, this.move, 0);
		} else if (this.act === ACT.WINDOW && this.actT >= T.window) this.resolve();
	}

	private launch(p: number, mi: number): void {
		const def = (MOVES[mi] as MoveRef).def;
		this.act = ACT.TELEGRAPH;
		this.actor = p;
		this.move = mi;
		this.actT = 0;
		const gas = this.gas[p] as number;
		let tel = def.telegraph * (1 + 0.5 * (1 - gas));
		if ((this.momentum[p] as number) > 0) tel *= 0.75;
		this.telDur = Math.round(tel);
		this.grade = -1;
		this.counter = -1;
		this.counterT = -1;
		this.read = 0;
		this.gas[p] = clamp01(gas - def.gas);
		this.stall[p] = 0;
		this.emit(EV.LAUNCH, p, mi, 0);
	}

	/** Attack and defence strengths for the exchange in progress (exposed for tests/HUD). */
	strengths(): { atk: number; def: number; correct: boolean } {
		const a = this.actor;
		const d = 1 - a;
		const grade = Math.max(0, this.grade);
		let atk =
			(0.3 + 0.32 * (this.grip[a] as number) + 0.38 * grade) *
			gf(this.gas[a] as number);
		if ((this.momentum[a] as number) > 0) atk += 0.06;
		const correct =
			this.counter >= 0 && this.counter === correctCounter(this.move);
		let def: number;
		if (correct)
			def =
				(0.42 + 0.28 * (this.grip[d] as number) + 0.3 * this.read) *
				gf(this.gas[d] as number);
		else if (this.counter >= 0) def = 0.12;
		else
			def =
				(0.22 + 0.2 * (this.grip[d] as number)) * gf(this.gas[d] as number) +
				(this.holding(d, IN.POSTURE) ? 0.12 : 0);
		return { atk, def, correct };
	}

	private resolve(): void {
		const T = TUNE;
		const a = this.actor;
		const d = 1 - a;
		const mi = this.move;
		const def = (MOVES[mi] as MoveRef).def;
		const s = this.strengths();
		this.lastMove = mi;
		this.lastActor = a;
		this.lastTick = this.tick;
		if (s.atk > s.def) {
			this.lastOk = 1;
			if (this.counter >= 0 && !s.correct) {
				this.gas[d] = clamp01((this.gas[d] as number) - 0.08);
				this.emit(EV.WRONG, d, this.counter, 0);
			}
			this.grip[a] = (this.grip[a] as number) * 0.5;
			this.momentum[a] = 0;
			if (def.kind === "sub") {
				this.transition(def.to, a, mi);
				this.tension = T.subStart + 0.1 * Math.max(0, this.grade);
				this.escape = 0;
				this.subMove = mi;
				this.subT = 0;
				this.subBeatTaken = false;
				this.emit(EV.SUB_START, a, mi, 0);
			} else {
				const newTop = def.as === "top" ? a : d;
				this.transition(def.to, newTop, mi);
				if (def.points > 0) {
					this.points[a] = (this.points[a] as number) + def.points;
					this.mark(a, def.points, 0, def.name);
				}
			}
			this.emit(EV.SUCCESS, a, mi, s.atk - s.def);
		} else {
			this.lastOk = 0;
			this.grip[a] = (this.grip[a] as number) * 0.3;
			this.recover[a] = T.recover;
			if (s.correct) this.momentum[d] = T.momentum;
			if (s.def - s.atk < T.nearMiss) {
				this.adv[a] = (this.adv[a] as number) + 1;
				this.mark(a, 0, 1, `${def.name} (almost)`);
				this.emit(EV.NEAR, a, mi, s.def - s.atk);
			}
			this.emit(EV.STUFFED, a, mi, s.def - s.atk);
			this.settle = 18;
		}
		this.act = ACT.IDLE;
		this.actor = -1;
		this.move = -1;
		this.actT = 0;
	}

	private transition(to: string, newTop: number, _mi: number): void {
		this.fromPos = this.pos;
		this.fromTop = this.top;
		this.transTick = this.tick;
		this.pos = POS_INDEX[to as keyof typeof POS_INDEX];
		this.top = newTop;
		this.settle = TUNE.settle;
		this.stall[0] = 0;
		this.stall[1] = 0;
		this.timeline.push({ tick: this.liveTick, pos: this.pos, top: newTop });
	}

	private stepSub(): void {
		const T = TUNE;
		const a = this.top;
		const d = 1 - a;
		this.subT++;
		if (this.settle > 0) return; // the lock is still going on
		const squeezing = this.holding(a, IN.GRIP);
		let ten = this.tension;
		if (squeezing && (this.gas[a] as number) > 0) {
			ten +=
				T.squeeze *
				(0.45 + 0.55 * (this.grip[a] as number)) *
				(0.35 + 0.65 * (this.gas[a] as number)) *
				DT;
			this.gas[a] = clamp01((this.gas[a] as number) - T.squeezeGas * DT);
			this.grip[a] = clamp01((this.grip[a] as number) - 0.03 * DT);
		} else {
			// an empty tank cannot hold the lock: it slips fast
			ten -= ((this.gas[a] as number) < 0.06 ? T.slip : T.slack) * DT;
			this.gas[a] = clamp01((this.gas[a] as number) + T.gasRegen * DT);
		}
		this.gas[d] = clamp01((this.gas[d] as number) - 0.01 * DT);
		// defender beats
		const k = this.subT % T.subBeatEvery;
		const off = k <= T.subBeatEvery / 2 ? k : k - T.subBeatEvery;
		if (k === 0) {
			this.subBeatTaken = false;
			this.emit(EV.SUB_PULSE, d, -1, 0);
		}
		const dir = this.pressedDir(d);
		if (dir) {
			const want = (this.position.escape as { dir: Dir }).dir;
			if (
				dir === want &&
				!this.subBeatTaken &&
				Math.abs(off) <= T.subBeatHalf
			) {
				const q = 1 - Math.abs(off) / (T.subBeatHalf + 1);
				const g = 0.5 + 0.5 * (this.gas[d] as number);
				ten -= T.escapeRelief * q * g;
				this.escape += T.escapeGain * q * g;
				this.gas[d] = clamp01((this.gas[d] as number) - 0.02);
				this.subBeatTaken = true;
				this.emit(EV.SUB_BEAT, d, -1, q);
			} else {
				ten += T.panic;
				this.gas[d] = clamp01((this.gas[d] as number) - 0.04);
				this.emit(EV.SUB_PANIC, d, -1, 0);
			}
		}
		this.tension = Math.max(0, Math.min(1, ten));
		if (this.tension >= 1) {
			this.winner = a;
			this.method = "Submission";
			this.phase = PHASE.OVER;
			this.emit(EV.TAP, d, this.subMove, 0);
			this.timeline.push({ tick: this.liveTick, pos: -1, top: a });
		} else if (this.escape >= 1 || this.tension <= 0) {
			const escaped = this.escape >= 1;
			const def = (MOVES[this.subMove] as MoveRef).def;
			const back = def.escapeTo as { pos: string; as: Role };
			if (escaped) {
				this.adv[a] = (this.adv[a] as number) + 1;
				this.mark(a, 0, 1, `${def.name} attempt`);
			}
			this.transition(back.pos, back.as === "top" ? a : d, this.subMove);
			this.lastMove = this.subMove;
			this.lastActor = a;
			this.lastOk = 0;
			this.lastTick = this.tick;
			this.recover[a] = TUNE.recover;
			this.emit(escaped ? EV.ESCAPE : EV.RELEASE, d, this.subMove, 0);
			this.subMove = -1;
			this.tension = 0;
			this.escape = 0;
		}
	}

	private timeUp(): void {
		this.phase = PHASE.OVER;
		const p = this.points;
		const v = this.adv;
		if (p[0] !== p[1]) {
			this.winner = (p[0] as number) > (p[1] as number) ? 0 : 1;
			this.method = "Points";
		} else if (v[0] !== v[1]) {
			this.winner = (v[0] as number) > (v[1] as number) ? 0 : 1;
			this.method = "Advantages";
		} else if (this.control[0] !== this.control[1]) {
			this.winner =
				(this.control[0] as number) > (this.control[1] as number) ? 0 : 1;
			this.method = "Referee decision";
		} else {
			this.winner = -1;
			this.method = "Draw";
		}
		this.timeline.push({ tick: this.liveTick, pos: -1, top: this.winner });
		this.emit(EV.TIME, this.winner, -1, 0);
	}

	private mark(
		player: number,
		points: number,
		adv: number,
		label: string,
	): void {
		this.marks.push({ tick: this.liveTick, player, points, adv, label });
	}

	private emit(type: number, a: number, b: number, v: number): void {
		if (this.evN >= EV_CAP) return;
		this.evType[this.evN] = type;
		this.evA[this.evN] = a;
		this.evB[this.evN] = b;
		this.evV[this.evN] = v;
		this.evN++;
	}

	/** FNV-1a over the whole match state (floats quantised), 16 hex digits. */
	hash(): string {
		let h1 = 0x811c9dc5;
		let h2 = 0x01000193 ^ this.seed;
		const mix = (x: number): void => {
			const v = Math.round(x * 1e6) | 0;
			h1 = Math.imul(h1 ^ v, 0x01000193) >>> 0;
			h2 = Math.imul(h2 ^ (v >>> 3) ^ h1, 0x5bd1e995) >>> 0;
		};
		mix(this.tick);
		mix(this.phase);
		mix(this.liveTick);
		mix(this.pos);
		mix(this.top);
		for (let p = 0; p < 2; p++) {
			mix(this.grip[p] as number);
			mix(this.gas[p] as number);
			mix(this.points[p] as number);
			mix(this.adv[p] as number);
			mix(this.stall[p] as number);
			mix(this.recover[p] as number);
			mix(this.momentum[p] as number);
			mix(this.control[p] as number);
			mix(this.held[p] as number);
		}
		mix(this.settle);
		mix(this.act);
		mix(this.actor);
		mix(this.move);
		mix(this.actT);
		mix(this.grade);
		mix(this.counter);
		mix(this.read);
		mix(this.tension);
		mix(this.escape);
		mix(this.subMove);
		mix(this.subT);
		mix(this.winner);
		return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
	}
}
