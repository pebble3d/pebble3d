import { describe, expect, it } from "vitest";
import { DemoBot } from "../src/game/bot.ts";
import { moverPose, parseCourse, yawTilt } from "../src/game/course.ts";
import { BTN, emptyInput, InputLog } from "../src/game/input.ts";
import { COUNTDOWN, EV, PHASE } from "../src/game/sim.ts";
import { loadCourse, nodeHost, SkyrunSim } from "./helpers.ts";

const COURSES = ["dawnsteps", "gale-spires"] as const;

function runBot(
	host: Awaited<ReturnType<typeof nodeHost>>,
	id: string,
	log?: InputLog,
	style: "fast" | "steady" = "fast",
): SkyrunSim {
	const sim = new SkyrunSim(host, loadCourse(id));
	const bot = new DemoBot(sim, style);
	const inp = emptyInput();
	for (let t = 0; t < 60 * 120 && sim.phase !== PHASE.DONE; t++) {
		bot.next(inp);
		log?.push(inp);
		sim.step(inp);
	}
	return sim;
}

describe("courses", () => {
	it("both shipped courses parse", () => {
		for (const id of COURSES) {
			const c = loadCourse(id);
			expect(c.checkpoints.length).toBeGreaterThanOrEqual(3);
			expect(c.shards.length).toBe(8);
			expect(c.medals.gold).toBeLessThan(c.medals.silver);
			expect(c.medals.silver).toBeLessThan(c.medals.bronze);
		}
	});

	it("reports readable errors", () => {
		expect(() => parseCourse({ id: "x" })).toThrow(/invalid course: name/);
		const c = structuredClone(loadCourse("dawnsteps")) as Record<
			string,
			unknown
		>;
		(c.movers as Record<string, unknown>[])[0] = {
			id: "m",
			kind: "slide",
			size: [1, 1, 1],
			pos: [0, 0, 0],
		};
		expect(() => parseCourse(c)).toThrow(/slide mover "m" needs "to"/);
	});

	it("slide movers rest at both ends and stay between them", () => {
		const m = loadCourse("dawnsteps").movers[0];
		if (!m?.to) throw new Error("ferry");
		const p = new Float64Array(3);
		const q = new Float64Array(4);
		moverPose(m, 0, p, q);
		expect(p[0]).toBeCloseTo(m.pos[0], 6);
		moverPose(m, m.period / 2, p, q);
		expect(p[0]).toBeCloseTo(m.to[0], 6);
		for (let s = 0; s < m.period; s += 0.05) {
			moverPose(m, s, p, q);
			const lo = Math.min(m.pos[0], m.to[0]);
			const hi = Math.max(m.pos[0], m.to[0]);
			expect(p[0]).toBeGreaterThanOrEqual(lo - 1e-9);
			expect(p[0]).toBeLessThanOrEqual(hi + 1e-9);
		}
	});

	it("yawTilt is a unit quaternion", () => {
		const [x, y, z, w] = yawTilt(37, 18);
		expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
	});
});

