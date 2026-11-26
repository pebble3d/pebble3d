// Zombie locomotion cost: N engine KCC characters (Rapier character controller, per-zombie
// setCharacterInput) vs the game's JS kinematic path (GameSim with N chasing zombies).
// Run: node --experimental-strip-types bench/kcc-bench.ts [N=40]
import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { defaultConfig } from "../src/game/config.ts";
import { emptyInput } from "../src/game/input.ts";
import { GameSim, ZS } from "../src/game/sim.ts";

const N = Number(process.argv[2] ?? 40);
const TICKS = 1200;

function stats(ms: number[]): { mean: number; p95: number; max: number } {
	const s = [...ms].sort((a, b) => a - b);
	return {
		mean: ms.reduce((a, b) => a + b, 0) / ms.length,
		p95: s[Math.floor(s.length * 0.95)] ?? 0,
		max: s[s.length - 1] ?? 0,
	};
}

async function kcc(build: "deterministic" | "fast"): Promise<void> {
	const dir =
		build === "deterministic" ? "det/engine_core_det" : "fast/engine_core_fast";
	const bytes = readFileSync(
		new URL(`../../../packages/sdk/wasm/${dir}_bg.wasm`, import.meta.url),
	);
	const h = await loadSim(build, bytes, { seed: 1 });
	const w = h.world;
	w.spawn(
		JSON.stringify({
			position: [0, 0, 0],
			body: { type: "static", collider: { shape: "plane" } },
		}),
	);
	// arena walls
	for (const [x, z, hx, hz] of [
		[0, -10, 14, 0.25],
		[0, 10, 14, 0.25],
		[-14, 0, 0.25, 10],
		[14, 0, 0.25, 10],
	] as const)
		w.spawn(
			JSON.stringify({
				position: [x, 2, z],
				body: {
					type: "static",
					collider: { shape: "box", halfExtents: [hx, 2, hz] },
				},
			}),
		);
	const ids: number[] = [];
	for (let i = 0; i < N; i++) {
		const a = (i / N) * Math.PI * 2;
		ids.push(
			w.spawn(
				JSON.stringify({
					position: [Math.cos(a) * 9, 0.9, Math.sin(a) * 7],
					character: { speed: 1.2, sprintSpeed: 3.6 },
					body: {
						type: "kinematic",
						collider: { shape: "capsule", halfHeight: 0.5, radius: 0.35 },
					},
				}),
			),
		);
	}
	const ms: number[] = [];
	const t = new Float32Array(16);
	for (let k = 0; k < TICKS; k++) {
		// steer every character toward the centre (they crowd and collide, like a horde)
		for (let i = 0; i < N; i++) {
			const tr = w.transformOf(ids[i] as number);
			if (!tr) continue;
			t[0] = -(tr[0] as number);
			t[1] = -(tr[2] as number);
			const l = Math.hypot(t[0], t[1]) || 1;
			w.setCharacterInput(
				ids[i] as number,
				t[0] / l,
				t[1] / l,
				false,
				i % 3 === 0,
			);
		}
		const t0 = performance.now();
		w.step(1);
		ms.push(performance.now() - t0);
	}
	const s = stats(ms.slice(120));
	console.log(
		`kcc ${build.padEnd(13)} N=${N}: step mean ${s.mean.toFixed(3)} ms, p95 ${s.p95.toFixed(3)} ms, max ${s.max.toFixed(3)} ms (${(16.67 / s.mean).toFixed(0)}x a 60 Hz frame budget)`,
	);
	w.free();
}

function jsPath(): void {
	const sim = new GameSim(
		defaultConfig({ seed: 5, autoStart: true, preWaveFrames: 1e9 }),
	);
	const a = sim.arena;
	for (let i = 0; i < N; i++) {
		const z = sim.zombies[i];
		if (!z) break;
		z.alive = true;
		z.serial = i + 1;
		z.type = i % 7 === 0 ? 1 : 0;
		z.x = z.px =
			a.bounds.min[0] +
			1 +
			((i * 3.7) % (a.bounds.max[0] - a.bounds.min[0] - 2));
		z.z = z.pz =
			a.bounds.min[1] +
			1 +
			((i * 1.9) % (a.bounds.max[1] - a.bounds.min[1] - 2));
		z.hp = z.maxHp = 1e9;
		z.state = ZS.CHASE;
		z.cooldown = 0;
		sim.alive++;
	}
	sim.objective.hp = sim.objective.maxHp = 1e12;
	sim.player.hp = 1e12;
	const ms: number[] = [];
	const inp = emptyInput();
	for (let k = 0; k < TICKS; k++) {
		const t0 = performance.now();
		sim.step(inp);
		ms.push(performance.now() - t0);
	}
	const s = stats(ms.slice(120));
	console.log(
		`js kinematic  N=${sim.alive}: tick mean ${s.mean.toFixed(3)} ms, p95 ${s.p95.toFixed(3)} ms, max ${s.max.toFixed(3)} ms (whole game tick: AI, separation, combat)`,
	);
}

await kcc("deterministic");
await kcc("fast");
jsPath();
