export interface FixedStepOptions {
	mode: "realtime" | "fixed";
	/** Tick length in seconds. Default 1/60. */
	dt?: number;
	/** Realtime only: cap on ticks per frame; the excess time is dropped. Default 5. */
	maxTicksPerFrame?: number;
	/** Fixed mode only: no more ticks once `currentTick` reaches this. */
	stopAtTick?: number;
}

const EPS = 1e-9;

export class FixedStepLoop {
	private readonly mode: "realtime" | "fixed";
	private readonly dt: number;
	private readonly maxTicks: number;
	private readonly stopAtTick: number;
	private acc = 0;
	private readonly out = { ticks: 0, alpha: 0 };

	constructor(opts: FixedStepOptions) {
		this.mode = opts.mode;
		this.dt = opts.dt ?? 1 / 60;
		this.maxTicks = opts.maxTicksPerFrame ?? 5;
		this.stopAtTick = opts.stopAtTick ?? Number.POSITIVE_INFINITY;
	}

	/**
	 * Returns how many sim ticks to run this frame and the render interpolation
	 * alpha. The returned object is reused between calls (no per-frame allocation).
	 */
	advance(
		frameSeconds: number,
		currentTick: number,
	): { ticks: number; alpha: number } {
		const out = this.out;
		if (this.mode === "fixed") {
			out.ticks = currentTick >= this.stopAtTick ? 0 : 1;
			out.alpha = 1;
			return out;
		}
		this.acc += frameSeconds;
		let ticks = Math.floor(this.acc / this.dt + EPS);
		if (ticks > this.maxTicks) {
			ticks = this.maxTicks;
			this.acc = 0;
		} else {
			this.acc = Math.max(0, this.acc - ticks * this.dt);
		}
		out.ticks = ticks;
		out.alpha = Math.min(1, this.acc / this.dt);
		return out;
	}
}
