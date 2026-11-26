import { describe, expect, it } from "vitest";
import { arcHits, circleHits, lineHits } from "../src/game/combat/hitbox.ts";

describe("hitboxes", () => {
	it("arc: in front within radius hits, behind misses", () => {
		const arc = (150 * Math.PI) / 180;
		expect(arcHits(0, 0, 0, 1, 2, arc, 0, 1.5, 0.3)).toBe(true);
		expect(arcHits(0, 0, 0, 1, 2, arc, 0, -1.5, 0.3)).toBe(false);
		expect(arcHits(0, 0, 0, 1, 2, arc, 0, 2.5, 0.3)).toBe(false);
	});

	it("arc: the target's radius widens the angle and overlapping the apex always hits", () => {
		const arc = Math.PI / 2; // +-45 deg
		// at 50 deg off-axis, a fat target still overlaps the sector edge
		const a = (50 * Math.PI) / 180;
		expect(
			arcHits(0, 0, 0, 1, 3, arc, Math.sin(a) * 1.5, Math.cos(a) * 1.5, 0.05),
		).toBe(false);
		expect(
			arcHits(0, 0, 0, 1, 3, arc, Math.sin(a) * 1.5, Math.cos(a) * 1.5, 0.4),
		).toBe(true);
		expect(arcHits(0, 0, 0, 1, 3, arc, 0, -0.1, 0.3)).toBe(true);
	});

	it("circle and line", () => {
		expect(circleHits(0, 0, 1, 1.2, 0, 0.3)).toBe(true);
		expect(circleHits(0, 0, 1, 1.4, 0, 0.3)).toBe(false);
		expect(lineHits(0, 0, 1, 0, 3, 0.4, 2.5, 0.6, 0.3)).toBe(true);
		expect(lineHits(0, 0, 1, 0, 3, 0.4, 2.5, 0.8, 0.3)).toBe(false);
		expect(lineHits(0, 0, 1, 0, 3, 0.4, -0.8, 0, 0.3)).toBe(false);
	});
});
