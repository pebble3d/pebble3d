import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_BOT, DroneBot } from "../src/game/bot.ts";
import { COUNTDOWN_TICKS } from "../src/game/constants.ts";
import { EV } from "../src/game/events.ts";
import { emptyInput, InputLog, type TickInput } from "../src/game/input.ts";
import type { PhysicsHost } from "../src/game/physics.ts";
import { DroneSim, PHASE } from "../src/game/sim.ts";
import { SITE, TRACKS, trackById } from "../src/game/tracks.ts";
import { nodeHost } from "./helpers.ts";

let host: PhysicsHost;
beforeAll(async () => {
	host = await nodeHost();
});

/** Flies the demo bot to the finish, logging inputs. */
function botRace(trackId: string): {
	sim: DroneSim;
	log: InputLog;
	events: number[];
} {
	const sim = new DroneSim(host, trackById(trackId), SITE, "assisted");
	const bot = new DroneBot(sim);
	const log = new InputLog();
	const inp = emptyInput();
	const events: number[] = [];
	while (sim.phase !== PHASE.FINISHED && sim.tick < 60 * 90) {
		bot.next(inp);
		log.push(inp);
		sim.step(inp);
		for (let k = 0; k < sim.events.length; k++)
			events.push(sim.events.type[k] as number);
	}
	return { sim, log, events };
}

describe("DroneSim", () => {
	it.each(TRACKS.map((t) => t.id))(
		"the demo bot flies every lap of %s cleanly",
		(id) => {
			const { sim, events } = botRace(id);
			expect(sim.phase).toBe(PHASE.FINISHED);
			expect(sim.lapTimes).toHaveLength(sim.track.laps);
			expect(sim.crashes).toBe(0);
			// every gate, every lap, in order
			expect(events.filter((e) => e === EV.GATE)).toHaveLength(
				sim.track.laps * sim.gates.length + 1,
			);
			for (const t of sim.lapTimes)
				expect(t).toBeLessThan(sim.track.medals.silver);
			sim.free();
		},
	);

	it("is deterministic: the same inputs give the same hash, the replay of a log too", () => {
		const a = botRace("hall-circuit");
		const b = botRace("hall-circuit");
		expect(a.sim.hash()).toBe(b.sim.hash());
		const replay = new DroneSim(
			host,
			trackById("hall-circuit"),
			SITE,
			"assisted",
		);
		const inp = emptyInput();
		for (let t = 0; t < a.log.length; t++) replay.step(a.log.read(t, inp));
		expect(replay.hash()).toBe(a.sim.hash());
		expect(replay.lapTimes).toEqual(a.sim.lapTimes);
		for (const s of [a.sim, b.sim, replay]) s.free();
	});

	it("holds the drone on the pad through the countdown, then GO", () => {
		const sim = new DroneSim(host, trackById("hall-circuit"), SITE, "assisted");
		const full: TickInput = { throttle: 127, yaw: 0, pitch: 127, roll: 0 };
		const y0 = sim.pos[1] as number;
		const seen: number[] = [];
		for (let t = 0; t < COUNTDOWN_TICKS - 1; t++) {
			sim.step(full);
			for (let k = 0; k < sim.events.length; k++)
				seen.push(sim.events.type[k] as number, sim.events.a[k] as number);
		}
		expect(Math.abs((sim.pos[1] as number) - y0)).toBeLessThan(0.01);
		expect(seen).toEqual([EV.COUNT, 3, EV.COUNT, 2, EV.COUNT, 1]);
		sim.step(full);
		expect(sim.events.type[0]).toBe(EV.GO);
		expect(sim.phase).toBe(PHASE.RACE);
		for (let t = 0; t < 30; t++) sim.step(full);
		expect(sim.pos[1] as number).toBeGreaterThan(y0 + 0.5);
		sim.free();
	});

	it("assisted mode auto-levels and holds altitude with the sticks centred", () => {
		const sim = new DroneSim(host, trackById("hall-circuit"), SITE, "assisted");
		const inp = emptyInput();
		inp.throttle = 127;
		for (let t = 0; t < COUNTDOWN_TICKS + 40; t++) sim.step(inp);
		inp.throttle = 0;
		inp.roll = 90;
		for (let t = 0; t < 20; t++) sim.step(inp);
		expect(sim.up[1] as number).toBeLessThan(0.95); // tilted while the stick is held
		inp.roll = 0;
		for (let t = 0; t < 40; t++) sim.step(inp);
		const y = sim.pos[1] as number;
		for (let t = 0; t < 120; t++) sim.step(inp);
		expect(sim.up[1] as number).toBeGreaterThan(0.995);
		expect(Math.abs((sim.pos[1] as number) - y)).toBeLessThan(0.15);
		expect(Math.abs(sim.vel[1] as number)).toBeLessThan(0.05);
		expect(sim.speed()).toBeLessThan(0.6); // the brake bleeds off drift
		sim.free();
	});

	it("acro mode: stick commands body rates and the drone keeps its attitude when released", () => {
		const sim = new DroneSim(host, trackById("hall-circuit"), SITE, "acro");
		const inp = emptyInput();
		inp.throttle = 60;
		for (let t = 0; t < COUNTDOWN_TICKS + 30; t++) sim.step(inp);
		inp.roll = 127;
		sim.step(inp);
		sim.step(inp);
		sim.step(inp);
		sim.step(inp);
		// rolling right at close to the full rate, about the nose axis
		const w = sim.ang;
		const f = sim.fwd;
		const along =
			(w[0] as number) * (f[0] as number) +
			(w[1] as number) * (f[1] as number) +
			(w[2] as number) * (f[2] as number);
		expect(along).toBeGreaterThan(5);
		inp.roll = 0;
		for (let t = 0; t < 10; t++) sim.step(inp);
		const up0 = sim.up[1] as number;
		for (let t = 0; t < 5; t++) sim.step(inp);
		// no auto-level in acro: the tilt stays
		expect(up0).toBeLessThan(0.9);
		expect(Math.abs((sim.up[1] as number) - up0)).toBeLessThan(0.05);
		sim.free();
	});

	it("crashing into a proxy collider blacks out, respawns at the last gate and counts", () => {
		const sim = new DroneSim(host, trackById("hall-circuit"), SITE, "assisted");
		const inp = emptyInput();
		inp.throttle = 127;
		for (let t = 0; t < COUNTDOWN_TICKS + 25; t++) sim.step(inp);
		// full forward toward the west at head height: the hall facade is north, so roll left
		// (north is the drone's right when facing west? it faces -x, right = -z = north)
		inp.throttle = 0;
		inp.roll = 127;
		const seen = new Set<number>();
		for (let t = 0; t < 600 && sim.crashes === 0; t++) {
			sim.step(inp);
			for (let k = 0; k < sim.events.length; k++)
				seen.add(sim.events.type[k] as number);
		}
		expect(sim.crashes).toBe(1);
		expect(seen.has(EV.CRASH)).toBe(true);
		inp.roll = 0;
		for (let t = 0; t < 70; t++) {
			sim.step(inp);
			for (let k = 0; k < sim.events.length; k++)
				seen.add(sim.events.type[k] as number);
		}
		expect(seen.has(EV.RESPAWN)).toBe(true);
		// back over the pad, upright and hovering
		const pad = trackById("hall-circuit").pad.p;
		expect(Math.abs((sim.pos[0] as number) - pad[0])).toBeLessThan(0.5);
		expect(sim.up[1] as number).toBeGreaterThan(0.95);
		expect(sim.pos[1] as number).toBeGreaterThan(0.6);
		sim.free();
	});
});

