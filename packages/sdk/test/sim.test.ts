import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSim, SCRATCH_LEN, StateViews } from "../src/sim.ts";
import type { EntityDescJson } from "../src/types.ts";

const bytes = readFileSync(
	new URL("../wasm/det/engine_core_det_bg.wasm", import.meta.url),
);
const fastBytes = readFileSync(
	new URL("../wasm/fast/engine_core_fast_bg.wasm", import.meta.url),
);

const box = (y: number, name = "b"): EntityDescJson => ({
	name,
	position: [0, y, 0],
	rotation: [0, 0, 0, 1],
	body: {
		type: "dynamic",
		friction: 0.5,
		restitution: 0,
		linearDamping: 0,
		angularDamping: 0,
		ccd: false,
		collider: { shape: "box", halfExtents: [0.5, 0.5, 0.5] },
	},
});

describe("sim", () => {
	it("a box dropped from y=5 falls", async () => {
		const h = await loadSim("deterministic", bytes);
		const ids = h.spawnScene([{ sceneId: "b", desc: box(5) }]);
		const id = ids.get("b") as number;
		const v = new StateViews(h);
		h.world.step(60);
		v.refresh();
		expect(v.curr[h.world.slotOf(id) * 8 + 1] as number).toBeLessThan(5);
	});

	it("impulses + velocity readback round-trip through scratch [12..15) and [16..19)", async () => {
		const h = await loadSim("deterministic", bytes, { gravity: 0 });
		const id = h
			.spawnScene([{ sceneId: "b", desc: box(0) }])
			.get("b") as number;
		const v = new StateViews(h);
		expect(v.scratch.length).toBe(SCRATCH_LEN);
		expect(h.world.scratchLen()).toBe(SCRATCH_LEN);
		expect(h.world.applyImpulse(id, 2, 0, 0)).toBe(true);
		expect(h.world.applyTorqueImpulse(id, 0, 0.5, 0)).toBe(true);
		expect(h.world.linearVelocity(id)).toBe(true);
		expect(h.world.angularVelocity(id)).toBe(true);
		v.refresh();
		// unit box, density 1: mass 1, inertia 1/6
		expect(v.scratch[12]).toBeCloseTo(2, 4);
		expect(v.scratch[17]).toBeCloseTo(3, 3);
		expect(h.world.linearVelocity(9999)).toBe(false);
		expect(h.world.angularVelocity(9999)).toBe(false);
	});

	it("setVelocity launches a dynamic body and ignores others", async () => {
		const h = await loadSim("deterministic", bytes, { gravity: 0 });
		const id = h.world.spawn(JSON.stringify(box(0)));
		expect(h.world.setVelocity(id, 3, 0, 0, 0, 2, 0)).toBe(true);
		expect(h.world.setVelocity(424242, 1, 0, 0, 0, 0, 0)).toBe(false);
		h.world.step(60);
		const t = h.world.transformOf(id);
		expect(t?.[0]).toBeCloseTo(3, 1);
	});

	it("views refresh after 200 spawns and match transformOf", async () => {
		const h = await loadSim("deterministic", bytes);
		const v = new StateViews(h);
		const ids: number[] = [];
		for (let i = 0; i < 200; i++) {
			ids.push(h.world.spawn(JSON.stringify(box(5 + i, `b${i}`))));
		}
		h.world.step(1);
		const old = v.curr;
		const grew = h.memory.buffer !== old.buffer;
		expect(v.refresh()).toBe(true);
		expect(v.refresh()).toBe(false);
		if (grew) expect(old.byteLength).toBe(0);
		expect(v.curr.buffer).toBe(h.memory.buffer);
		for (let k = 0; k < 10; k++) {
			const id = ids[(k * 37) % ids.length] as number;
			const t = h.world.transformOf(id);
			expect(v.curr[h.world.slotOf(id) * 8 + 1]).toBe(t?.[1]);
		}
	});

	it("refresh rebuilds views after memory.grow", async () => {
		const h = await loadSim("deterministic", bytes);
		h.spawnScene([{ sceneId: "b", desc: box(5) }]);
		const v = new StateViews(h);
		const old = v.curr;
		const oldBuffer = h.memory.buffer;
		h.memory.grow(1);
		expect(h.memory.buffer).not.toBe(oldBuffer);
		expect(old.byteLength).toBe(0);
		expect(v.refresh()).toBe(true);
		expect(v.curr.buffer).toBe(h.memory.buffer);
		expect(v.curr.byteLength).toBe(v.capacity * 8 * 4);
		expect(v.scratch.buffer).toBe(h.memory.buffer);
		h.world.step(1);
		expect(v.refresh()).toBe(false);
		const id = 1;
		expect(v.curr[h.world.slotOf(id) * 8 + 1]).toBe(
			h.world.transformOf(id)?.[1],
		);
	});

	it("raycast writes toi into scratch", async () => {
		const h = await loadSim("deterministic", bytes);
		const d = box(0);
		if (d.body) d.body.type = "static";
		h.spawnScene([{ sceneId: "b", desc: d }]);
		const v = new StateViews(h);
		h.world.step(1);
		expect(h.world.raycast(0, 0, 10, 0, 0, -1, 100, 0, 0)).toBe(true);
		expect(v.scratch[0]).toBeCloseTo(9.5, 3);
	});

	it("both builds coexist in one process", async () => {
		const a = await loadSim("deterministic", bytes);
		const b = await loadSim("fast", fastBytes);
		expect(a.memory).not.toBe(b.memory);
		expect(a.world.stateHash()).toHaveLength(16);
		expect(b.world.stateHash()).toHaveLength(16);
	});
});
