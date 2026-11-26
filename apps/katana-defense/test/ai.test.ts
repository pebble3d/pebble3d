import { describe, expect, it } from "vitest";
import {
	AGGRO_HYSTERESIS,
	chooseTarget,
	shouldAttack,
	strikeConnects,
	TARGET_OBJECTIVE,
	TARGET_PLAYER,
	turnToward,
} from "../src/game/ai/brain.ts";
import { defaultConfig } from "../src/game/config.ts";
import { EV } from "../src/game/events.ts";
import { emptyInput } from "../src/game/input.ts";
import { GameSim, ZS } from "../src/game/sim.ts";

describe("brain", () => {
	it("targets the gate by default and the player inside the aggro radius", () => {
		expect(chooseTarget(TARGET_OBJECTIVE, 10, 5, true, 8, 2)).toBe(
			TARGET_OBJECTIVE,
		);
		expect(chooseTarget(TARGET_OBJECTIVE, 4, 5, true, 8, 2)).toBe(
			TARGET_PLAYER,
		);
	});
	it("keeps the player with hysteresis, and drops a dead player", () => {
		expect(
			chooseTarget(TARGET_PLAYER, 5 * AGGRO_HYSTERESIS - 0.1, 5, true, 8, 2),
		).toBe(TARGET_PLAYER);
		expect(
			chooseTarget(TARGET_PLAYER, 5 * AGGRO_HYSTERESIS + 0.1, 5, true, 8, 2),
		).toBe(TARGET_OBJECTIVE);
		expect(chooseTarget(TARGET_PLAYER, 1, 5, false, 8, 2)).toBe(
			TARGET_OBJECTIVE,
		);
	});
	it("a zombie at the gate stays on it unless the player is right on top of it", () => {
		expect(chooseTarget(TARGET_OBJECTIVE, 4, 5, true, 1, 2)).toBe(
			TARGET_OBJECTIVE,
		);
		expect(chooseTarget(TARGET_OBJECTIVE, 2, 5, true, 1, 2)).toBe(
			TARGET_PLAYER,
		);
	});
	it("attacks only in reach and off cooldown", () => {
		expect(shouldAttack(0.8, 1, 0)).toBe(true);
		expect(shouldAttack(1.2, 1, 0)).toBe(false);
		expect(shouldAttack(0.8, 1, 5)).toBe(false);
	});
	it("a swipe connects in front, not behind; a slam connects all round", () => {
		const arc = (110 * Math.PI) / 180;
		expect(strikeConnects(0, 0, 0.35, 0, arc, 1, 0, 1.2, 0.35)).toBe(true);
		expect(strikeConnects(0, 0, 0.35, 0, arc, 1, 0, -1.2, 0.35)).toBe(false);
		expect(strikeConnects(0, 0, 0.35, 0, Math.PI * 2, 2.6, 0, -2, 0.35)).toBe(
			true,
		);
		expect(strikeConnects(0, 0, 0.35, 0, Math.PI * 2, 2.6, 0, -4, 0.35)).toBe(
			false,
		);
	});
	it("turns the short way round", () => {
		expect(turnToward(3, -3, 10)).toBeCloseTo(-3 + Math.PI * 2, 5);
		expect(turnToward(0, 1, 0.1)).toBeCloseTo(0.1, 5);
	});
});

function placed(sim: GameSim, x: number, z: number, type = 0) {
	const zb = sim.zombies.find((q) => !q.alive);
	if (!zb) throw new Error("full");
	zb.alive = true;
	zb.serial = 100 + sim.alive;
	zb.type = type;
	zb.x = zb.px = x;
	zb.z = zb.pz = z;
	zb.hp = zb.maxHp = 1e6;
	zb.state = ZS.CHASE;
	zb.cooldown = 0;
	sim.alive++;
	return zb;
}

describe("zombie behaviour in the sim", () => {
	const mk = () =>
		new GameSim(
			defaultConfig({ seed: 2, autoStart: true, preWaveFrames: 1e9 }),
		);

	it("walks to the gate and damages it with telegraphed strikes", () => {
		const sim = mk();
		sim.player.x = sim.arena.bounds.max[0] - 1; // far away
		sim.player.z = sim.arena.bounds.max[1] - 1;
		const o = sim.objective;
		const z = placed(sim, o.x - 5, o.z + 4);
		const d0 = Math.hypot(z.x - o.x, z.z - o.z);
		let telegraphs = 0;
		let gateHits = 0;
		for (let t = 0; t < 900; t++) {
			sim.step(emptyInput());
			for (let e = 0; e < sim.events.n; e++) {
				if (sim.events.type[e] === EV.TELEGRAPH) telegraphs++;
				if (sim.events.type[e] === EV.OBJ_HIT) gateHits++;
			}
			sim.events.clear();
		}
		expect(Math.hypot(z.x - o.x, z.z - o.z)).toBeLessThan(d0);
		expect(telegraphs).toBeGreaterThan(0);
		expect(gateHits).toBeGreaterThan(0);
		expect(o.hp).toBeLessThan(o.maxHp);
	});

	it("aggroes onto a nearby player", () => {
		const sim = mk();
		const p = sim.player;
		const z = placed(sim, p.x + 3, p.z);
		sim.step(emptyInput());
		expect(z.target).toBe(TARGET_PLAYER);
	});

	it("separation keeps a crowd from overlapping", () => {
		const sim = mk();
		sim.player.x = sim.arena.bounds.max[0] - 1;
		const zs = Array.from({ length: 12 }, (_, i) =>
			placed(sim, 0 + (i % 3) * 0.05, 14 + Math.floor(i / 3) * 0.05),
		);
		for (let t = 0; t < 30; t++) sim.step(emptyInput());
		let minD = Infinity;
		for (let i = 0; i < zs.length; i++)
			for (let j = i + 1; j < zs.length; j++) {
				const a = zs[i];
				const b = zs[j];
				if (a && b) minD = Math.min(minD, Math.hypot(a.x - b.x, a.z - b.z));
			}
		expect(minD).toBeGreaterThan(0.45);
	});

	it("a staggered zombie cannot strike until it recovers", () => {
		const sim = mk();
		const p = sim.player;
		const z = placed(sim, p.x, p.z + 0.9);
		z.state = ZS.STAGGER;
		z.stateT = 30;
		const hp = p.hp;
		for (let t = 0; t < 25; t++) sim.step(emptyInput());
		expect(p.hp).toBe(hp);
		expect(z.state).toBe(ZS.STAGGER);
	});

	it("waves spawn at the arena's spawn points", () => {
		const sim = new GameSim(
			defaultConfig({ seed: 4, autoStart: true, preWaveFrames: 1 }),
		);
		const seen: [number, number][] = [];
		for (let t = 0; t < 400; t++) {
			sim.step(emptyInput());
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.SPAWN)
					seen.push([sim.events.x[e] as number, sim.events.z[e] as number]);
			sim.events.clear();
		}
		expect(seen.length).toBeGreaterThan(3);
		for (const [x, z] of seen) {
			const near = sim.arena.spawns.some(
				(s) => Math.hypot(s.x - x, s.z - z) < 1.6,
			);
			expect(near).toBe(true);
		}
	});
});
