import { describe, expect, it } from "vitest";
import { Driver, type DriverSink } from "../src/game/driver.ts";
import {
	enqueue,
	MAX_QUEUED_TICKS,
	MirrorSite,
	packSite,
	type WorkerMsg,
} from "../src/game/host.ts";
import { PHASE } from "../src/game/session.ts";
import { Site, type WorldSource } from "../src/game/site.ts";
import { worldSource } from "./helpers.ts";
import { MINI } from "./mini.ts";

/** Counts worlds made and freed through a WorldSource. */
function counted(src: WorldSource): { src: WorldSource; live: () => number } {
	let made = 0;
	let freed = 0;
	return {
		src: {
			memory: src.memory,
			make: () => {
				const w = src.make();
				made++;
				const free = w.free.bind(w);
				w.free = () => {
					freed++;
					free();
				};
				return w;
			},
		},
		live: () => made - freed,
	};
}

interface Log {
	shots: string[];
	verified: boolean | null;
	replayEnded: boolean;
}

/** Runs a demo Driver over two mini sites through its replay, with the given frame clock. */
function runDemo(
	src: WorldSource,
	fixed: boolean,
	dt: (i: number) => number,
): { log: Log; d: Driver } {
	const log: Log = { shots: [], verified: null, replayEnded: false };
	const sink: DriverSink = {
		level: () => {},
		fire: () => {},
		shotDone: (r) =>
			log.shots.push(
				`${r.level}:${r.index}:${r.shot.tick}:${r.endTick}:${r.endHash}`,
			),
		tick: () => {},
		replayStart: () => {},
		replayVerified: (ok) => {
			log.verified = ok;
		},
		replayEnd: () => {
			log.replayEnded = true;
		},
	};
	const d = new Driver(
		src,
		{ seed: 5, startLevel: 0, demo: true, fixed, levels: [MINI, MINI] },
		sink,
	);
	d.begin();
	for (let i = 0; i < 40000 && !log.replayEnded; i++) d.frame(dt(i));
	return { log, d };
}

describe("driver", () => {
	it.each(["det", "fast"] as const)(
		"%s build: fixed and jittered real-time pacing give the same run, and the replay verifies",
		async (kind) => {
			const base = await worldSource(kind);
			const a = counted(base);
			const fixed = runDemo(a.src, true, () => 1 / 60);
			expect(fixed.log.shots.length).toBe(4);
			expect(fixed.log.verified).toBe(true);
			expect(fixed.log.replayEnded).toBe(true);
			// Jittered frame times (2 to 100 ms) and wall-clock budgets must not reach the sim.
			const b = counted(base);
			const real = runDemo(b.src, false, (i) => 0.002 + ((i * 37) % 98) / 1000);
			expect(real.log.shots).toEqual(fixed.log.shots);
			expect(real.log.verified).toBe(true);
			expect(fixed.d.session.phase).toBe(PHASE.RUN_DONE);
			// Worlds: everything freed once the drivers are disposed.
			fixed.d.dispose();
			real.d.dispose();
			expect(a.live()).toBe(0);
			expect(b.live()).toBe(0);
		},
		300_000,
	);

	it("ignores replay requests before the run ends and can skip a replay", async () => {
		const src = await worldSource();
		const ended: boolean[] = [];
		const d = new Driver(
			src,
			{ seed: 2, startLevel: 0, demo: true, fixed: true, levels: [MINI] },
			{
				level: () => {},
				fire: () => {},
				shotDone: () => {},
				tick: () => {},
				replayStart: () => {},
				replayVerified: () => {},
				replayEnd: () => ended.push(true),
			},
		);
		d.begin();
		d.requestReplay(); // too early: dropped, not latched
		let i = 0;
		while (d.state !== "replay" && i++ < 20000) d.frame(1 / 60);
		expect(d.state).toBe("replay");
		// The replay started from the demo's own request after the run, not the early one;
		// a request during the replay is ignored, and skipping ends it at once.
		d.requestReplay();
		d.skipReplay();
		expect(d.state).toBe("play");
		expect(ended.length).toBe(1);
		for (let k = 0; k < 2000; k++) d.frame(1 / 60);
		expect(d.state).toBe("play");
		d.dispose();
	}, 300_000);
});

describe("worker protocol", () => {
	const tick = (n: number, status = false): WorkerMsg => ({
		t: "tick",
		buf: new Float32Array([n]),
		balls: 0,
		live: { tick: n, awake: 0, tickMs: 0, pace: 1, knockedKg: 0, bot: null },
		...(status ? { status: { tick: n } as never } : {}),
	});

	it("keeps at most the newest ticks queued, recycling the rest, and never drops events", () => {
		const q: WorkerMsg[] = [];
		const recycled: number[] = [];
		const rec = (b: Float32Array) => recycled.push(b[0] as number);
		enqueue(q, tick(1, true), rec);
		enqueue(q, { t: "fire", shot: { tick: 1, vx: 0, vy: 0, vz: 0 } }, rec);
		// A hidden tab: thousands of ticks arrive while no frame drains the queue.
		for (let n = 2; n < 5000; n++) enqueue(q, tick(n), rec);
		const ticks = q.filter((m) => m.t === "tick");
		expect(ticks.length).toBe(MAX_QUEUED_TICKS);
		expect(q.length).toBe(MAX_QUEUED_TICKS + 1);
		expect(q.some((m) => m.t === "fire")).toBe(true);
		expect(recycled.length).toBe(4999 - MAX_QUEUED_TICKS);
		// The newest ticks survive, and the dropped tick's full status carried forward.
		const last = ticks[ticks.length - 1] as Extract<WorkerMsg, { t: "tick" }>;
		expect(last.live.tick).toBe(4999);
		expect(
			ticks.some((m) => (m as Extract<WorkerMsg, { t: "tick" }>).status),
		).toBe(true);
	});

	it("keeps only the newest status message", () => {
		const q: WorkerMsg[] = [];
		for (let n = 0; n < 50; n++)
			enqueue(q, { t: "status", status: { tick: n } as never }, () => {});
		expect(q.length).toBe(1);
	});

	it("packSite + MirrorSite reproduce a Site's block and ball poses", async () => {
		const src = await worldSource();
		const site = new Site(src, MINI, 3);
		site.fire({ tick: 0, vx: 0, vy: 0, vz: -20 });
		for (let i = 0; i < 30; i++) site.step();
		const buf = new Float32Array((site.n + 4) * 8);
		const balls = packSite(site, buf);
		expect(balls).toBe(1);
		const m = new MirrorSite(MINI, 3);
		m.apply(buf, balls, true);
		for (let i = 0; i < site.n; i++)
			for (let k = 0; k < 8; k++)
				expect(m.curr[i * 8 + k]).toBe(
					site.curr[(site.slots[i] as number) * 8 + k],
				);
		const bs = (site.ballSlots[0] as number) * 8;
		expect(m.curr[(m.ballSlots[0] as number) * 8 + 2]).toBe(site.curr[bs + 2]);
		expect(m.awakeBlocks()).toBe(site.awakeBlocks());
		site.free();
	}, 60_000);
});
