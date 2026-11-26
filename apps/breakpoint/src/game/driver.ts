import { DemoBot } from "./bot.ts";
import { DT } from "./constants.ts";
import { LEVELS, type LevelDef } from "./levels.ts";
import { ReplayKeeper } from "./replay.ts";
import {
	emptyInput,
	PHASE,
	type Phase,
	Session,
	type ShotResult,
	type TickInput,
} from "./session.ts";
import type { Shot, Site, WorldSource } from "./site.ts";

/** Replay plays at this fraction of real time. */
export const REPLAY_SCALE = 0.4;
/** Ticks the demo shows its run card before it replays the best shot. */
export const DEMO_REPLAY_DELAY = 150;
/** Ticks the replay holds on its last frame (verification badge) before it ends. */
const REPLAY_HOLD = 150;

export type AppState = "title" | "play" | "replay";

export interface DriverOptions {
	seed: number;
	startLevel: number;
	demo: boolean;
	/**
	 * Fixed pacing (captures): a frame always runs the same number of ticks for the same
	 * time scale, settling runs SETTLE_TICKS_FIXED per frame and background replay work is
	 * counted in ticks. Real-time pacing uses wall-clock budgets.
	 */
	fixed: boolean;
	/** Tests only: replaces the level list (not sent to the worker: it holds functions). */
	levels?: readonly LevelDef[];
}

/** Everything the presentation hears about. Each call happens synchronously in `frame`. */
export interface DriverSink {
	/** A level's Site exists; the view regenerates its blocks from (level, seed). */
	level(index: number, seed: number, site: Site): void;
	fire(shot: Shot): void;
	shotDone(r: ShotResult, best: boolean): void;
	/** The displayed site advanced one tick (snapshot it, scan it for impacts). */
	tick(site: Site): void;
	replayStart(
		levelIndex: number,
		seed: number,
		shot: Shot,
		result: ShotResult,
		site: Site,
	): void;
	replayVerified(ok: boolean, hash: string): void;
	replayEnd(): void;
}

/** A plain, serialisable summary of the run for the HUD, the camera and the probe. */
export interface DriverStatus {
	state: AppState;
	phase: Phase;
	levelIndex: number;
	shotIndex: number;
	shotsLeft: number;
	phaseTicks: number;
	knockedKg: number;
	aboveKg: number;
	totalKg: number;
	levelKg: number[];
	levelMax: number[];
	results: ShotResult[];
	best: ShotResult | null;
	tick: number;
	awake: number;
	tickMs: number;
	/** Game seconds advanced per real second, smoothed (time dilation under load). */
	pace: number;
	replayReady: boolean;
	replayProgress: number;
	replayVerified: boolean | null;
	bot: {
		aiming: boolean;
		x: number;
		y: number;
		z: number;
		charge: number;
	} | null;
}

const SETTLE_TICKS_FIXED = 6;
const PUMP_TICKS_FIXED = 6;

/**
 * Runs a Breakpoint session: settling, the demo bot or live fire requests, the replay keeper's
 * background re-simulation and replay playback. It is DOM-free so it can run inline (fixed
 * captures) or inside a Web Worker (real-time play), where Rapier never blocks a frame.
 */
export class Driver {
	readonly session: Session;
	readonly keeper: ReplayKeeper;
	private readonly bot: DemoBot | null;
	private readonly opts: DriverOptions;
	private readonly sink: DriverSink;
	private readonly input: TickInput = emptyInput();
	state: AppState = "title";
	timeScale = 1;
	/** Unspent game time (s) towards the next tick, for interpolation. */
	acc = 0;
	private fireReq: [number, number, number] | null = null;
	private advanceReq = false;
	private replayReq = false;
	private runDoneTicks = 0;
	private tickMs = 0;
	private pace = 1;
	private fakeClock = 0;
	private lastVerified: boolean | null = null;
	private rep: {
		site: Site;
		shot: Shot;
		result: ShotResult;
		fired: boolean;
		hold: number;
		verified: boolean | null;
	} | null = null;
	private readonly status: DriverStatus;

