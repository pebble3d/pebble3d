import { cameraRelativeInput } from "@pebble3d/sdk/input";
import { describe, expect, it } from "vitest";
import courtyardJson from "../src/data/courtyard.json" with { type: "json" };
import worldJson from "../src/data/yard.json" with { type: "json" };
import { DemoBot, segmentHitsBox } from "../src/game/bot.ts";
import { DAY_TICKS, FILM, REVEAL_RADIUS } from "../src/game/constants.ts";
import {
	BTN,
	emptyInput,
	InputLog,
	quantizeInput,
	type TickInput,
} from "../src/game/input.ts";
import {
	END,
	EV,
	FieldSim,
	type OcclusionQuery,
	PHASE,
	RESULTS_LOCK,
	type WorldDef,
} from "../src/game/sim.ts";

const WORLD = worldJson as unknown as WorldDef;
const COURTYARD = courtyardJson as unknown as WorldDef;
const noOcclusion: OcclusionQuery = () => false;

function sim(seed = 23, occlusion = noOcclusion): FieldSim {
	return new FieldSim({ seed, world: WORLD, occlusion });
}

/**
 * Headless stand-in for the engine's character: camera-relative walking at the scene's
 * speeds, clamped to the bounds (the bot routes around obstacles itself).
 */
class Walker {
	x: number;
	z: number;
	private readonly dir = new Float32Array(2);
	constructor(private readonly world: WorldDef) {
		this.x = world.playerStart[0];
		this.z = world.playerStart[1];
	}
	step(i: TickInput, phase: number): void {
		if (phase !== PHASE.EXPLORE) return;
		const b = i.buttons;
		cameraRelativeInput(
			{
				f: (b & BTN.F) !== 0,
				b: (b & BTN.B) !== 0,
				l: (b & BTN.L) !== 0,
				r: (b & BTN.R) !== 0,
			},
			i.camYaw,
			this.dir,
		);
		const v = (b & BTN.SPRINT ? 4.6 : 1.6) / 60;
		const m = this.world.bounds;
		this.x = Math.min(
			m.max[0] - 0.3,
			Math.max(m.min[0] + 0.3, this.x + (this.dir[0] as number) * v),
		);
		this.z = Math.min(
			m.max[1] - 0.3,
			Math.max(m.min[1] + 0.3, this.z + (this.dir[1] as number) * v),
		);
		// Capsule (r 0.3) against the obstacle boxes: push out along the shallow axis.
		for (const o of this.world.obstacles) {
			const px = o.hx + 0.3 - Math.abs(this.x - o.x);
			const pz = o.hz + 0.3 - Math.abs(this.z - o.z);
			if (px <= 0 || pz <= 0) continue;
			if (px < pz) this.x += Math.sign(this.x - o.x) * px;
			else this.z += Math.sign(this.z - o.z) * pz;
		}
	}
}

/** Runs the demo bot against a headless walker; returns the sim and the input log. */
/**
 * The engine's static-only occlusion ray, headless: the obstacle boxes (y 0..h) plus the
 * bounds walls (0.5 m thick, 4 m tall, just outside the bounds), as the app spawns them.
 */