describe("sim", () => {
	for (const id of COURSES) {
		it(`the demo bot finishes ${id} with every checkpoint`, async () => {
			const host = await nodeHost();
			const sim = runBot(host, id);
			expect(sim.phase).toBe(PHASE.DONE);
			expect(sim.nextCheckpoint).toBe(sim.course.checkpoints.length);
			expect(sim.falls).toBe(0);
			expect(sim.shards).toBeGreaterThanOrEqual(5);
			// The bot is a fair benchmark: inside silver, near gold.
			expect(sim.time).toBeLessThan(sim.course.medals.silver);
			sim.free();
		});
	}

	it("a run replays bit-exactly from its input log (the ghost)", async () => {
		const host = await nodeHost();
		const log = new InputLog();
		const live = runBot(host, "gale-spires", log, "steady");
		const ghost = new SkyrunSim(host, loadCourse("gale-spires"));
		const inp = emptyInput();
		const back = InputLog.decode(log.encode());
		for (let t = 0; t < back.length; t++) ghost.step(back.read(t, inp));
		expect(ghost.hash()).toBe(live.hash());
		expect(ghost.runTicks).toBe(live.runTicks);
		live.free();
		ghost.free();
	});

	it("no control during the countdown, then GO", async () => {
		const host = await nodeHost();
		const sim = new SkyrunSim(host, loadCourse("dawnsteps"));
		const inp = emptyInput();
		inp.z = -127;
		inp.buttons = BTN.SPRINT;
		const z0 = sim.pz;
		let go = -1;
		for (let t = 0; t < COUNTDOWN + 30; t++) {
			sim.step(inp);
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.GO) go = sim.tick;
			if (sim.tick < COUNTDOWN) expect(sim.pz).toBeCloseTo(z0, 3);
		}
		expect(go).toBe(COUNTDOWN);
		expect(sim.pz).toBeLessThan(z0 - 1);
		expect(sim.runTicks).toBe(30);
		sim.free();
	});

	it("falling off respawns at the last checkpoint and keeps the clock running", async () => {
		const host = await nodeHost();
		const sim = new SkyrunSim(host, loadCourse("dawnsteps"));
		const inp = emptyInput();
		for (let t = 0; t < COUNTDOWN; t++) sim.step(inp);
		// Walk straight off the start island's east edge.
		inp.x = 127;
		let respawned = false;
		for (let t = 0; t < 400 && !respawned; t++) {
			sim.step(inp);
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.RESPAWN) respawned = true;
		}
		expect(respawned).toBe(true);
		expect(sim.falls).toBe(1);
		const s = sim.course.start.pos;
		expect(Math.hypot(sim.px - s[0], sim.pz - s[2])).toBeLessThan(0.1);
		expect(sim.runTicks).toBeGreaterThan(60);
		sim.free();
	});

	it("the runner rides the ferry (ridePlatforms)", async () => {
		const host = await nodeHost();
		const course = loadCourse("dawnsteps");
		const sim = new SkyrunSim(host, course);
		const k = sim.moverIndex.get("ferry") ?? -1;
		const mp = new Float64Array(3);
		const inp = emptyInput();
		// Drop the runner onto the ferry while it rests at its near end (cycle start at
		// 7 s = tick 420), then idle.
		for (let t = 0; t < 405; t++) sim.step(inp);
		sim.world.teleport(sim.playerId, -21.4, 4.27 + 0.85, -16);
		for (let t = 0; t < 20; t++) sim.step(inp);
		expect(sim.grounded).toBe(true);
		for (let t = 0; t < 200; t++) {
			sim.step(inp);
			sim.moverPos(k, mp);
			expect(Math.abs(sim.px - (mp[0] as number))).toBeLessThan(0.05);
		}
		expect(sim.px).toBeLessThan(-25); // carried well along its track
		sim.free();
	});

	it("slope limit: a 30° ramp is walkable, a 56° slab is not", async () => {
		const host = await nodeHost();
		const climb = (tilt: number): number => {
			const course = parseCourse({
				id: "slope",
				name: "Slope",
				tagline: "",
				medals: { gold: 1, silver: 2, bronze: 3 },
				killY: -20,
				start: { pos: [0, 0, 3] },
				islands: [{ pos: [0, 0, 0], radius: 8 }],
				// Ramp rising toward -Z, its low edge on the island at z = -1.
				blocks: [
					{
						pos: [
							0,
							2 * Math.sin((tilt * Math.PI) / 180) - 0.1,
							-1 - 2 * Math.cos((tilt * Math.PI) / 180),
						],
						size: [3, 0.4, 4],
						tilt,
					},
				],
				goal: { pos: [0, 0, 7] },
				view: { eye: [0, 5, 5], target: [0, 0, 0] },
			});
			const sim = new SkyrunSim(host, course);
			const inp = emptyInput();
			for (let t = 0; t < COUNTDOWN; t++) sim.step(inp);
			inp.z = -127;
			let top = 0;
			for (let t = 0; t < 180; t++) {
				sim.step(inp);
				top = Math.max(top, sim.py);
			}
			sim.free();
			return top;
		};
		expect(climb(30)).toBeGreaterThan(2.2); // walked up most of the 2 m rise
		expect(climb(56)).toBeLessThan(1.4); // stopped at the foot (centre 0.8 + a step)
	});

	it("shipped par ghosts match the current rules; stale records are refused", async () => {
		const { readFileSync } = await import("node:fs");
		const { checkRecord } = await import("../src/game/ghost.ts");
		for (const id of COURSES) {
			const course = loadCourse(id);
			const par = JSON.parse(
				readFileSync(
					new URL(`../courses/${id}.par.json`, import.meta.url),
					"utf8",
				),
			);
			expect(checkRecord(par, course)).not.toBeNull();
			expect(checkRecord({ ...par, fp: "00000000" }, course)).toBeNull();
			expect(checkRecord({ ...par, inputs: "%%%" }, course)).toBeNull();
		}
	});
});
