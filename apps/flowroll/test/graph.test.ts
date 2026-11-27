import { describe, expect, it } from "vitest";
import {
	correctCounter,
	MOVES,
	POS_INDEX,
	POSITIONS,
	type PosId,
	type Role,
} from "../src/game/graph.ts";

const ROLES: Role[] = ["top", "bottom"];

describe("position graph", () => {
	it("reaches every position from standing", () => {
		const seen = new Set<PosId>(["standing"]);
		const queue: PosId[] = ["standing"];
		while (queue.length) {
			const id = queue.shift() as PosId;
			const pd = POSITIONS[POS_INDEX[id]];
			if (!pd) throw new Error(id);
			const next: PosId[] = [];
			for (const r of ROLES)
				for (const m of pd.roles[r].moves) {
					next.push(m.to);
					if (m.escapeTo) next.push(m.escapeTo.pos);
				}
			for (const n of next)
				if (!seen.has(n)) {
					seen.add(n);
					queue.push(n);
				}
		}
		expect([...seen].sort()).toEqual(POSITIONS.map((p) => p.id).sort());
	});

	it("gives every move a counter the defender actually has", () => {
		for (let i = 0; i < MOVES.length; i++) {
			const ci = correctCounter(i);
			expect(ci, MOVES[i]?.def.id).toBeGreaterThanOrEqual(0);
		}
		expect(MOVES.length).toBeGreaterThan(20);
	});

	it("has no dead ends: both roles can act in every position, every sub can be escaped", () => {
		for (const pd of POSITIONS) {
			if (pd.kind === "sub") {
				expect(pd.escape, pd.id).toBeDefined();
				continue;
			}
			for (const r of ROLES) {
				expect(pd.roles[r].moves.length, `${pd.id} ${r}`).toBeGreaterThan(0);
				expect(pd.roles[r].counters.length, `${pd.id} ${r}`).toBeGreaterThan(0);
			}
		}
		for (const { def } of MOVES) {
			const target = POSITIONS[POS_INDEX[def.to]];
			if (def.kind === "sub") {
				expect(target?.kind, def.id).toBe("sub");
				expect(def.escapeTo, def.id).toBeDefined();
				expect(
					POSITIONS[POS_INDEX[def.escapeTo?.pos ?? "standing"]]?.kind,
				).not.toBe("sub");
			} else expect(target?.kind, def.id).toBe("position");
		}
	});

	it("maps one key to one move and one key to one counter per role", () => {
		for (const pd of POSITIONS)
			for (const r of ROLES) {
				const md = pd.roles[r].moves.map((m) => m.dir);
				const cd = pd.roles[r].counters.map((c) => c.dir);
				expect(new Set(md).size, `${pd.id} ${r} moves`).toBe(md.length);
				expect(new Set(cd).size, `${pd.id} ${r} counters`).toBe(cd.length);
			}
	});

	it("scores like simplified competition rules", () => {
		const pts: Record<string, number> = {};
		for (const { def } of MOVES)
			pts[def.kind] = Math.max(pts[def.kind] ?? 0, def.points);
		expect(pts.takedown).toBe(2);
		expect(pts.sweep).toBe(2);
		expect(pts.pass).toBe(3);
		const into = (to: PosId) =>
			MOVES.filter(
				(m) =>
					m.def.to === to && m.def.as === "top" && m.def.kind === "advance",
			);
		for (const mv of into("mount")) expect(mv.def.points).toBe(4);
		for (const mv of into("back")) expect(mv.def.points).toBe(4);
		for (const mv of into("kneeOnBelly")) expect(mv.def.points).toBe(2);
		for (const { def } of MOVES)
			if (def.kind === "sub" || def.kind === "escape" || def.kind === "pull")
				expect(def.points, def.id).toBe(0);
	});
});