function boxOcclusion(world: WorldDef): OcclusionQuery {
	const b = world.bounds;
	const boxes: number[][] = world.obstacles.map((o) => [
		o.x - o.hx,
		0,
		o.z - o.hz,
		o.x + o.hx,
		o.h,
		o.z + o.hz,
	]);
	const [x0, z0] = b.min;
	const [x1, z1] = b.max;
	boxes.push(
		[x0 - 0.5, 0, z0 - 0.5, x0, 4, z1 + 0.5],
		[x1, 0, z0 - 0.5, x1 + 0.5, 4, z1 + 0.5],
		[x0 - 0.5, 0, z0 - 0.5, x1 + 0.5, 4, z0],
		[x0 - 0.5, 0, z1, x1 + 0.5, 4, z1 + 0.5],
	);
	return (ox, oy, oz, dx, dy, dz, max) => {
		const o = [ox, oy, oz];
		const d = [dx, dy, dz];
		for (const bx of boxes) {
			let t0 = 0;
			let t1 = max;
			let hit = true;
			for (let k = 0; k < 3 && hit; k++) {
				const lo = bx[k] as number;
				const hi = bx[k + 3] as number;
				const ok = o[k] as number;
				const dk = d[k] as number;
				if (Math.abs(dk) < 1e-9) {
					if (ok < lo || ok > hi) hit = false;
					continue;
				}
				let a = (lo - ok) / dk;
				let c = (hi - ok) / dk;
				if (a > c) [a, c] = [c, a];
				t0 = Math.max(t0, a);
				t1 = Math.min(t1, c);
				if (t0 > t1) hit = false;
			}
			if (hit) return true;
		}
		return false;
	};
}

function runDemo(
	seed: number,
	ticks: number,
	world = WORLD,
	occlusion: OcclusionQuery = noOcclusion,
): { s: FieldSim; log: InputLog; track: Float64Array } {
	const s = new FieldSim({ seed, world, occlusion });
	const bot = new DemoBot(s, world, 0, 10);
	const w = new Walker(world);
	const input = emptyInput();
	const log = new InputLog();
	const track = new Float64Array(ticks * 2);
	for (let t = 0; t < ticks && s.phase !== PHASE.RESULTS; t++) {
		bot.next(input);
		quantizeInput(input);
		log.push(input);
		s.setPlayer(w.x, 0.8, w.z);
		track[t * 2] = w.x;
		track[t * 2 + 1] = w.z;
		s.step(input);
		w.step(input, s.phase);
	}
	return { s, log, track };
}

