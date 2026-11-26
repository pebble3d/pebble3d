import { describe, expect, it } from "vitest";
import { Bot } from "../src/game/bot.ts";
import { parseCourse } from "../src/game/course.ts";
import { COURSES } from "../src/game/courses.ts";
import { emptyInput, InputLog } from "../src/game/input.ts";
import { MarbleSim, PHASE } from "../src/game/sim.ts";
import { Track } from "../src/game/track.ts";
import { physicsHost } from "./helpers.ts";

const at = (a: Float64Array, i: number): number => a[i] as number;

describe.each(COURSES.map((c) => [c.id, c] as const))(
	"course %s",
	(_id, course) => {
		const t = new Track(course.track);

		it("has orthonormal frames along the whole centreline", () => {
			for (let i = 0; i < t.n; i++) {
				const tt = [at(t.tx, i), at(t.ty, i), at(t.tz, i)];
				const r = [at(t.rx, i), at(t.ry, i), at(t.rz, i)];
				const u = [at(t.ux, i), at(t.uy, i), at(t.uz, i)];
				const dot = (a: number[], b: number[]) =>
					(a[0] as number) * (b[0] as number) +
					(a[1] as number) * (b[1] as number) +
					(a[2] as number) * (b[2] as number);
				expect(Math.abs(dot(tt, tt) - 1)).toBeLessThan(1e-9);
				expect(Math.abs(dot(r, r) - 1)).toBeLessThan(1e-9);
				expect(Math.abs(dot(u, u) - 1)).toBeLessThan(1e-9);
				expect(Math.abs(dot(tt, r))).toBeLessThan(1e-9);
				expect(Math.abs(dot(tt, u))).toBeLessThan(1e-9);
				expect(at(t.uy, i)).toBeGreaterThan(0.5); // never upside down
			}
		});

		it("never passes within 4 m vertically over itself", () => {
			let worst = Number.POSITIVE_INFINITY;
			for (let i = 0; i < t.n; i += 2)
				for (let j = i + 80; j < t.n; j += 2) {
					const dh = Math.hypot(
						at(t.px, i) - at(t.px, j),
						at(t.pz, i) - at(t.pz, j),
					);
					if (dh > (at(t.width, i) + at(t.width, j)) / 2 + 2) continue;
					worst = Math.min(worst, Math.abs(at(t.py, i) - at(t.py, j)));
				}
			expect(worst).toBeGreaterThan(4);
		});

		it("splits deck pieces at gaps and builds valid trimeshes", () => {
			const gaps = course.track.segments.filter(
				(s) => s.gap !== undefined,
			).length;
			expect(t.pieces.length).toBe(gaps + 1);
			for (const c of t.colliders()) {
				const nv = c.vertices.length / 3;
				expect(c.indices.length % 3).toBe(0);
				expect(Math.max(...c.indices)).toBeLessThan(nv);
				expect(c.vertices.every(Number.isFinite)).toBe(true);
			}
			expect(t.finish).toBeGreaterThan(t.checkpoints.at(-1) ?? 0);
		});

		it("the demo bot finishes inside the bronze time on several seeds", async () => {
			const host = await physicsHost();
			for (const seed of [1, 2, 3]) {
				const sim = new MarbleSim(host, course, t, seed);
				const bot = new Bot(sim, course.bot);
				const inp = emptyInput();
				while (sim.phase !== PHASE.DONE && sim.tick < 60 * 120)
					sim.step(bot.next(inp));
				expect(sim.finishTime).toBeGreaterThan(0);
				expect(sim.finishTime).toBeLessThan(course.medals.bronze);
				expect(sim.splits.length).toBe(t.checkpoints.length + 1);
				sim.free();
			}
		});
	},
);

describe("input log", () => {
	it("round-trips through run-length base64", () => {
		const log = new InputLog();
		const i = emptyInput();
		for (let k = 0; k < 5000; k++) {
			i.x = k % 300 < 150 ? 127 : -((k * 7) % 128);
			i.z = k % 50 === 0 ? -127 : 0;
			i.buttons = k % 97 === 0 ? 3 : 0;
			log.push(i);
		}
		const back = InputLog.decode(log.encode());
		expect(back.length).toBe(log.length);
		expect(Array.from(back.bytes())).toEqual(Array.from(log.bytes()));
	});
});

describe("course validation", () => {
	it("names the bad field", () => {
		const bad = structuredClone(COURSES[0]) as unknown as {
			track: { segments: Record<string, unknown>[] };
		};
		(bad.track.segments[1] as Record<string, unknown>).turn = 30;
		expect(() => parseCourse(bad)).toThrow(
			/segments\[1\]: needs exactly one of/,
		);
	});
	it("requires exactly one finish", () => {
		const bad = structuredClone(COURSES[0]) as unknown as {
			track: { segments: Record<string, unknown>[] };
		};
		for (const s of bad.track.segments) delete s.finish;
		expect(() => parseCourse(bad)).toThrow(/exactly one finish/);
	});
});
