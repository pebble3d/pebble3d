import { type BlockSpec, kindMass } from "./blocks.ts";
import { DT } from "./constants.ts";
import {
	Driver,
	type DriverOptions,
	type DriverSink,
	type DriverStatus,
} from "./driver.ts";
import { LEVELS, type LevelDef } from "./levels.ts";
import type { ShotResult } from "./session.ts";
import type { Shot, Site, WorldSource } from "./site.ts";

const STRIDE = 8;
const SLEEPING = 2;
/** Balls a snapshot carries room for. */
export const MAX_BALLS = 4;

/** What the views read: a Site, or its main-thread mirror fed by the sim worker. */
export interface SiteView {
	readonly level: LevelDef;
	readonly n: number;
	readonly blocks: readonly BlockSpec[];
	readonly slots: Int32Array;
	readonly ballSlots: readonly number[];
	readonly mass: Float32Array;
	prev: Float32Array;
	curr: Float32Array;
	refresh(): void;
	awakeBlocks(): number;
}

/** Presentation-side events (the DriverSink, with views instead of Sites). */
export interface HostSink {
	level(index: number, seed: number, view: SiteView): void;
	fire(shot: Shot): void;
	shotDone(r: ShotResult, best: boolean): void;
	tick(view: SiteView): void;
	replayStart(
		levelIndex: number,
		shot: Shot,
		result: ShotResult,
		view: SiteView,
	): void;
	replayVerified(ok: boolean, hash: string): void;
	replayEnd(view: SiteView): void;
}

export interface SimHost {
	readonly kind: "inline" | "worker";
	status(): DriverStatus;
	/** Interpolation factor between the view's prev and curr states. */
	alpha(): number;
	begin(): void;
	fire(vx: number, vy: number, vz: number): void;
	advance(): void;
	requestReplay(): void;
	skipReplay(): void;
	setTimeScale(s: number): void;
	/** Call once per rendered frame with real seconds. */
	frame(dt: number): void;
}

/** Packs a Site's blocks then balls into `out` (STRIDE floats each). Returns ball count. */
export function packSite(site: Site, out: Float32Array): number {
	site.refresh();
	const c = site.curr;
	for (let i = 0; i < site.n; i++) {
		const o = (site.slots[i] as number) * STRIDE;
		out.set(c.subarray(o, o + STRIDE), i * STRIDE);
	}
	const balls = Math.min(MAX_BALLS, site.ballSlots.length);
	for (let b = 0; b < balls; b++) {
		const o = (site.ballSlots[b] as number) * STRIDE;
		out.set(c.subarray(o, o + STRIDE), (site.n + b) * STRIDE);
	}
	return balls;
}

/**
 * A main-thread copy of a worker Site: the level's blocks regenerated from (level, seed) and
 * the packed state of the last two ticks. Slots are block indices, balls follow the blocks.
 */
export class MirrorSite implements SiteView {
	readonly level: LevelDef;
	readonly n: number;
	readonly blocks: BlockSpec[];
	readonly slots: Int32Array;
	readonly ballSlots: number[] = [];
	readonly mass: Float32Array;
	prev: Float32Array;
	curr: Float32Array;

	constructor(level: LevelDef, seed: number) {
		this.level = level;
		this.blocks = level.build(seed);
		this.n = this.blocks.length;
		this.slots = new Int32Array(this.n);
		this.mass = new Float32Array(this.n);
		for (let i = 0; i < this.n; i++) {
			this.slots[i] = i;
			this.mass[i] = kindMass((this.blocks[i] as BlockSpec).kind);
		}
		const len = (this.n + MAX_BALLS) * STRIDE;
		this.prev = new Float32Array(len);
		this.curr = new Float32Array(len);
	}

	/** One tick arrived: curr becomes prev, the packed buffer becomes curr. */
	apply(buf: Float32Array, balls: number, snap = false): void {
		if (snap) this.prev.set(buf);
		else this.prev.set(this.curr);
		this.curr.set(buf);
		while (this.ballSlots.length < balls)
			this.ballSlots.push(this.n + this.ballSlots.length);
	}

	refresh(): void {}

	awakeBlocks(): number {
		let k = 0;
		for (let i = 0; i < this.n; i++)
			if (((this.curr[i * STRIDE + 7] as number) & SLEEPING) === 0) k++;
		return k;
	}
}

/** Runs the Driver on the main thread (fixed-mode captures, tests, `?worker=0`). */
export class InlineHost implements SimHost {
	readonly kind = "inline";
	readonly driver: Driver;

