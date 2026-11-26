import { describe, expect, it } from "vitest";
import { EV } from "../src/game/events.ts";
import { Runner } from "../src/game/host.ts";
import { CMD } from "../src/game/input.ts";
import { SnapshotPump } from "../src/game/pump.ts";
import { PHASE } from "../src/game/sim.ts";
import {
	E_STRIDE,
	EF,
	H,
	newSnapshot,
	OFF_EVENTS,
} from "../src/game/snapshot.ts";
import { bannerFor } from "../src/game/ui/banner.ts";
import { makeSim } from "./helpers.ts";

function countEvents(snap: Float32Array, type: number): number {
	let k = 0;
	for (let e = 0; e < (snap[H.EVENTS] as number); e++)
		if (snap[OFF_EVENTS + e * E_STRIDE + EF.TYPE] === type) k++;
	return k;
}

describe("Runner batching (worker vs inline stepping)", () => {
	it("batch sizes 1, 3 and mixed give the same hash as plain stepping", async () => {
		const TICKS = 3000;
		const run = async (sizes: number[]): Promise<string> => {
			const r = new Runner(await makeSim({ seed: 7 }), true);
			const out = newSnapshot();
			let done = 0;
			let k = 0;
			while (done < TICKS) {
				const n = Math.min(sizes[k++ % sizes.length] as number, TICKS - done);
				r.run(n, out);
				done += n;
			}
			return r.sim.hash();
		};
		const one = await run([1]);
		expect(await run([3])).toBe(one);
		expect(await run([1, 2, 3, 2])).toBe(one);
	});

	it("a multi-tick batch keeps every tick's events", async () => {
		const sim = await makeSim({ autoStart: true });
		const r = new Runner(sim, false);
		const out = newSnapshot();
		r.run(1, out);
		r.queue.push(CMD.CALL_WAVE);
		r.run(3, out); // the wave starts on the first of these three ticks
		expect(out[H.TICKS]).toBe(3);
		expect(countEvents(out, EV.WAVE_START)).toBe(1);
	});
});

describe("snapshot backpressure", () => {
	it("holds at most two in flight, coalesces the rest, and pauses when unacknowledged", async () => {
		const r = new Runner(await makeSim({ seed: 7, autoStart: true }), true);
		const sent: Float32Array[] = [];
		const pump = new SnapshotPump(r, (b) => sent.push(b), 2, 6);
		for (let i = 0; i < 100; i++) pump.step(2);
		// Two posted, one pending holding 6 coalesced ticks, then the sim stopped.
		expect(sent.length).toBe(2);
		expect(pump.stalled).toBe(true);
		expect(r.sim.tick).toBe(2 + 2 + 6);
		// The main thread catches up: the coalesced snapshot goes out carrying all 6 ticks.
		pump.ack(sent[0] as Float32Array);
		expect(sent.length).toBe(3);
		expect((sent[2] as Float32Array)[H.TICKS]).toBe(6);
		expect((sent[2] as Float32Array)[H.TICK]).toBe(r.sim.tick);
		pump.ack(sent[1] as Float32Array);
		pump.ack(sent[2] as Float32Array);
		pump.step(1);
		expect(sent.length).toBe(4);
		expect(pump.inFlight).toBe(1);
	});

	it("coalescing does not change the simulation", async () => {
		const a = new Runner(await makeSim({ seed: 7 }), true);
		const b = new Runner(await makeSim({ seed: 7 }), true);
		const out = newSnapshot();
		const sent: Float32Array[] = [];
		const pump = new SnapshotPump(b, (s) => sent.push(s), 2, 6);
		let stepped = 0;
		for (let i = 0; stepped < 2400; i++) {
			stepped += pump.step(Math.min(3, 2400 - stepped));
			// The main thread acks irregularly.
			if (i % 3 === 0 && sent.length) pump.ack(sent.shift() as Float32Array);
		}
		for (let t = 0; t < 2400; t++) a.run(1, out);
		expect(b.sim.hash()).toBe(a.sim.hash());
	});
});

describe("wave banner", () => {
	it("shows the real bonus gold after a wave is held", async () => {
		const sim = await makeSim({ autoStart: true });
		const r = new Runner(sim, true);
		const out = newSnapshot();
		let banner: [string, string, number] | null = null;
		let goldBefore = 0;
		for (let t = 0; t < 60 * 120 && !banner?.[0].includes("HELD"); t++) {
			goldBefore = sim.gold;
			r.run(1, out);
			if (countEvents(out, EV.WAVE_CLEAR)) banner = bannerFor(out);
		}
		expect(sim.phase).toBe(PHASE.BUILD);
		expect(banner?.[0]).toBe("WAVE 1 HELD");
		const bonus = 40 + 12 * 1;
		expect(banner?.[1]).toBe(`+${bonus} bonus gold`);
		expect(sim.gold - goldBefore).toBeGreaterThanOrEqual(bonus);
	});
});
