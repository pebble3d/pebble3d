import { parseScene } from "@pebble3d/sdk/schema";
import { describe, expect, it } from "vitest";
import {
	COLS,
	cellCenter,
	cellOf,
	generateKeep,
	ROWS,
} from "../src/gen/generate.ts";
import { type Grid, rasterize } from "../src/gen/grid.ts";

/**
 * The live seed range: `main.ts` picks `Date.now() % 9973 + 1` when no seed is given, and N
 * steps up from there. Every one of these must be a schema-valid, solvable keep.
 */
const LIVE = 10_000;

/** A reachable tile within r metres of (x, z)? Scans only the window around it. */
function near(
	grid: Grid,
	reach: Uint8Array,
	x: number,
	z: number,
	r: number,
): boolean {
	const i0 = Math.max(0, Math.floor((x - r - grid.x0) / 0.5));
	const i1 = Math.min(grid.w - 1, Math.floor((x + r - grid.x0) / 0.5));
	const j0 = Math.max(0, Math.floor((z - r - grid.z0) / 0.5));
	const j1 = Math.min(grid.h - 1, Math.floor((z + r - grid.z0) / 0.5));
	for (let j = j0; j <= j1; j++)
		for (let i = i0; i <= i1; i++) {
			const t = j * grid.w + i;
			if (reach[t] === 1 && Math.hypot(grid.cx(t) - x, grid.cz(t) - z) <= r)
				return true;
		}
	return false;
}

/** Every reason seed `seed` is not a valid, solvable keep (empty = fine). */
function problems(seed: number): string[] {
	const out: string[] = [];
	const { scene, layout } = generateKeep(seed);
	// Round-trip through JSON text, exactly what ?dumpScene=1 exports.
	const parsed = parseScene(JSON.parse(JSON.stringify(scene)));
	// Solvability from the exported JSON alone: rasterise its static colliders (with the
	// player's clearance) and flood-fill from the spawn.
	const grid = rasterize(parsed);
	const reach = new Uint8Array(grid.size);
	const s = grid.nearestWalkable(layout.spawn[0], layout.spawn[1], 2);
	if (s < 0) return [`${seed}: spawn blocked`];
	grid.flood(s, reach);
	if (!near(grid, reach, layout.relic[0], layout.relic[1], 1.2))
		out.push(`${seed}: relic`);
	if (!near(grid, reach, layout.gate[0], layout.exitZ + 1.5, 1))
		out.push(`${seed}: exit`);
	for (let c = 0; c < COLS * ROWS; c++) {
		const [cx, cz] = cellCenter(c);
		if (!near(grid, reach, cx, cz, 4)) out.push(`${seed}: cell ${c}`);
	}
	for (const [x, z] of layout.loot)
		if (!near(grid, reach, x, z, 0.8)) out.push(`${seed}: loot`);
	if (layout.guards.length < 3)
		out.push(`${seed}: ${layout.guards.length} guards`);
	const entrance = cellOf(layout.spawn[0], layout.spawn[1]);
	for (const g of layout.guards)
		for (let k = 0; k < g.route.length; k += 3) {
			const x = g.route[k] as number;
			const z = g.route[k + 1] as number;
			if (reach[grid.index(x, z)] !== 1)
				out.push(`${seed}: ${g.id} node off the floor`);
			if (cellOf(x, z) === entrance)
				out.push(`${seed}: ${g.id} crosses the gatehouse`);
		}
	if (parsed.entities.find((e) => e.character)?.id !== "player")
		out.push(`${seed}: player not first`);
	return out;
}

describe("keep generator", () => {
	it("is deterministic per seed and varies across seeds", () => {
		const a = JSON.stringify(generateKeep(42));
		const b = JSON.stringify(generateKeep(42));
		const c = JSON.stringify(generateKeep(43));
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	it(`every live seed (1..${LIVE}) gives a schema-valid, solvable keep`, () => {
		const bad: string[] = [];
		let retried = 0;
		for (let seed = 1; seed <= LIVE; seed++) {
			bad.push(...problems(seed));
			if (seed <= 1000 && generateKeep(seed).layout.attempt > 0) retried++;
		}
		expect(bad).toEqual([]);
		// The fallback (fresh draws) is rare.
		expect(retried).toBeLessThan(100);
	}, 600_000);
});