describe("?demo=1 pilot", () => {
	it.each(TRACKS.map((t) => t.id))(
		"improves lap by lap on %s without crashing",
		(id) => {
			const sim = new DroneSim(host, trackById(id), SITE, "assisted");
			const bot = new DroneBot(sim, DEMO_BOT);
			const inp = emptyInput();
			while (sim.phase !== PHASE.FINISHED && sim.tick < 60 * 90)
				sim.step(bot.next(inp));
			expect(sim.crashes).toBe(0);
			expect(sim.lapTimes).toHaveLength(3);
			const [a, b, c] = sim.lapTimes as [number, number, number];
			// each lap beats the last by a visible margin: the ghost trails the live drone
			expect(b).toBeLessThan(a - 0.3);
			expect(c).toBeLessThan(b - 0.2);
			sim.free();
		},
	);
});

describe("InputLog", () => {
	it("round-trips through run-length base64", () => {
		const { log, sim } = botRace("needle-and-eaves");
		sim.free();
		const back = InputLog.decode(log.encode());
		expect(back.length).toBe(log.length);
		const a = emptyInput();
		const b = emptyInput();
		for (let t = 0; t < log.length; t++)
			expect(back.read(t, b)).toEqual(log.read(t, a));
		expect(() => InputLog.decode("AAAA")).toThrow();
		expect(() => InputLog.decode(log.encode(), 10)).toThrow();
	});
});
