import { describe, expect, it } from "vitest";
import { DemoBot } from "../src/game/bot.ts";
import { GUARD, PHASE, TUNE } from "../src/game/sim.ts";
import { demoRun, headless } from "./helpers.ts";

describe("lanternfall sim (real deterministic wasm, browser tick order)", () => {
	it("the demo bot steals the relic and escapes keep 64 (the fixed-mode default)", async () => {
		const r = await demoRun(64);
		expect(r.sim.phase).toBe(PHASE.ESCAPED);
		expect(r.sim.hasRelic).toBe(true);
		expect(r.sim.score).toBeGreaterThan(1000);
		// Pinned for bench/capture-final.sh: the results card is shot just after this tick.
		expect(r.end).toBe(1784);
		r.free();
	});

	it("replays bit-exactly: same seed and inputs give the same hash", async () => {
		const run = async (nudge: boolean): Promise<string> => {
			const r = await demoRun(13, 900);
			if (nudge) {
				r.step((i) => {
					i.mx = 127;
					i.mz = 0;
				});
			} else
				r.step((i) => {
					i.mx = 0;
					i.mz = 0;
				});
			for (let t = 0; t < 30; t++) r.step();
			const h = r.sim.hash();
			r.free();
			return h;
		};
		const a = await run(false);
		const b = await run(false);
		const c = await run(true);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});

	it("a guard spots a thief standing in its view, and catches one that walks into it", async () => {
		const h = await headless(7);
		h.sim.begin();
		h.step();
		const g = h.sim.guards[0];
		if (!g) throw new Error("no guard");
		// Stand 2 m in front of the guard, in its facing direction.
		const x = g.x + Math.sin(g.yaw) * 2;
		const z = g.z + Math.cos(g.yaw) * 2;
		h.handle.world.teleport(h.sim.playerId, x, 0.8, z);
		let spotted = false;
		for (let t = 0; t < 600 && h.sim.phase === PHASE.PLAY; t++) {
			h.step((i) => {
				i.mx = 0;
				i.mz = 0;
				i.buttons = 0;
			});
			if (g.state !== GUARD.PATROL) spotted = true;
		}
		expect(spotted).toBe(true);
		expect(h.sim.phase).toBe(PHASE.CAUGHT);
		h.free();
	});

	it("walls block sight; light pools extend it", async () => {
		const h = await headless(7);
		h.step();
		const s = h.sim;
		// Find a wall from the scene: sight across it is blocked, along it is clear.
		const wall = h.keep.scene.entities?.find(
			(e) => e.id.startsWith("wall-") && (e.transform?.scale?.[2] ?? 0) > 3,
		);
		if (!wall?.transform?.position) throw new Error("no wall");
		const [wx, , wz] = wall.transform.position;
		expect(s.clearSight(wx - 2, wz, wx + 2, TUNE.chestY, wz)).toBe(false);
		expect(s.clearSight(wx - 2, wz + 0.2, wx - 2, TUNE.chestY, wz - 0.8)).toBe(
			true,
		);
		// The baked light: brighter next to a sconce than in the darkest reachable tile.
		const lantern = s.layout.lanterns.find((l) => l.kind === "sconce");
		if (!lantern) throw new Error("no sconce");
		let min = 1;
		for (let i = 0; i < s.grid.size; i++)
			if (s.reach[i]) min = Math.min(min, s.light[i] as number);
		expect(s.lightAt(lantern.x, lantern.z)).toBeGreaterThan(0.5);
		expect(min).toBeCloseTo(TUNE.moonlight, 5);
		h.free();
	});

	it("at 120 Hz (a 0-tick frame before every tick) the rig's keyboard input never wins", async () => {
		// Emulates createGame's frame order: step(n), the player rig writes its keyboard input
		// (here: "D held" = +x), then the game's onFrame runs the ticks and re-asserts.
		const h = await headless(7);
		const bot = new DemoBot(h.sim, 60);
		const world = h.handle.world;
		const [sx, sz] = h.keep.layout.spawn;
		let titleDrift = 0;
		for (let frame = 0; frame < 2400; frame++) {
			const ticks = frame % 2;
			if (ticks) world.step(1);
			h.views.refresh();
			world.setCharacterInput(h.sim.playerId, 1, 0, false, false); // the rig's keys
			while (h.sim.tick < world.tick()) {
				bot.next(h.input);
				h.sim.step(h.input);
			}
			h.sim.assertInput();
			if (h.sim.phase === PHASE.TITLE)
				titleDrift = Math.max(
					titleDrift,
					Math.hypot(h.sim.px - sx, h.sim.pz - sz),
				);
		}
		expect(titleDrift).toBeLessThan(0.01);
		expect(h.sim.phase).not.toBe(PHASE.TITLE);
		expect(Math.hypot(h.sim.px - sx, h.sim.pz - sz)).toBeGreaterThan(3);
		h.free();
	});

	it("retry after a run puts everyone back and starts over", async () => {
		const r = await demoRun(42);
		expect(r.sim.phase).toBe(PHASE.CAUGHT);
		for (let t = 0; t < 60; t++) r.step((i) => (i.buttons = 0));
		r.step((i) => (i.buttons = 1));
		expect(r.sim.phase).toBe(PHASE.PLAY);
		expect(r.sim.lootCount).toBe(0);
		expect(r.sim.hasRelic).toBe(false);
		r.step();
		expect(
			Math.hypot(
				r.sim.px - r.keep.layout.spawn[0],
				r.sim.pz - r.keep.layout.spawn[1],
			),
		).toBeLessThan(0.3);
		for (const g of r.sim.guards) expect(g.state).toBe(GUARD.PATROL);
		r.free();
	});
});
