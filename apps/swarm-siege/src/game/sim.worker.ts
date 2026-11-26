/// <reference lib="webworker" />
// The Swarm Siege sim worker: loads the wasm build (`fast` by default), runs the rules on its
// own 60 Hz clock and posts batches of ticks as packed, transferred snapshots (WorkerHost in
// host.ts receives them). SnapshotPump (pump.ts) applies backpressure: at most two snapshots
// in flight, newer ticks coalesce into one pending snapshot, and the sim holds when the page
// stops consuming. The clock starts on "go" and stops entirely while the tab is hidden.
import { FixedStepLoop } from "@pebble3d/sdk/loop";
import { type FromWorker, makeSim, Runner, type ToWorker } from "./host.ts";
import { SnapshotPump } from "./pump.ts";
import { emptyPick } from "./sim.ts";
import { H, SNAP_LEN } from "./snapshot.ts";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let runner: Runner | null = null;
let pump: SnapshotPump | null = null;
const loop = new FixedStepLoop({ mode: "realtime", maxTicksPerFrame: 3 });
const pickOut = emptyPick();
let paused = false;
let going = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let last = 0;
let hash = "";

function send(m: FromWorker, transfer: Transferable[] = []): void {
	ctx.postMessage(m, transfer);
}

function fail(err: unknown): void {
	send({
		t: "error",
		msg: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
	});
}

/** (Re)starts the clock when it should run and isn't. */
function arm(): void {
	if (timer !== null || !going || paused || !runner) return;
	last = performance.now();
	timer = setTimeout(tick, 2);
}

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
	const m = e.data;
	try {
		switch (m.t) {
			case "init": {
				const sim = await makeSim(m.o);
				const r = new Runner(sim, m.o.demo);
				runner = r;
				pump = new SnapshotPump(r, (buf) => {
					if (r.sim.tick % 30 < (buf[H.TICKS] as number)) hash = r.sim.hash();
					send({ t: "snap", buf, hash }, [buf.buffer]);
				});
				send({ t: "ready" });
				break;
			}
			case "go":
				going = true;
				arm();
				break;
			case "cmd":
				runner?.queue.push(m.cmd, m.a, m.b);
				break;
			case "pick": {
				if (!runner) break;
				const r = m.r;
				runner.sim.pick(r[0], r[1], r[2], r[3], r[4], r[5], pickOut);
				send({ t: "pick", p: pickOut });
				break;
			}
			case "recycle":
				pump?.ack(m.buf.length === SNAP_LEN ? m.buf : null);
				break;
			case "pause":
				paused = m.on;
				if (paused && timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
				arm();
				break;
		}
	} catch (err) {
		fail(err);
	}
};

function tick(): void {
	timer = null;
	const r = runner;
	const p = pump;
	if (!r || !p || paused || !going) return;
	const now = performance.now();
	const dt = (now - last) / 1000;
	last = now;
	try {
		const adv = loop.advance(Math.min(dt, 0.1), r.sim.tick);
		// While stalled the ticks are dropped: the game holds instead of running unseen.
		if (adv.ticks > 0) p.step(adv.ticks);
	} catch (err) {
		fail(err);
		return;
	}
	timer = setTimeout(tick, 2);
}