	constructor(src: WorldSource, opts: DriverOptions, sink: DriverSink) {
		this.opts = opts;
		this.sink = sink;
		this.keeper = new ReplayKeeper(src);
		let first: { site: Site; i: number; seed: number } | null = null;
		this.session = new Session(
			src,
			opts.seed,
			{
				onLevel: (site, i, seed) => {
					if (!this.session) first = { site, i, seed };
					else this.onLevel(site, i, seed);
				},
				onFire: (shot) => {
					this.keeper.noteShot(shot);
					sink.fire(shot);
				},
				onShotDone: (r, best) => {
					this.keeper.onShotDone(r, best);
					sink.shotDone(r, best);
				},
			},
			opts.levels ?? LEVELS,
			opts.startLevel,
		);
		const f = first as { site: Site; i: number; seed: number } | null;
		if (f) this.onLevel(f.site, f.i, f.seed);
		this.bot = opts.demo ? new DemoBot(this.session) : null;
		this.status = {
			state: "title",
			phase: PHASE.SETTLING,
			levelIndex: 0,
			shotIndex: 0,
			shotsLeft: 0,
			phaseTicks: 0,
			knockedKg: 0,
			aboveKg: 1,
			totalKg: 0,
			levelKg: [],
			levelMax: [],
			results: [],
			best: null,
			tick: 0,
			awake: 0,
			tickMs: 0,
			pace: 1,
			replayReady: false,
			replayProgress: 0,
			replayVerified: null,
			bot: this.bot ? { aiming: false, x: 0, y: 0, z: 0, charge: 0 } : null,
		};
	}

	private onLevel(site: Site, i: number, seed: number): void {
		this.keeper.beginLevel(site.level, seed, i);
		this.sink.level(i, seed, site);
	}

	/** The site being shown (the live run, or the replay world while one plays). */
	get site(): Site {
		return this.rep?.site ?? this.session.site;
	}

	begin(): void {
		if (this.state === "title") this.state = "play";
	}

	fire(vx: number, vy: number, vz: number): void {
		this.fireReq = [vx, vy, vz];
	}

	advance(): void {
		this.advanceReq = true;
	}

	/** Asks for the best-shot replay; ignored unless the run is over and no replay plays. */
	requestReplay(): void {
		if (this.state === "play" && this.session.phase === PHASE.RUN_DONE)
			this.replayReq = true;
	}

	/** Ends a playing replay early (its hash check is skipped). */
	skipReplay(): void {
		if (this.state === "replay") this.endReplay();
	}

	/** Advances by `dt` real seconds. */
	frame(dt: number): void {
		const t0 = now();
		if (this.state === "replay") this.replayFrame(dt);
		else this.playFrame(dt);
		this.pump(now() - t0);
		const adv = this.lastTicks * DT;
		if (dt > 0) this.pace += (Math.min(2, adv / dt) - this.pace) * 0.05;
	}
	private lastTicks = 0;

	private playFrame(dt: number): void {
		const s = this.session;
		this.lastTicks = 0;
		if (s.phase === PHASE.SETTLING) {
			// The site settles behind the title or the site card, as fast as allowed.
			const t0 = now();
			for (let i = 0; i < 600 && s.phase === PHASE.SETTLING; i++) {
				this.tickOnce();
				if (this.opts.fixed ? i + 1 >= SETTLE_TICKS_FIXED : now() - t0 > 24)
					break;
			}
			this.acc = 0;
			return;
		}
		if (this.state === "title") return;
		this.acc += dt * this.timeScale;
		let n = 0;
		const t0 = now();
		while (this.acc >= DT - 1e-9 && n < 4) {
			this.acc -= DT;
			n++;
			this.tickOnce();
			// Behind real time: let game time dilate instead of spiralling.
			if (!this.opts.fixed && now() - t0 > 30) {
				this.acc = Math.min(this.acc, DT * 0.5);
				break;
			}
		}
		if (n === 4) this.acc = Math.min(this.acc, DT);
		this.lastTicks = n;
		if (s.phase === PHASE.RUN_DONE) {
			this.runDoneTicks += n;
			if (
				this.bot &&
				this.runDoneTicks >= DEMO_REPLAY_DELAY &&
				this.runDoneTicks - n < DEMO_REPLAY_DELAY
			)
				this.replayReq = true;
			if (this.replayReq) this.startReplay();
		}
	}

	private tickOnce(): void {
		const s = this.session;
		const inp = this.input;
		if (this.bot) this.bot.next(inp);
		else {
			inp.fire = false;
			inp.advance = false;
			const f = this.fireReq;
			if (s.phase === PHASE.AIM && f) {
				inp.fire = true;
				inp.vx = f[0];
				inp.vy = f[1];
				inp.vz = f[2];
				this.fireReq = null;
			} else if (s.phase !== PHASE.AIM) this.fireReq = null;
			if (this.advanceReq) {
				inp.advance = s.phase === PHASE.LEVEL_DONE;
				this.advanceReq = false;
			}
		}
		const t0 = now();
		s.step(inp);
		this.tickMs += (now() - t0 - this.tickMs) * 0.1;
		this.sink.tick(s.site);
	}