describe("FieldSim", () => {
	it("places the six anomalies on distinct world spots, by seed", () => {
		const a = sim(1);
		const b = sim(1);
		const c = sim(2);
		const key = (s: FieldSim) =>
			s.anomalies.map((x) => `${x.x},${x.z}`).join("|");
		expect(key(a)).toBe(key(b));
		expect(key(a)).not.toBe(key(c));
		expect(new Set(key(a).split("|")).size).toBe(6);
	});

	it("title -> explore on start; anomalies reveal when the player comes close", () => {
		const s = sim();
		const i = emptyInput();
		s.step(i);
		expect(s.phase).toBe(PHASE.TITLE);
		i.buttons = BTN.START;
		s.step(i);
		expect(s.phase).toBe(PHASE.EXPLORE);
		const a = s.anomalies[0];
		if (!a) throw new Error("no anomaly");
		i.buttons = 0;
		s.setPlayer(a.x + REVEAL_RADIUS + 1, 0.8, a.z);
		s.step(i);
		expect(a.revealed).toBe(false);
		expect(s.signal).toBeGreaterThan(0.5);
		s.setPlayer(a.x + REVEAL_RADIUS - 0.5, 0.8, a.z);
		s.step(i);
		expect(a.revealed).toBe(true);
		expect(Array.from(s.events.type.slice(0, s.events.length))).toContain(
			EV.REVEAL,
		);
	});

	it("a framed, focused photo documents the anomaly and uses one frame", () => {
		const s = sim();
		const i = emptyInput();
		i.buttons = BTN.START;
		s.step(i);
		const a = s.anomalies[0];
		if (!a) throw new Error("no anomaly");
		// Stand 3 m south (+Z) of it, camera up, facing it (yaw 0 looks -Z).
		s.setPlayer(a.x, 0.8, a.z + 3);
		i.buttons = BTN.PHOTO;
		i.camYaw = 0;
		s.step(i);
		expect(s.phase).toBe(PHASE.PHOTO);
		i.buttons = BTN.AF;
		s.step(i);
		i.buttons = BTN.SHUTTER;
		s.step(i);
		expect(s.film).toBe(FILM - 1);
		const rec = s.photos[0];
		expect(rec?.used).toBe(true);
		expect(rec?.anomaly).toBe(0);
		expect(a.bestStars).toBeGreaterThan(0);
		expect(s.documented).toBe(1);
	});

	it("an obstructed subject scores far lower", () => {
		const shoot = (occ: OcclusionQuery): number => {
			const s = sim(23, occ);
			const i = emptyInput();
			i.buttons = BTN.START;
			s.step(i);
			const a = s.anomalies[0] as FieldSim["anomalies"][number];
			s.setPlayer(a.x, 0.8, a.z + 3);
			i.buttons = BTN.PHOTO;
			s.step(i);
			i.buttons = BTN.AF;
			s.step(i);
			i.buttons = BTN.SHUTTER;
			s.step(i);
			return s.photos[0]?.score.total ?? 0;
		};
		const clear = shoot(() => false);
		const blocked = shoot(() => true);
		expect(blocked).toBeLessThan(clear * 0.5);
	});

	it("the survey ends when the light goes", () => {
		const s = sim();
		const i = emptyInput();
		i.buttons = BTN.START;
		s.step(i);
		i.buttons = 0;
		for (let t = 0; t < DAY_TICKS + 5; t++) s.step(i);
		expect(s.phase).toBe(PHASE.RESULTS);
		expect(s.endReason).toBe(END.DARK);
	});

	it("the results ignore stray presses: START needs ~1 s and a fresh press", () => {
		const s = sim();
		const i = emptyInput();
		i.buttons = BTN.START;
		s.step(i);
		i.buttons = 0;
		for (let t = 0; t < DAY_TICKS + 5; t++) s.step(i);
		expect(s.phase).toBe(PHASE.RESULTS);
		// A shutter click still held / repeated as the results appear: ignored.
		i.buttons = BTN.START;
		s.step(i);
		expect(s.restartRequested).toBe(false);
		i.buttons = 0;
		s.step(i);
		i.buttons = BTN.START;
		s.step(i); // fresh press, but within the lock
		expect(s.restartRequested).toBe(false);
		i.buttons = 0;
		for (let t = 0; t < RESULTS_LOCK; t++) s.step(i);
		i.buttons = BTN.START;
		s.step(i);
		expect(s.restartRequested).toBe(true);
	});

	it("a key held since before the results never restarts", () => {
		const s = sim();
		const i = emptyInput();
		i.buttons = BTN.START;
		s.step(i);
		i.buttons = 0;
		for (let t = 0; t < DAY_TICKS - 10; t++) s.step(i);
		i.buttons = BTN.START; // held through the end of the day and beyond
		for (let t = 0; t < RESULTS_LOCK * 3; t++) s.step(i);
		expect(s.phase).toBe(PHASE.RESULTS);
		expect(s.restartRequested).toBe(false);
	});

	it("the survey ends when the roll is used up", () => {
		const s = sim();
		const i = emptyInput();
		i.buttons = BTN.START;
		s.step(i);
		i.buttons = BTN.PHOTO;
		s.step(i);
		for (let n = 0; n < FILM; n++) {
			i.buttons = BTN.SHUTTER;
			s.step(i);
			i.buttons = 0;
			for (let t = 0; t < 40; t++) s.step(i);
		}
		expect(s.film).toBe(0);
		for (let t = 0; t < 200; t++) s.step(i);
		expect(s.phase).toBe(PHASE.RESULTS);
		expect(s.endReason).toBe(END.FILM);
	});
});

