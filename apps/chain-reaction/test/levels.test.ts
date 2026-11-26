import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseScene } from "@pebble3d/sdk/schema";
import { beforeAll, describe, expect, it } from "vitest";
import { composeLevel, placementError } from "../src/puzzle/compose.ts";
import {
	type Level,
	levelJsonSchema,
	type Placement,
} from "../src/puzzle/level.ts";
import { LEVELS } from "../src/puzzle/levels.ts";
import { loadNodeEngine } from "../src/puzzle/node-engine.ts";
import { PART_DIRS } from "../src/puzzle/parts.ts";
import { type Engine, PuzzleSim } from "../src/puzzle/sim.ts";

let engine: Engine;
beforeAll(async () => {
	engine = await loadNodeEngine();
});

function run(level: Level, placements: readonly Placement[]) {
	const sim = new PuzzleSim(engine, level, placements);
	const r = sim.run();
	sim.dispose();
	return r;
}

describe("campaign", () => {
	it("ships at least 5 levels with unique ids", () => {
		expect(LEVELS.length).toBeGreaterThanOrEqual(5);
		expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
	});

	it("level.schema.json is up to date (pnpm --filter chain-reaction schema)", () => {
		const onDisk = readFileSync(
			new URL("../level.schema.json", import.meta.url),
			"utf8",
		);
		expect(JSON.parse(onDisk)).toEqual(JSON.parse(levelJsonSchema()));
	});

	for (const level of LEVELS) {
		describe(level.id, () => {
			it("composes into a scene the sdk schema accepts", () => {
				const c = composeLevel(level, level.solution);
				// Round-trip through the zod scene schema again: the composed scene is plain data.
				expect(() =>
					parseScene(JSON.parse(JSON.stringify(c.scene))),
				).not.toThrow();
				expect(c.expanded.sim.length).toBeGreaterThan(5);
			});

			it("reference solution reaches the goal with the stored state hash", () => {
				expect(level.solution.length).toBeLessThanOrEqual(level.par);
				const r = run(level, level.solution);
				expect(r.status).toBe("solved");
				expect(level.expect).toBeDefined();
				expect({ tick: r.tick, hash: r.hash }).toEqual(level.expect);
			});

			it("is deterministic and independent of placement order", () => {
				const a = run(level, level.solution);
				const b = run(level, [...level.solution].reverse());
				expect(b).toEqual(a);
			});

			it("does not solve itself with no parts", () => {
				expect(run(level, []).status).toBe("failed");
			});

			if (level.par >= 2)
				it("has no single-part solution (par is honest)", () => {
					for (const part of Object.keys(
						level.inventory,
					) as Placement["part"][])
						for (const dir of PART_DIRS[part])
							for (let c = 0; c < level.grid.cols; c++)
								for (let r = 0; r < level.grid.rows; r++) {
									const p: Placement = { part, cell: [c, r], dir };
									if (placementError(level, [p])) continue;
									expect(run(level, [p]).status, JSON.stringify(p)).not.toBe(
										"solved",
									);
								}
				});
		});
	}
});

describe("placement rules", () => {
	const level = LEVELS[3] as Level; // knock-on: ramps and dominoes
	it("accepts the reference solution", () => {
		expect(placementError(level, level.solution)).toBeNull();
	});
	it("rejects off-grid, overlapping, over-inventory and unsupported parts", () => {
		expect(
			placementError(level, [{ part: "ramp", cell: [99, 0], dir: "right" }]),
		).toMatch(/off the grid/);
		expect(
			placementError(level, [
				{ part: "ramp", cell: [2, 4], dir: "right" },
				{ part: "ramp", cell: [2, 4], dir: "left" },
			]),
		).toMatch(/overlaps another part|too many/);
		expect(
			placementError(level, [{ part: "spring", cell: [3, 3], dir: "up" }]),
		).toMatch(/too many spring/);
		// A domino needs a floor: no dropping it from the sky.
		expect(
			placementError(level, [{ part: "domino", cell: [7, 4], dir: "up" }]),
		).toMatch(/nothing to stand on/);
		// The ball, goal and marble cells, and the level's blocks, are not buildable.
		expect(
			placementError(level, [
				{ part: "ramp", cell: level.ball.cell, dir: "right" },
			]),
		).toMatch(/overlaps the level/);
		expect(
			placementError(level, [{ part: "ramp", cell: [1, 0], dir: "right" }]),
		).toMatch(/overlaps the level/);
		expect(
			placementError(level, [{ part: "ramp", cell: [3, 3], dir: "up" }]),
		).toMatch(/cannot face/);
	});
	it("composeLevel refuses invalid placements", () => {
		expect(() =>
			composeLevel(level, [{ part: "ramp", cell: [99, 0], dir: "right" }]),
		).toThrow(/off the grid/);
	});
});

describe("verify CLI", () => {
	const cli = fileURLToPath(new URL("../src/cli/verify.ts", import.meta.url));
	const node = (args: string[]) =>
		execFileSync(
			process.execPath,
			["--experimental-strip-types", "--no-warnings", cli, ...args],
			{
				encoding: "utf8",
			},
		);

	it("verifies every level headless and reports the hashes", () => {
		const rows = JSON.parse(node(["--json"])) as {
			id: string;
			ok: boolean;
			hashMatch: boolean;
		}[];
		expect(rows.map((r) => r.id)).toEqual(LEVELS.map((l) => l.id));
		expect(rows.every((r) => r.ok && r.hashMatch)).toBe(true);
	});

	it("checks a candidate solution and fails (exit 1) when it does not solve", () => {
		let code = 0;
		try {
			node([
				"1",
				"--placements",
				'[{"part":"ramp","cell":[5,5],"dir":"left"}]',
			]);
		} catch (e) {
			code = (e as { status: number }).status;
		}
		expect(code).toBe(1);
		const ok = node(["1", "--placements", JSON.stringify(LEVELS[0]?.solution)]);
		expect(ok).toMatch(/PASS {2}01-first-drop/);
	});

	it("--update never passes a reference that is over par", () => {
		const dir = mkdtempSync(join(tmpdir(), "cr-verify-"));
		const file = join(dir, "over-par.json");
		const src = JSON.parse(
			readFileSync(
				new URL("../levels/02-bounce-house.json", import.meta.url),
				"utf8",
			),
		) as Record<string, unknown>;
		writeFileSync(file, JSON.stringify({ ...src, par: 1 }));
		let code = 0;
		try {
			node(["--file", file, "--update"]);
		} catch (e) {
			code = (e as { status: number }).status;
		}
		expect(code).toBe(1);
	});
});
