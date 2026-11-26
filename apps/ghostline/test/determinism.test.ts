import { describe, expect, it } from "vitest";
import { Bot } from "../src/game/bot.ts";
import { COURSES, type Course } from "../src/game/courses.ts";
import {
	Ghost,
	type GhostRecord,
	recordOf,
	runToEnd,
	verifyRecord,
} from "../src/game/ghost.ts";
import { BTN, InputLog, type TickInput } from "../src/game/input.ts";
import { Rng } from "../src/game/rng.ts";
import { MarbleSim, PHASE } from "../src/game/sim.ts";
import { Track } from "../src/game/track.ts";
import { physicsHost } from "./helpers.ts";

/**
 * A "human-like" driver: the bot plus seeded wobble, taps of jump and brake. Its inputs are
 * deliberately noisy so the recorded run exercises every input path.
 */
function noisyDriver(sim: MarbleSim, course: Course, seed: number) {
	const bot = new Bot(sim, course.bot);
	const rng = new Rng(seed);
	return (out: TickInput): TickInput => {
		bot.next(out);
		out.x = Math.max(
			-127,
			Math.min(127, out.x + Math.round(rng.range(-40, 40))),
		);
		out.z = Math.max(
			-127,
			Math.min(127, out.z + Math.round(rng.range(-40, 40))),
		);
		if (rng.next() < 0.01) out.buttons |= BTN.JUMP;
		if (rng.next() < 0.02) out.buttons |= BTN.BRAKE;
		return out;
	};
}

interface Recorded {
	record: GhostRecord;
	hashes: string[];
}

async function recordRun(
	course: Course,
	seed: number,
	driverSeed: number,
): Promise<Recorded> {
	const host = await physicsHost();
	const track = new Track(course.track);
	const sim = new MarbleSim(host, course, track, seed);
	const log = new InputLog();
	const hashes: string[] = [];
	runToEnd(sim, noisyDriver(sim, course, driverSeed), log, 60 * 120, (s) =>
		hashes.push(s.hash()),
	);
	const record = recordOf(sim, log, "test");
	sim.free();
	return { record, hashes };
}

describe.each(COURSES.map((c) => [c.id, c] as const))(
	"determinism on %s",
	(_id, course) => {
		it("a recorded run re-simulates to the identical final state hash", async () => {
			const { record } = await recordRun(course, 1234, 99);
			expect(record.finishTime).toBeGreaterThan(0);
			const host = await physicsHost();
			const v = verifyRecord(host, course, new Track(course.track), record);
			expect(v.hash).toBe(record.hash);
			expect(v.finishTime).toBe(record.finishTime);
			expect(v.ok).toBe(true);
		});

		it("the ghost never diverges: identical hash on every tick, in lockstep with a live run", async () => {
			const { record, hashes } = await recordRun(course, 777, 5);
			const host = await physicsHost();
			const track = new Track(course.track);
			// A live run (different driver, different seed) steps between every ghost tick, in
			// the same wasm module: the ghost must not notice.
			const live = new MarbleSim(host, course, track, 4242);
			const liveDrive = noisyDriver(live, course, 31337);
			const ghost = new Ghost(host, course, track, record);
			const inp: TickInput = { x: 0, z: 0, buttons: 0 };
			let firstDivergence = -1;
			let t = 0;
			while (!ghost.ended) {
				if (live.phase !== PHASE.DONE) live.step(liveDrive(inp));
				ghost.step();
				if (firstDivergence < 0 && ghost.sim.hash() !== hashes[t])
					firstDivergence = t;
				t++;
			}
			expect(t).toBe(record.ticks);
			expect(firstDivergence).toBe(-1);
			expect(ghost.sim.finishTime).toBe(record.finishTime);
			expect(ghost.sim.splits).toEqual(record.splits);
			live.free();
			ghost.free();
		});

		it("the log carries the run: one changed input changes the outcome", async () => {
			const { record } = await recordRun(course, 1234, 99);
			const log = InputLog.decode(record.inputs);
			const bytes = log.bytes();
			const t = 400; // mid-run tick (after the countdown)
			bytes[t * 3] = bytes[t * 3] === 127 ? -127 : 127;
			const tampered = { ...record, inputs: InputLog.from(bytes).encode() };
			const host = await physicsHost();
			const v = verifyRecord(host, course, new Track(course.track), tampered);
			expect(v.ok).toBe(false);
			expect(v.hash).not.toBe(record.hash);
		});
	},
);

describe("seed", () => {
	it("is part of the run: same inputs, different seed -> different state where sweepers exist", async () => {
		const course = COURSES.find((c) => c.track.segments.some((s) => s.sweeper));
		if (!course) return;
		const { record } = await recordRun(course, 1, 7);
		const host = await physicsHost();
		const v = verifyRecord(host, course, new Track(course.track), {
			...record,
			seed: 2,
		});
		expect(v.ok).toBe(false);
	});
});

describe("shipped par ghosts", () => {
	it.each(COURSES.map((c) => [c.id, c] as const))(
		"%s re-simulates to its stored hash and time",
		async (_id, course) => {
			const { parGhost } = await import("../src/game/par.ts");
			const rec = parGhost(course.id);
			expect(rec).not.toBeNull();
			if (!rec) return;
			const v = verifyRecord(
				await physicsHost(),
				course,
				new Track(course.track),
				rec,
			);
			expect(v.hash).toBe(rec.hash);
			expect(v.finishTime).toBe(rec.finishTime);
			expect(rec.finishTime).toBeLessThan(course.medals.silver);
		},
	);
});