describe("demo bot (headless walker)", () => {
	it("documents all six anomalies before the light goes", () => {
		for (const seed of [23, 24, 25, 99]) {
			const { s } = runDemo(seed, DAY_TICKS);
			expect(s.phase, `seed ${seed}`).toBe(PHASE.RESULTS);
			expect(s.endReason, `seed ${seed}`).toBe(END.ALL);
			expect(s.totalStars, `seed ${seed}`).toBeGreaterThanOrEqual(12);
		}
	});

	it("documents all six in the courtyard flat too (furniture, two rooms)", () => {
		for (const seed of [23, 24, 25, 99]) {
			const { s } = runDemo(seed, DAY_TICKS, COURTYARD);
			expect(s.phase, `seed ${seed}`).toBe(PHASE.RESULTS);
			expect(s.endReason, `seed ${seed}`).toBe(END.ALL);
		}
	});

	it("every spot on both sites lies inside the play bounds", () => {
		for (const w of [WORLD, COURTYARD])
			for (const p of w.spots) {
				expect(p.x, JSON.stringify(p)).toBeGreaterThan(w.bounds.min[0]);
				expect(p.x, JSON.stringify(p)).toBeLessThan(w.bounds.max[0]);
				expect(p.z, JSON.stringify(p)).toBeGreaterThan(w.bounds.min[1]);
				expect(p.z, JSON.stringify(p)).toBeLessThan(w.bounds.max[1]);
			}
	});

	it("with occlusion on (obstacles and bounds walls), every spot is reachable and gets a clear star", () => {
		// Ten seeds cover every spot on both sites; each anomaly must be documented with a
		// photo that is not obstructed.
		for (const w of [WORLD, COURTYARD]) {
			const used = new Set<string>();
			for (let seed = 1; seed <= 10; seed++) {
				const { s } = runDemo(seed, DAY_TICKS, w, boxOcclusion(w));
				expect(s.endReason, `seed ${seed}`).toBe(END.ALL);
				for (const a of s.anomalies) {
					used.add(`${a.x},${a.z}`);
					expect(a.bestStars, `seed ${seed} ${a.def.id}`).toBeGreaterThan(0);
				}
				for (const p of s.photos)
					if (p.used && p.anomaly >= 0)
						expect(p.score.occluded, `seed ${seed}`).toBe(false);
			}
			expect(used.size).toBe(w.spots.length);
		}
	});

	it("puts the standing door on open floor", () => {
		for (const w of [WORLD, COURTYARD])
			for (let seed = 1; seed < 40; seed++) {
				const s = new FieldSim({ seed, world: w, occlusion: noOcclusion });
				const door = s.anomalies.find((a) => a.def.id === "door");
				const spot = w.spots.find((p) => p.x === door?.x && p.z === door?.z);
				expect(spot?.floor, `seed ${seed}`).toBe(true);
			}
	});

	it("is deterministic: the same seed gives the same input log and state hash", () => {
		const a = runDemo(31, 4000);
		const b = runDemo(31, 4000);
		expect(a.s.hash()).toBe(b.s.hash());
		expect(a.log.length).toBe(b.log.length);
		const ia = emptyInput();
		const ib = emptyInput();
		for (let t = 0; t < a.log.length; t++) {
			a.log.read(t, ia);
			b.log.read(t, ib);
			expect(ia).toEqual(ib);
		}
	});

	it("replaying the logged inputs over the same track reproduces the run", () => {
		const { s, log, track } = runDemo(42, 4000);
		const r = sim(42);
		const i = emptyInput();
		for (let t = 0; t < log.length; t++) {
			log.read(t, i);
			r.setPlayer(track[t * 2] as number, 0.8, track[t * 2 + 1] as number);
			r.step(i);
		}
		expect(r.hash()).toBe(s.hash());
		expect(r.score).toBe(s.score);
	});
});

describe("segmentHitsBox", () => {
	it("detects crossings and misses", () => {
		expect(segmentHitsBox(-2, 0, 2, 0, 0, 0, 0.5, 0.5)).toBe(true);
		expect(segmentHitsBox(-2, 1, 2, 1, 0, 0, 0.5, 0.5)).toBe(false);
		expect(segmentHitsBox(0, -2, 0, -1, 0, 0, 0.5, 0.5)).toBe(false);
	});
});
