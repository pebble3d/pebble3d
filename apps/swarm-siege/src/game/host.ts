import { FixedStepLoop } from "@pebble3d/sdk/loop";
import { loadSim, type SimBuild, StateViews } from "@pebble3d/sdk/sim";
import { DemoBot } from "./bot.ts";
import { DT } from "./constants.ts";
import { CmdQueue, emptyInput } from "./input.ts";
import { emptyPick, type PickResult, SiegeSim, type SimConfig } from "./sim.ts";
import { H, newSnapshot, packSnapshot } from "./snapshot.ts";

/** Where the sim runs: on the main thread (captures, tests, `?worker=0`) or in a Web Worker. */
export interface SimHost {
	readonly kind: "inline" | "worker";
	/** The newest packed state and the one before it (for interpolation). */
	curr: Float32Array;
	prev: Float32Array;
	/** Latest camera-pick answer (the worker's arrives a frame later). */
	readonly lastPick: PickResult;
	/** Advances by `rdt` real seconds; true when a new snapshot became `curr` this frame. */
	frame(rdt: number): boolean;
	/** Interpolation factor between prev and curr. */
	alpha(): number;
	command(cmd: number, a?: number, b?: number): void;
	pick(
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
	): void;
	hash(): string;
	botState(): string;
	/** True once the fixed-mode stop tick has been simulated. */
	stopped(): boolean;
	/** Start the sim clock (worker: it waits for this so no ticks pass before the first frame). */
	go(): void;
	/** Called once per new snapshot (process its events here: a frame can receive two). */
	onSnapshot: ((snap: Float32Array) => void) | null;
}

export interface HostOptions {
	build: SimBuild;
	/** Absolute URL of the chosen `_bg.wasm`. */
	wasmUrl: string;
	cfg: SimConfig;
	demo: boolean;
	mode: "realtime" | "fixed";
	stopAtTick?: number;
}

/** Runs one tick-batch with bot or queued player commands, then packs a snapshot. Shared by both hosts. */
export class Runner {
	readonly sim: SiegeSim;
	readonly bot: DemoBot | null;
	readonly queue = new CmdQueue();
	private readonly input = emptyInput();
	simMs = 0;

	constructor(sim: SiegeSim, demo: boolean) {
		this.sim = sim;
		this.bot = demo ? new DemoBot(sim) : null;
	}

	/**
	 * Steps `ticks` ticks, packing into `out` (events of every tick kept). `append` continues
	 * a snapshot that already holds earlier ticks (coalescing): its events are kept too.
	 */
	run(ticks: number, out: Float32Array, append = false): void {
		const t0 = performance.now();
		for (let i = 0; i < ticks; i++) {
			if (this.bot) {
				this.bot.nextInput(this.input);
				// Player commands (none in demo) still drain.
				if (this.input.cmd === 0) this.queue.pop(this.input);
			} else this.queue.pop(this.input);
			this.sim.step(this.input);
			packSnapshot(this.sim, out, i === 0 && !append);
			this.sim.events.clear();
		}
		const ms = (performance.now() - t0) / ticks;
		this.simMs += (ms - this.simMs) * 0.1;
		out[H.SIM_MS] = this.simMs;
	}
}

export async function makeSim(o: HostOptions): Promise<SiegeSim> {
	const h = await loadSim(o.build, o.wasmUrl, { seed: 1 });
	return new SiegeSim(h, new StateViews(h), o.cfg);
}

export class InlineHost implements SimHost {
	readonly kind = "inline";
	onSnapshot: ((snap: Float32Array) => void) | null = null;
	curr = newSnapshot();
	prev = newSnapshot();
	readonly lastPick = emptyPick();
	readonly runner: Runner;
	private readonly loop: FixedStepLoop;
	private a = 1;
	private readonly stopAt: number | undefined;

	constructor(sim: SiegeSim, o: HostOptions) {
		this.runner = new Runner(sim, o.demo);
		this.stopAt = o.stopAtTick;
		this.loop = new FixedStepLoop(
			o.stopAtTick !== undefined
				? { mode: o.mode, stopAtTick: o.stopAtTick, maxTicksPerFrame: 3 }
				: { mode: o.mode, maxTicksPerFrame: 3 },
		);
		packSnapshot(sim, this.curr, true);
		this.prev.set(this.curr);
	}