	private pump(usedMs: number): void {
		const s = this.session;
		if (this.state === "replay") return;
		const idle =
			s.phase === PHASE.AIM ||
			s.phase === PHASE.SHOT_DONE ||
			s.phase === PHASE.LEVEL_DONE ||
			s.phase === PHASE.RUN_DONE;
		if (!idle && s.phase !== PHASE.SHOT) return;
		if (this.opts.fixed) {
			this.keeper.pump(
				PUMP_TICKS_FIXED * 4,
				() => this.fakeClock++,
				s.site.tick,
			);
			return;
		}
		const budget = (idle ? 14 : 3) - usedMs;
		if (budget > 0.5) this.keeper.pump(budget, now, s.site.tick);
	}

	private startReplay(): void {
		if (!this.keeper.best) {
			this.replayReq = false;
			return;
		}
		if (!this.keeper.ready) {
			if (this.opts.fixed) this.keeper.finish();
			else {
				this.keeper.pump(30, now, this.session.site.tick);
				return; // keep the request; the status shows the progress
			}
		}
		const r = this.keeper.take();
		if (!r) return;
		this.replayReq = false;
		this.rep = { ...r, fired: false, hold: 0, verified: null };
		this.state = "replay";
		this.acc = 0;
		this.sink.replayStart(
			r.levelIndex,
			this.session.levelSeed(r.levelIndex),
			r.shot,
			r.result,
			r.site,
		);
	}

	private replayFrame(dt: number): void {
		const rep = this.rep;
		this.lastTicks = 0;
		if (!rep) return;
		if (!rep.fired) {
			rep.site.fire(rep.shot);
			rep.fired = true;
		}
		const end = rep.result.endTick;
		this.acc += dt * REPLAY_SCALE;
		let n = 0;
		const t0 = now();
		while (this.acc >= DT - 1e-9 && n < 3) {
			this.acc -= DT;
			n++;
			if (rep.site.tick < end) {
				rep.site.step();
				this.sink.tick(rep.site);
			} else rep.hold++;
			if (!this.opts.fixed && now() - t0 > 30) {
				this.acc = Math.min(this.acc, DT * 0.5);
				break;
			}
		}
		this.lastTicks = n;
		if (rep.site.tick >= end && rep.verified === null) {
			const h = rep.site.hash();
			rep.verified = h === rep.result.endHash;
			this.sink.replayVerified(rep.verified, h);
		}
		if (rep.verified !== null && rep.hold > REPLAY_HOLD) this.endReplay();
	}

	private endReplay(): void {
		const rep = this.rep;
		if (!rep) return;
		this.rep = null;
		this.lastVerified = rep.verified;
		rep.site.free();
		this.state = "play";
		this.runDoneTicks = DEMO_REPLAY_DELAY + 1;
		const best = this.keeper.best;
		const s = this.session;
		if (best)
			this.keeper.rearm(
				s.levels[best.level] ?? s.level,
				s.levelSeed(best.level),
				this.keeper.bestShots,
			);
		this.sink.replayEnd();
	}

	/** Frees every world this driver owns (the run, the replay copies). */
	dispose(): void {
		this.rep?.site.free();
		this.rep = null;
		this.keeper.dispose();
		this.session.site.free();
	}

	/** The current status (one object, refreshed in place). */
	snapshot(): DriverStatus {
		const s = this.session;
		const st = this.status;
		st.state = this.state;
		st.phase = s.phase;
		st.levelIndex = s.levelIndex;
		st.shotIndex = s.shotIndex;
		st.shotsLeft = s.shotsLeft;
		st.phaseTicks = s.phaseTicks;
		st.knockedKg = s.site.knockedMass();
		st.aboveKg = s.site.aboveMass;
		st.totalKg = s.totalKg;
		st.levelKg = s.levelKg;
		st.levelMax = s.levelMax;
		st.results = s.results;
		st.best = s.best;
		st.tick = this.site.tick;
		st.awake = this.site.awakeBlocks();
		st.tickMs = this.tickMs;
		st.pace = this.pace;
		st.replayReady = this.keeper.ready;
		st.replayProgress = this.keeper.progress;
		st.replayVerified = this.rep?.verified ?? this.lastVerified;
		const b = this.bot;
		if (b && st.bot) {
			st.bot.aiming = b.aiming;
			st.bot.x = b.reticle[0];
			st.bot.y = b.reticle[1];
			st.bot.z = b.reticle[2];
			st.bot.charge = b.charge;
		}
		return st;
	}
}

const now = (): number => performance.now();
