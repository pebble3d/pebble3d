/**
 * CPU partner. It writes the same input byte a player produces, from the sim state and its
 * own seeded generator, so a CPU match replays from the input log alone. Belts differ in how
 * fast and how accurately they read a telegraph, how well they time beats, and how they
 * manage grips and gas.
 */
import {
	correctCounter,
	DIRS,
	type Dir,
	MOVES,
	type MoveRef,
	POSITIONS,
	type PositionDef,
	type Role,
} from "./graph.ts";
import { DIR_BITS, IN } from "./input.ts";
import { Rng } from "./rng.ts";
import { ACT, type MatchSim, PHASE, TUNE } from "./sim.ts";

export type Belt = "white" | "blue" | "black";
export const BELTS: Belt[] = ["white", "blue", "black"];

export interface BeltParams {
	/** Ticks after a launch before the telegraph is read: [min, max]. */
	react: [number, number];
	/** Chance the read picks the right counter. */
	readAcc: number;
	/** Chance a misread still presses something (a wrong counter) instead of freezing. */
	guess: number;
	/** Beat timing error (ticks, roughly normal). */
	beatErr: number;
	/** Submission escape: timing error and the chance of knowing the right escape. */
	subErr: number;
	subAcc: number;
	/** Chance per beat of missing the beat entirely. */
	subMiss: number;
	/** Extra grip over the move's need before launching. */
	margin: number;
	/** Idle ticks between decisions: [min, max]. */
	think: [number, number];
	breatheBelow: number;
	breatheUntil: number;
	/** Weight of submissions when choosing a move. */
	subWeight: number;
}

export const BELT_PARAMS: Record<Belt, BeltParams> = {
	white: {
		react: [26, 48],
		readAcc: 0.42,
		guess: 0.6,
		beatErr: 9,
		subErr: 7,
		subAcc: 0.6,
		subMiss: 0.3,
		margin: 0.05,
		think: [30, 90],
		breatheBelow: 0.15,
		breatheUntil: 0.45,
		subWeight: 0.6,
	},
	blue: {
		react: [16, 32],
		readAcc: 0.68,
		guess: 0.45,
		beatErr: 5,
		subErr: 4,
		subAcc: 0.85,
		subMiss: 0.15,
		margin: 0.12,
		think: [24, 70],
		breatheBelow: 0.25,
		breatheUntil: 0.65,
		subWeight: 1,
	},
	black: {
		react: [8, 20],
		readAcc: 0.86,
		guess: 0.3,
		beatErr: 2.5,
		subErr: 2.5,
		subAcc: 0.97,
		subMiss: 0.06,
		margin: 0.2,
		think: [18, 50],
		breatheBelow: 0.3,
		breatheUntil: 0.75,
		subWeight: 1.3,
	},
};

const bitOf = (d: Dir): number => DIR_BITS[DIRS.indexOf(d)] as number;

export class Cpu {
	readonly p: number;
	readonly belt: Belt;
	readonly k: BeltParams;
	private readonly rng: Rng;
	/** Planned move (global index) or -1. */
	plan = -1;
	private wait = 0;
	private breathing = false;
	// exchange bookkeeping
	private seenLaunchTick = -1;
	private readAt = -1;
	private readDir = 0;
	private beatAt = -1;
	// submission bookkeeping
	private subPressAt = -1;
	private subDir = 0;
	private lastSubCycle = -1;
	/** One-tick press to emit next. */
	private pulse = 0;
	/** Tutorial: never attack, never defend. */
	passive = false;

	constructor(p: number, belt: Belt, seed: number) {
		this.p = p;
		this.belt = belt;
		this.k = BELT_PARAMS[belt];
		this.rng = new Rng((seed * 2654435761 + p * 97 + 13) >>> 0);
	}

	next(s: MatchSim): number {
		if (s.phase !== PHASE.LIVE) {
			this.plan = -1;
			return 0;
		}
		let out = 0;
		if (this.pulse) {
			out |= this.pulse;
			this.pulse = 0;
		}
		if (s.isSub()) return out | this.sub(s);
		if (s.act !== ACT.IDLE) return out | this.exchange(s);
		this.seenLaunchTick = -1;
		this.beatAt = -1;
		return out | this.idle(s);
	}

