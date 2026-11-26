import { describe, expect, it } from "vitest";
import { gateBars, gatesOf, parseTrack, yawQuat } from "../src/game/track.ts";
import { SITE, TRACKS } from "../src/game/tracks.ts";
import hall from "../tracks/hall-circuit.json" with { type: "json" };

describe("tracks as JSON", () => {
	it("ships at least two valid tracks on the yard", () => {
		expect(TRACKS.length).toBeGreaterThanOrEqual(2);
		for (const t of TRACKS) expect(t.site).toBe("yard");
	});

	it("rejects gates outside the crisp flight volume or through the ceiling", () => {
		const bad = structuredClone(hall);
		(bad.gates[1] as { p: number[] }).p = [3, 1.4, 16.5]; // south of z 14.3: drone blur
		expect(() => parseTrack(bad, SITE)).toThrow(/outside the site bounds/);
		const tall = structuredClone(hall);
		(tall.gates[1] as { p: number[] }).p = [3, 5.2, 11];
		expect(() => parseTrack(tall, SITE)).toThrow(/ceiling/);
		const medals = structuredClone(hall);
		medals.medals.gold = 20;
		expect(() => parseTrack(medals, SITE)).toThrow(/medals/);
	});

	it("gate frames: yaw turns -Z onto the fly-through direction; the opening is clear", () => {
		const [qy, qw] = yawQuat(-1, 0);
		// rotate (0, 0, -1) by the yaw quaternion (0, qy, 0, qw)
		const x = -2 * qy * qw;
		const z = -(1 - 2 * qy * qy);
		expect(x).toBeCloseTo(-1, 6);
		expect(z).toBeCloseTo(0, 6);
		for (const t of TRACKS)
			for (const g of gatesOf(t)) {
				const bars = gateBars(g);
				// side posts sit outside the opening, the top bar above it
				for (const b of bars.slice(0, 2))
					expect(Math.abs(b.lx) - b.hx).toBeGreaterThanOrEqual(g.w / 2 - 1e-9);
				const top = bars[2] as { ly: number; hy: number };
				expect(top.ly - top.hy).toBeGreaterThanOrEqual(g.cy + g.h / 2 - 1e-9);
			}
	});
});
