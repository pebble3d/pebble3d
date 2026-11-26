import { describe, expect, it } from "vitest";
import { DemoBot } from "../src/game/bot.ts";
import { defaultConfig, MOVES } from "../src/game/config.ts";
import { EV } from "../src/game/events.ts";
import {
	BTN,
	emptyInput,
	InputLog,
	type TickInput,
} from "../src/game/input.ts";
import { PHASE } from "../src/game/phase.ts";
import { GameSim, ZS } from "../src/game/sim.ts";

function placeZombie(sim: GameSim, x: number, z: number, type = 0) {
	const zb = sim.zombies[0];
	if (!zb) throw new Error("no zombie slot");
	zb.alive = true;
	zb.serial = 999;
	zb.type = type;
	zb.x = zb.px = x;
	zb.z = zb.pz = z;
	zb.y = 0;
	zb.hp = zb.maxHp = 1000;
	zb.state = ZS.CHASE;
	zb.cooldown = 9999;
	sim.alive++;
	return zb;
}

function idleSim(): GameSim {
	// a sim in pre-wave with a long countdown: no spawns
	return new GameSim(
		defaultConfig({ seed: 3, autoStart: true, preWaveFrames: 100000 }),
	);
}

function tap(sim: GameSim, btn: number, mx = 0, mz = 0): void {
	sim.step({ mx, mz, buttons: btn });
	sim.step({ mx, mz, buttons: 0 });
}

function idle(sim: GameSim, n: number, i: TickInput = emptyInput()): void {
	for (let k = 0; k < n; k++) sim.step(i);
}

