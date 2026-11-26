import type { Runner } from "./host.ts";
import { newSnapshot } from "./snapshot.ts";

/**
 * Worker-side backpressure for snapshots. At most `maxInFlight` snapshots are posted and not
 * yet handed back by the main thread. When the main thread falls behind, new ticks are
 * coalesced into one pending snapshot (latest state wins, events accumulate up to the
 * snapshot's event cap), and once `maxPendingTicks` have piled up the sim stops stepping:
 * a stalled page pauses the game instead of queueing megabytes of snapshots or replaying a
 * burst of effects on resume. No DOM, so it is tested in Node.
 */
export class SnapshotPump {
	inFlight = 0;
	private pending: Float32Array | null = null;
	private pendingTicks = 0;
	private readonly pool: Float32Array[] = [];
	private readonly runner: Runner;
	private readonly send: (buf: Float32Array) => void;
	private readonly maxInFlight: number;
	private readonly maxPendingTicks: number;

	constructor(
		runner: Runner,
		send: (buf: Float32Array) => void,
		maxInFlight = 2,
		maxPendingTicks = 6,
	) {
		this.runner = runner;
		this.send = send;
		this.maxInFlight = maxInFlight;
		this.maxPendingTicks = maxPendingTicks;
	}

	/** True while the main thread is behind and the sim is held. */
	get stalled(): boolean {
		return (
			this.inFlight >= this.maxInFlight &&
			this.pendingTicks >= this.maxPendingTicks
		);
	}

	/** Steps up to `ticks` ticks (fewer, or none, while stalled). Returns ticks stepped. */
	step(ticks: number): number {
		if (ticks <= 0) return 0;
		if (this.inFlight >= this.maxInFlight) {
			ticks = Math.min(ticks, this.maxPendingTicks - this.pendingTicks);
			if (ticks <= 0) return 0;
		}
		const append = this.pending !== null;
		const buf = this.pending ?? this.pool.pop() ?? newSnapshot();
		this.runner.run(ticks, buf, append);
		this.pending = buf;
		this.pendingTicks += ticks;
		this.flush();
		return ticks;
	}

	/** The main thread handed a snapshot buffer back. */
	ack(buf: Float32Array | null): void {
		if (this.inFlight > 0) this.inFlight--;
		if (buf && this.pool.length < 4) this.pool.push(buf);
		this.flush();
	}

	private flush(): void {
		if (!this.pending || this.inFlight >= this.maxInFlight) return;
		const b = this.pending;
		this.pending = null;
		this.pendingTicks = 0;
		this.inFlight++;
		this.send(b);
	}
}