	constructor(src: WorldSource, opts: DriverOptions, sink: HostSink) {
		const ds: DriverSink = {
			level: (i, seed, site) => sink.level(i, seed, site),
			fire: (shot) => sink.fire(shot),
			shotDone: (r, b) => sink.shotDone(r, b),
			tick: (site) => sink.tick(site),
			replayStart: (li, _seed, shot, result, site) =>
				sink.replayStart(li, shot, result, site),
			replayVerified: (ok, h) => sink.replayVerified(ok, h),
			replayEnd: () => sink.replayEnd(this.driver.site),
		};
		this.driver = new Driver(src, opts, ds);
	}
	status(): DriverStatus {
		return this.driver.snapshot();
	}
	alpha(): number {
		return Math.min(1, this.driver.acc / DT);
	}
	begin(): void {
		this.driver.begin();
	}
	fire(vx: number, vy: number, vz: number): void {
		this.driver.fire(vx, vy, vz);
	}
	advance(): void {
		this.driver.advance();
	}
	requestReplay(): void {
		this.driver.requestReplay();
	}
	skipReplay(): void {
		this.driver.skipReplay();
	}
	setTimeScale(s: number): void {
		this.driver.timeScale = s;
	}
	frame(dt: number): void {
		this.driver.frame(dt);
	}
}

/** Messages from the sim worker. */
export type WorkerMsg =
	| { t: "ready" }
	| { t: "error"; msg: string }
	| { t: "level"; i: number; seed: number; buf: Float32Array; balls: number }
	| { t: "fire"; shot: Shot }
	| { t: "shotDone"; r: ShotResult; best: boolean }
	| {
			t: "tick";
			buf: Float32Array;
			balls: number;
			/** The full status, sent only when it changed shape or every 100 ms. */
			status?: DriverStatus;
			live: LiveStatus;
	  }
	| {
			t: "replayStart";
			i: number;
			seed: number;
			shot: Shot;
			result: ShotResult;
			buf: Float32Array;
			balls: number;
	  }
	| { t: "replayVerified"; ok: boolean; hash: string }
	| {
			t: "replayEnd";
			i: number;
			seed: number;
			buf: Float32Array;
			balls: number;
	  }
	| { t: "status"; status: DriverStatus };

/** Messages to the sim worker. */
export type HostMsg =
	| {
			t: "init";
			wasmUrl: string;
			build: "deterministic" | "fast";
			opts: DriverOptions;
	  }
	| { t: "begin" }
	| { t: "fire"; v: [number, number, number] }
	| { t: "advance" }
	| { t: "replay" }
	| { t: "skip" }
	| { t: "timeScale"; s: number }
	| { t: "pause"; on: boolean }
	| { t: "recycle"; buf: Float32Array };

/** The per-tick slice of the status (the rest changes only on events). */
export interface LiveStatus {
	tick: number;
	awake: number;
	tickMs: number;
	pace: number;
	knockedKg: number;
	bot: DriverStatus["bot"];
}

export function liveOf(st: DriverStatus, out: LiveStatus): LiveStatus {
	out.tick = st.tick;
	out.awake = st.awake;
	out.tickMs = st.tickMs;
	out.pace = st.pace;
	out.knockedKg = st.knockedKg;
	out.bot = st.bot;
	return out;
}

/** A key over the status fields that only change on events: a new full status is due. */
export function statusKey(st: DriverStatus): string {
	return `${st.state}|${st.phase}|${st.levelIndex}|${st.shotIndex}|${st.results.length}|${st.replayReady}|${st.replayVerified}`;
}

/** Ticks the main thread keeps queued; older ones are dropped (tab hidden, long frame). */
export const MAX_QUEUED_TICKS = 2;

/**
 * Queues a worker message. Events always queue; a tick beyond MAX_QUEUED_TICKS drops the
 * oldest queued tick (its buffer goes straight back to `recycle`, its full status, if any,
 * carries over to the newer tick). The queue is therefore bounded by events alone.
 */
export function enqueue(
	queue: WorkerMsg[],
	m: WorkerMsg,
	recycle: (buf: Float32Array) => void,
): void {
	if (m.t === "status") {
		// Only the newest status matters.
		for (let i = queue.length - 1; i >= 0; i--)
			if ((queue[i] as WorkerMsg).t === "status") queue.splice(i, 1);
	} else if (m.t === "tick") {
		let ticks = 0;
		let first = -1;
		for (let i = 0; i < queue.length; i++)
			if ((queue[i] as WorkerMsg).t === "tick") {
				ticks++;
				if (first < 0) first = i;
			}
		if (ticks >= MAX_QUEUED_TICKS && first >= 0) {
			const old = queue[first] as Extract<WorkerMsg, { t: "tick" }>;
			queue.splice(first, 1);
			if (old.status && !m.status) m.status = old.status;
			recycle(old.buf);
		}
	}
	queue.push(m);
}

/**
 * Runs the Driver in a Web Worker: Rapier steps off the main thread and every tick's packed
 * state streams back. The main thread interpolates between the last two ticks by arrival
 * time, so rendering keeps its frame rate when a collapse makes ticks expensive (game time
 * dilates instead).
 */