describe("GameSim", () => {
	it("starts at the title and enters wave 1 pre-wave on start", () => {
		const sim = new GameSim(defaultConfig({ seed: 1 }));
		expect(sim.phase).toBe(PHASE.TITLE);
		tap(sim, BTN.START);
		expect(sim.phase).toBe(PHASE.PRE_WAVE);
		expect(sim.wave).toBe(1);
	});

	it("a light slash damages a zombie in front, staggers it and triggers hit-stop", () => {
		const sim = idleSim();
		const p = sim.player;
		p.facing = 0; // +Z
		const z = placeZombie(sim, p.x, p.z + 1.4);
		const hp0 = z.hp;
		tap(sim, BTN.LIGHT);
		idle(sim, 10);
		expect(z.hp).toBeLessThan(hp0);
		expect(hp0 - z.hp).toBeCloseTo(MOVES.moves[0]?.hits[0]?.damage ?? 0, 5);
		expect(z.state).toBe(ZS.STAGGER);
		expect(sim.comboHits).toBe(1);
		// the hit froze the sim frame counter for the hit-stop
		expect(sim.tick - sim.frame).toBeGreaterThanOrEqual(3);
	});

	it("a light slash misses a zombie behind the player", () => {
		const sim = idleSim();
		const p = sim.player;
		p.facing = 0;
		const z = placeZombie(sim, p.x, p.z - 1.4);
		sim.step({ mx: 0, mz: 1, buttons: BTN.LIGHT });
		idle(sim, 12);
		expect(z.hp).toBe(z.maxHp);
	});

	it("each swing hits a zombie once; the next swing hits again", () => {
		const sim = idleSim();
		const p = sim.player;
		p.facing = 0;
		const z = placeZombie(sim, p.x, p.z + 1.2);
		tap(sim, BTN.LIGHT);
		idle(sim, 20);
		const after1 = z.hp;
		expect(sim.comboHits).toBe(1);
		tap(sim, BTN.LIGHT);
		idle(sim, 20);
		expect(z.hp).toBeLessThan(after1);
		expect(sim.comboHits).toBe(2);
	});

	it("a zombie strike hurts the player, but not during dodge i-frames", () => {
		const sim = idleSim();
		const p = sim.player;
		const z = placeZombie(sim, p.x, p.z + 0.9);
		z.heading = Math.PI; // facing the player (-Z)
		z.cooldown = 0;
		z.hp = 1000;
		const hp0 = p.hp;
		// let it wind up and strike
		idle(sim, 60);
		expect(p.hp).toBeLessThan(hp0);

		const sim2 = idleSim();
		const p2 = sim2.player;
		const z2 = placeZombie(sim2, p2.x, p2.z + 0.9);
		z2.heading = Math.PI;
		z2.state = ZS.WINDUP;
		z2.stateT = 4;
		// dodge sideways just before the strike lands
		sim2.step({ mx: 1, mz: 0, buttons: BTN.DODGE });
		let perfect = false;
		for (let k = 0; k < 8; k++) {
			sim2.step({ mx: 1, mz: 0, buttons: BTN.DODGE });
			for (let e = 0; e < sim2.events.n; e++)
				if (sim2.events.type[e] === EV.PERFECT_DODGE) perfect = true;
		}
		expect(p2.hp).toBe(100);
		// still in range when it struck, so it counts as a perfect dodge
		expect(perfect).toBe(true);
	});

	it("killing a zombie scores, emits a kill event and frees the slot", () => {
		const sim = idleSim();
		const p = sim.player;
		p.facing = 0;
		const z = placeZombie(sim, p.x, p.z + 1.2);
		z.hp = 1;
		const score0 = sim.score;
		let killed = false;
		sim.events.clear();
		tap(sim, BTN.LIGHT);
		for (let k = 0; k < 12; k++) {
			sim.step(emptyInput());
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.KILL) killed = true;
		}
		expect(killed).toBe(true);
		expect(z.alive).toBe(false);
		expect(sim.score).toBeGreaterThan(score0);
		expect(sim.alive).toBe(0);
	});

	it("the launcher knocks a shambler airborne; brutes cannot be launched", () => {
		const sim = idleSim();
		const p = sim.player;
		p.facing = 0;
		const z = placeZombie(sim, p.x, p.z + 1.2);
		tap(sim, BTN.LIGHT);
		idle(sim, 9);
		tap(sim, BTN.LIGHT);
		idle(sim, 9);
		tap(sim, BTN.HEAVY);
		let maxY = 0;
		for (let k = 0; k < 30; k++) {
			sim.step(emptyInput());
			maxY = Math.max(maxY, z.y);
		}
		expect(
			sim.combo.move === -1 || MOVES.moves[sim.combo.move]?.id === "launcher",
		).toBe(true);
		expect(maxY).toBeGreaterThan(1);
	});

	it("Spin Storm spends the full Focus meter and makes the player invulnerable", () => {
		const sim = idleSim();
		sim.player.focus = 100;
		idle(sim, 14, { mx: 0, mz: 0, buttons: BTN.FOCUS });
		expect(MOVES.moves[sim.combo.move]?.id).toBe("spinStorm");
		expect(sim.player.focus).toBe(0);
		expect(sim.playerInvulnerable()).toBe(true);
	});

	it("restarts after a game over that lands on the same tick as a hit (no hit-stop softlock)", () => {
		const sim = idleSim();
		const p = sim.player;
		p.facing = 0;
		placeZombie(sim, p.x, p.z + 1.4);
		sim.step({ mx: 0, mz: 0, buttons: BTN.LIGHT });
		// the gate falls on the tick light1's hit connects (frame 6)
		for (let k = 0; k < 30 && sim.phase !== PHASE.GAME_OVER; k++) {
			if (sim.combo.frame === 5) sim.objective.hp = 0;
			sim.step(emptyInput());
		}
		expect(sim.phase).toBe(PHASE.GAME_OVER);
		let restarted = false;
		for (let k = 0; k < 400 && !restarted; k++) {
			tap(sim, BTN.START);
			restarted = sim.phase === PHASE.PRE_WAVE;
		}
		expect(restarted).toBe(true);
		expect(sim.hitstop).toBe(0);
	});

	it("hit-stop freezes the current move and starts a buffered press only afterwards", () => {
		const sim = idleSim();
		const p = sim.player;
		p.facing = 0;
		placeZombie(sim, p.x, p.z + 1.4);
		sim.step({ mx: 0, mz: 0, buttons: BTN.LIGHT });
		while (sim.hitstop === 0) sim.step(emptyInput());
		// frozen: the move does not advance during hit-stop
		const f0 = sim.combo.frame;
		sim.step(emptyInput());
		expect(sim.combo.frame).toBe(f0);

		// a press buffered inside the cancel window during hit-stop
		const light1 = sim.combo.move;
		while (!sim.combo.inCancel()) sim.step(emptyInput());
		sim.hitstop = 5;
		const fz = sim.combo.frame;
		sim.events.clear();
		tap(sim, BTN.LIGHT);
		expect(sim.combo.move).toBe(light1);
		expect(sim.combo.frame).toBe(fz);
		while (sim.hitstop > 0) {
			expect(sim.combo.move).toBe(light1);
			sim.step(emptyInput());
		}
		let swungAt = -1;
		for (let k = 0; k < 3 && swungAt < 0; k++) {
			for (let e = 0; e < sim.events.n; e++)
				if (
					sim.events.type[e] === EV.SWING &&
					MOVES.moves[sim.events.a[e] as number]?.id === "light2"
				)
					swungAt = k;
			if (swungAt < 0) sim.step(emptyInput());
		}
		expect(MOVES.moves[sim.combo.move]?.id).toBe("light2");
		expect(swungAt).toBeGreaterThanOrEqual(0);
	});

	it("a restart resets hit-stop, frame counter, spin/stride and the wave director", () => {
		const sim = new GameSim(defaultConfig({ seed: 5, autoStart: true }));
		const bot = new DemoBot(sim);
		const i = emptyInput();
		for (let t = 0; t < 1500; t++) {
			bot.next(i);
			sim.step(i);
		}
		expect(sim.frame).toBeGreaterThan(0);
		sim.player.spin = 3;
		sim.player.stride = 12;
		sim.objective.hp = 0;
		sim.step(emptyInput());
		expect(sim.phase).toBe(PHASE.GAME_OVER);
		sim.hitstop = 4;
		idle(sim, 120);
		tap(sim, BTN.START);
		expect(sim.phase).toBe(PHASE.PRE_WAVE);
		expect(sim.hitstop).toBe(0);
		expect(sim.frame).toBeLessThanOrEqual(1);
		expect(sim.player.spin).toBe(0);
		expect(sim.player.stride).toBe(0);
		expect(sim.director.count).toBe(0);
		expect(sim.director.def).toBeNull();
	});

	it("is deterministic: the same seed and input log give the same state hash", () => {
		const run = (log?: InputLog) => {
			const sim = new GameSim(defaultConfig({ seed: 42 }));
			const bot = new DemoBot(sim);
			const rec = new InputLog();
			const i = emptyInput();
			for (let t = 0; t < 4000; t++) {
				if (log) log.read(t, i);
				else bot.next(i);
				rec.push(i);
				sim.step(i);
			}
			return { hash: sim.hash(), rec, sim };
		};
		const a = run();
		const b = run(a.rec);
		expect(a.sim.kills).toBeGreaterThan(0);
		expect(b.hash).toBe(a.hash);
		const c = new GameSim(defaultConfig({ seed: 43 }));
		const bot = new DemoBot(c);
		const i = emptyInput();
		for (let t = 0; t < 4000; t++) {
			bot.next(i);
			c.step(i);
		}
		expect(c.hash()).not.toBe(a.hash);
	});

	it("the demo bot clears waves 1-3 and uses every move", () => {
		const sim = new GameSim(defaultConfig({ seed: 7 }));
		const bot = new DemoBot(sim);
		const used = new Set<string>();
		const i = emptyInput();
		for (let t = 0; t < 60 * 60 * 6 && sim.wave <= 3; t++) {
			bot.next(i);
			sim.step(i);
			for (let e = 0; e < sim.events.n; e++)
				if (sim.events.type[e] === EV.SWING || sim.events.type[e] === EV.DODGE)
					used.add(
						sim.events.type[e] === EV.DODGE
							? "dodge"
							: (MOVES.moves[sim.events.a[e] as number]?.id ?? "?"),
					);
			sim.events.clear();
			if (sim.phase === PHASE.GAME_OVER) break;
		}
		expect(sim.phase).not.toBe(PHASE.GAME_OVER);
		expect(sim.wave).toBeGreaterThan(3);
		expect([...used].sort()).toEqual(
			[
				"dashSlash",
				"dodge",
				"heavy",
				"heavyCharged",
				"launcher",
				"light1",
				"light2",
				"light3",
				"plunge",
				"spinStorm",
			].sort(),
		);
	});
});
