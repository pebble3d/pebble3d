import { expect, it } from "vitest";
import { buildDemoDoc } from "../src/garden/demo-script.ts";
import { exportText } from "../src/garden/doc.ts";
import { importText } from "../src/garden/validate.ts";
import { simOf } from "./helpers.ts";

it("the ?demo=1 contraption reaches the bowl and exports schema-valid", async () => {
	const doc = buildDemoDoc();
	const sim = await simOf(doc);
	expect(sim.goalMode).toBe(true);
	sim.runToEnd();
	expect(sim.status).toBe("goal");
	expect(sim.tick).toBe(DEMO_GOAL_TICK);
	sim.dispose();
	expect(importText(exportText(doc)).ok).toBe(true);
});

const DEMO_GOAL_TICK = 382;