export class WorkerHost implements SimHost {
	readonly kind = "worker";
	private readonly worker: Worker;
	private readonly sink: HostSink;
	private view: MirrorSite | null = null;
	private readonly queue: WorkerMsg[] = [];
	private st: DriverStatus | null = null;
	private lastTickAt = 0;
	private interval = DT * 1000;
	private readyResolve: (() => void) | null = null;
	private readyReject: ((e: Error) => void) | null = null;
	private started = false;
	readonly ready: Promise<void>;
	/** Called once if the worker fails after start (the app shows its fatal overlay). */
	onFatal: ((msg: string) => void) | null = null;

	constructor(
		worker: Worker,
		wasmUrl: string,
		build: "deterministic" | "fast",
		opts: DriverOptions,
		sink: HostSink,
	) {
		this.worker = worker;
		this.sink = sink;
		this.ready = new Promise((res, rej) => {
			this.readyResolve = res;
			this.readyReject = rej;
		});
		const recycle = (buf: Float32Array): void =>
			this.post({ t: "recycle", buf }, [buf.buffer]);
		worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
			const m = e.data;
			if (m.t === "ready") {
				this.started = true;
				this.readyResolve?.();
			} else if (m.t === "status" && !this.st) this.st = m.status;
			else if (m.t === "error") this.fail(m.msg);
			else enqueue(this.queue, m, recycle);
		};
		worker.onerror = (e) => {
			e.preventDefault();
			this.fail(e.message || "worker script error");
		};
		worker.onmessageerror = () => this.fail("unreadable worker message");
		this.post({ t: "init", wasmUrl, build, opts });
	}

	private failedOnce = false;
	private fail(msg: string): void {
		if (this.failedOnce) return;
		this.failedOnce = true;
		const text = `sim worker: ${msg}`;
		if (!this.started) this.readyReject?.(new Error(text));
		else this.onFatal?.(text);
	}

	/** Pauses the worker's clock (tab hidden) or resumes it. */
	pause(on: boolean): void {
		this.post({ t: "pause", on });
	}

	private post(m: HostMsg, transfer: Transferable[] = []): void {
		this.worker.postMessage(m, transfer);
	}

	status(): DriverStatus {
		if (!this.st) throw new Error("sim worker: no status yet");
		return this.st;
	}
	alpha(): number {
		return Math.min(1, (performance.now() - this.lastTickAt) / this.interval);
	}
	begin(): void {
		this.post({ t: "begin" });
	}
	fire(vx: number, vy: number, vz: number): void {
		this.post({ t: "fire", v: [vx, vy, vz] });
	}
	advance(): void {
		this.post({ t: "advance" });
	}
	requestReplay(): void {
		this.post({ t: "replay" });
	}
	skipReplay(): void {
		this.post({ t: "skip" });
	}
	setTimeScale(s: number): void {
		if (s !== this.lastScale) {
			this.lastScale = s;
			this.post({ t: "timeScale", s });
		}
	}
	private lastScale = 1;

	private mirror(
		i: number,
		seed: number,
		buf: Float32Array,
		balls: number,
	): MirrorSite {
		const m = new MirrorSite(LEVELS[i] as LevelDef, seed);
		m.apply(buf, balls, true);
		this.view = m;
		return m;
	}

	frame(_dt: number): void {
		const q = this.queue;
		for (let k = 0; k < q.length; k++) {
			const m = q[k] as WorkerMsg;
			switch (m.t) {
				case "level":
					this.sink.level(
						m.i,
						m.seed,
						this.mirror(m.i, m.seed, m.buf, m.balls),
					);
					break;
				case "fire":
					this.sink.fire(m.shot);
					break;
				case "shotDone":
					this.sink.shotDone(m.r, m.best);
					break;
				case "tick": {
					if (m.status) this.st = m.status;
					const st = this.st;
					if (st) {
						const l = m.live;
						st.tick = l.tick;
						st.awake = l.awake;
						st.tickMs = l.tickMs;
						st.pace = l.pace;
						st.knockedKg = l.knockedKg;
						st.bot = l.bot;
					}
					const v = this.view;
					if (v) {
						v.apply(m.buf, m.balls);
						this.sink.tick(v);
					}
					const t = performance.now();
					const d = t - this.lastTickAt;
					if (d > 0 && d < 250) this.interval += (d - this.interval) * 0.15;
					this.lastTickAt = t;
					this.post({ t: "recycle", buf: m.buf }, [m.buf.buffer]);
					break;
				}
				case "status":
					this.st = m.status;
					break;
				case "replayStart":
					this.sink.replayStart(
						m.i,
						m.shot,
						m.result,
						this.mirror(m.i, m.seed, m.buf, m.balls),
					);
					break;
				case "replayVerified":
					this.sink.replayVerified(m.ok, m.hash);
					break;
				case "replayEnd":
					this.sink.replayEnd(this.mirror(m.i, m.seed, m.buf, m.balls));
					break;
			}
		}
		q.length = 0;
	}

	/** The mirror currently shown (for picking). */
	get current(): SiteView | null {
		return this.view;
	}
}
