import { describe, expect, it } from "vitest";
import { CHALLENGES, GARDENS } from "../src/garden/gardens.ts";
import { simOf, withPieces } from "./helpers.ts";

describe("starter gardens", () => {
	it("ships at least three gardens, all schema-valid", async () => {
		expect(GARDENS.length).toBeGreaterThanOrEqual(3);
		for (const g of GARDENS) {
			const sim = await simOf(g.doc);
			expect(sim.entities.length).toBeGreaterThan(3);
			sim.dispose();
		}
	});

	for (const g of CHALLENGES) {
		it(`${g.key}: unsolved fails, the reference solution reaches the bowl within par`, async () => {
			const bare = await simOf(g.doc);
			expect(bare.goalMode).toBe(true);
			bare.runToEnd();
			expect(bare.status).not.toBe("goal");
			bare.dispose();
			expect(g.solution.length).toBeLessThanOrEqual(g.par ?? 0);
			const sim = await simOf(withPieces(g.doc, g.solution));
			sim.runToEnd();
			expect(sim.status).toBe("goal");
			expect(sim.tick).toBeLessThan(600);
			sim.dispose();
		});
	}
});