	private idle(s: MatchSim): number {
		const p = this.p;
		const gas = s.gas[p] as number;
		if (this.breathing) {
			if (gas >= this.k.breatheUntil) this.breathing = false;
			else return IN.BREATHE;
		} else if (gas < this.k.breatheBelow && !this.passive) {
			this.breathing = true;
			return IN.BREATHE;
		}
		if (this.passive) return IN.GRIP;
		if (this.plan < 0 || (MOVES[this.plan] as MoveRef).pos !== s.pos)
			this.choose(s);
		if (this.wait > 0) {
			this.wait--;
			return IN.GRIP;
		}
		if (this.plan < 0) return IN.GRIP;
		const def = (MOVES[this.plan] as MoveRef).def;
		if (
			(s.grip[p] as number) >= Math.min(0.98, def.grip + this.k.margin) &&
			s.canLaunch(p)
		) {
			const d = def.dir;
			this.plan = -1;
			this.wait = this.rng.int(this.k.think[0], this.k.think[1]);
			// release grip on launch: the beat needs a fresh J press
			return bitOf(d);
		}
		return IN.GRIP;
	}

	private choose(s: MatchSim): void {
		const role: Role = s.roleOf(this.p);
		const pd = POSITIONS[s.pos] as PositionDef;
		let total = 0;
		const w: number[] = [];
		const idx: number[] = [];
		for (let i = 0; i < MOVES.length; i++) {
			const mr = MOVES[i] as MoveRef;
			if (mr.pos !== s.pos) continue;
			if (pd.id !== "standing" && mr.role !== role) continue;
			let wt = 1;
			if (mr.def.kind === "sub") wt = this.k.subWeight;
			if (mr.def.kind === "pull") wt = 0.5;
			if (mr.def.points >= 3) wt *= 1.3;
			if (mr.def.kind === "escape") wt = 1.2;
			w.push(wt);
			idx.push(i);
			total += wt;
		}
		this.plan = -1;
		if (!idx.length) return;
		let r = this.rng.next() * total;
		for (let j = 0; j < idx.length; j++) {
			r -= w[j] as number;
			if (r <= 0) {
				this.plan = idx[j] as number;
				break;
			}
		}
		if (this.plan < 0) this.plan = idx[idx.length - 1] as number;
		if (this.wait <= 0)
			this.wait = this.rng.int(this.k.think[0], this.k.think[1]);
	}

	private exchange(s: MatchSim): number {
		const p = this.p;
		if (s.actor === p) {
			if (s.act === ACT.WINDOW) {
				if (this.beatAt < 0)
					this.beatAt = Math.round(TUNE.beat + this.rng.tri() * this.k.beatErr);
				if (s.actT + 1 === Math.max(1, this.beatAt)) return IN.GRIP;
			}
			return 0;
		}
		// defending: read the telegraph after a reaction delay
		const launchTick =
			s.tick - (s.act === ACT.TELEGRAPH ? s.actT : s.telDur + s.actT);
		let out = this.passive ? 0 : IN.GRIP;
		if (this.passive) return out;
		if (this.seenLaunchTick !== launchTick) {
			this.seenLaunchTick = launchTick;
			this.readAt = launchTick + this.rng.int(this.k.react[0], this.k.react[1]);
			const role: Role = s.pos === 0 ? "top" : s.roleOf(p);
			const list = (POSITIONS[s.pos] as PositionDef).roles[role].counters;
			const right = correctCounter(s.move);
			this.readDir = 0;
			if (this.rng.next() < this.k.readAcc)
				this.readDir = bitOf(list[right]?.dir ?? "up");
			else if (this.rng.next() < this.k.guess && list.length > 1) {
				let j = this.rng.int(0, list.length - 2);
				if (j >= right) j++;
				this.readDir = bitOf(list[j]?.dir ?? "up");
			}
		}
		if (s.tick === this.readAt && this.readDir && s.counter < 0)
			out |= this.readDir;
		return out;
	}

	private sub(s: MatchSim): number {
		const p = this.p;
		if (s.top === p) {
			if (this.passive) return 0;
			// squeeze; a white belt sometimes eases off, everyone eases off when empty
			const gas = s.gas[p] as number;
			if (gas < 0.04) return 0;
			if (this.belt === "white" && this.rng.next() < 0.08) return 0;
			return IN.GRIP;
		}
		if (this.passive) return 0;
		const cycle = Math.floor(
			(s.subT + TUNE.subBeatEvery / 2) / TUNE.subBeatEvery,
		);
		if (cycle !== this.lastSubCycle) {
			this.lastSubCycle = cycle;
			const beatT = cycle * TUNE.subBeatEvery;
			this.subPressAt = -1;
			if (this.rng.next() >= this.k.subMiss) {
				this.subPressAt = beatT + Math.round(this.rng.tri() * this.k.subErr);
				const want = (s.position.escape as { dir: Dir }).dir;
				if (this.rng.next() < this.k.subAcc) this.subDir = bitOf(want);
				else {
					const others = DIRS.filter((d) => d !== want);
					this.subDir = bitOf(
						others[this.rng.int(0, others.length - 1)] as Dir,
					);
				}
			}
		}
		if (s.subT + 1 === this.subPressAt) return this.subDir;
		return 0;
	}
}