	frame(rdt: number): boolean {
		const adv = this.loop.advance(rdt, this.runner.sim.tick);
		this.a = adv.alpha;
		if (adv.ticks === 0) return false;
		const p = this.prev;
		this.prev = this.curr;
		this.curr = p;
		this.runner.run(adv.ticks, this.curr);
		this.onSnapshot?.(this.curr);
		return true;
	}
	alpha(): number {
		return this.a;
	}
	command(cmd: number, a = 0, b = 0): void {
		this.runner.queue.push(cmd, a, b);
	}
	pick(
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
	): void {
		this.runner.sim.pick(ox, oy, oz, dx, dy, dz, this.lastPick);
	}
	hash(): string {
		return this.runner.sim.hash();
	}
	botState(): string {
		return this.runner.bot?.current ?? "player";
	}
	go(): void {}
	stopped(): boolean {
		return this.stopAt !== undefined && this.runner.sim.tick >= this.stopAt;
	}
}

/** Messages to the sim worker. */
export type ToWorker =
	| { t: "init"; o: HostOptions }
	| { t: "cmd"; cmd: number; a: number; b: number }
	| { t: "pick"; r: [number, number, number, number, number, number] }
	| { t: "recycle"; buf: Float32Array }
	| { t: "pause"; on: boolean }
	/** Start the sim clock (sent right before the first rendered frame). */
	| { t: "go" };

/** Messages from the sim worker. */
export type FromWorker =
	| { t: "ready" }
	| { t: "error"; msg: string }
	| { t: "snap"; buf: Float32Array; hash: string }
	| { t: "pick"; p: PickResult };

export class WorkerHost implements SimHost {
	readonly kind = "worker";
	onSnapshot: ((snap: Float32Array) => void) | null = null;
	curr = newSnapshot();
	prev = newSnapshot();
	readonly lastPick = emptyPick();
	private readonly w: Worker;
	private fresh = false;
	private arrived = 0;
	private picking = false;
	private pickAt = 0;
	private lastHash = "";

	private constructor(w: Worker) {
		this.w = w;
	}

	static async start(
		o: HostOptions,
		onError: (msg: string) => void,
	): Promise<WorkerHost> {
		const w = new Worker(new URL("./sim.worker.ts", import.meta.url), {
			type: "module",
		});
		const host = new WorkerHost(w);
		let started = false;
		await new Promise<void>((resolve, reject) => {
			w.onmessage = (e: MessageEvent<FromWorker>) => {
				const m = e.data;
				if (m.t === "ready") {
					started = true;
					resolve();
				} else if (m.t === "error") {
					// Before start-up the boot promise rejects; afterwards the app's fatal
					// handler shows the error (overlay + __pebble3d.error).
					if (started) onError(m.msg);
					else reject(new Error(m.msg));
				} else host.receive(m);
			};
			w.onerror = (e) => {
				const msg = `sim worker: ${e.message}`;
				if (started) onError(msg);
				else reject(new Error(msg));
			};
			w.postMessage({ t: "init", o } satisfies ToWorker);
		});
		// A page opened in a background tab starts paused; later changes follow the tab.
		const vis = (): void =>
			w.postMessage({
				t: "pause",
				on: document.visibilityState === "hidden",
			} satisfies ToWorker);
		vis();
		document.addEventListener("visibilitychange", vis);
		return host;
	}

	private receive(m: FromWorker): void {
		if (m.t === "snap") {
			const old = this.prev;
			this.prev = this.curr;
			this.curr = m.buf;
			this.lastHash = m.hash;
			this.arrived = performance.now();
			this.w.postMessage({ t: "recycle", buf: old } satisfies ToWorker, [
				old.buffer,
			]);
			this.fresh = true;
			this.onSnapshot?.(this.curr);
		} else if (m.t === "pick") {
			Object.assign(this.lastPick, m.p);
			this.picking = false;
		}
	}

	frame(_rdt: number): boolean {
		const f = this.fresh;
		this.fresh = false;
		return f;
	}
	alpha(): number {
		const span = Math.max(1, this.curr[H.TICKS] as number) * DT * 1000;
		return Math.min(1, (performance.now() - this.arrived) / span);
	}
	command(cmd: number, a = 0, b = 0): void {
		this.w.postMessage({ t: "cmd", cmd, a, b } satisfies ToWorker);
	}
	pick(
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
	): void {
		// One pick in flight; give up on a lost answer after 250 ms.
		const now = performance.now();
		if (this.picking && now - this.pickAt < 250) return;
		this.picking = true;
		this.pickAt = now;
		this.w.postMessage({
			t: "pick",
			r: [ox, oy, oz, dx, dy, dz],
		} satisfies ToWorker);
	}
	hash(): string {
		return this.lastHash;
	}
	botState(): string {
		return "worker";
	}
	go(): void {
		this.w.postMessage({ t: "go" } satisfies ToWorker);
	}
	stopped(): boolean {
		return false;
	}
}
