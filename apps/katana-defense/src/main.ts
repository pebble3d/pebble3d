import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/arena.json";
import { DemoBot } from "./game/bot.ts";
import { ARENA, defaultConfig } from "./game/config.ts";
import { DT } from "./game/constants.ts";
import { emptyInput, InputLog } from "./game/input.ts";
import { MoveLab } from "./game/lab.ts";
import { LiveInput } from "./game/live-input.ts";
import { PHASE_NAMES } from "./game/phase.ts";
import { Presentation } from "./game/present.ts";
import { GameSim } from "./game/sim.ts";
import { PLAYER_MODEL } from "./game/view/player-view.ts";
import { ZOMBIES } from "./game/view/zombie-view.ts";

/**
 * Ronin Outpost URL params:
 *   demo=1               autoplayer bot (plays waves 1..demoWaves, default 3, then stands down)
 *   demoWaves=<n>        waves the bot fights (0 = all)
 *   seed=<n>             run seed (default: random in realtime, 7 in fixed mode)
 *   wave=<n>             start at wave n
 *   pre=<frames>         pre-wave countdown override
 *   mode=realtime|fixed  fixed = one tick per frame (captures); ticks=<n> stops there
 *   backend=webgpu|webgl, cam=<preset> (a scene preset; default the game camera)
 *   hud=0                hide the HUD; mute=1 no audio
 */
interface Params {
	demo: boolean;
	/** Move showcase: every move performed in place (no enemies). */
	lab: boolean;
	demoWaves: number;
	seed: number;
	wave: number;
	pre: number | undefined;
	mode: "realtime" | "fixed";
	stopAtTick: number | undefined;
	backend: "webgpu" | "webgl" | undefined;
	cam: string | undefined;
	hud: boolean;
	mute: boolean;
	/** Camera overrides (captures): yaw/pitch radians, arm distance metres. */
	camYaw: number | undefined;
	camPitch: number | undefined;
	camDist: number | undefined;
	/** Perf runs: the gate and the player cannot fall. */
	stress: boolean;
}

function readParams(search: string): Params {
	const q = new URLSearchParams(search);
	const num = (k: string): number | undefined => {
		const v = q.get(k);
		if (v === null) return undefined;
		const n = Number(v);
		if (!Number.isFinite(n)) throw new Error(`bad ${k} param "${v}"`);
		return n;
	};
	const mode = q.get("mode") ?? "realtime";
	if (mode !== "realtime" && mode !== "fixed")
		throw new Error(`bad mode param "${mode}"`);
	const backend = q.get("backend");
	if (backend !== null && backend !== "webgpu" && backend !== "webgl")
		throw new Error(`bad backend param "${backend}"`);
	return {
		demo: q.get("demo") === "1",
		lab: q.get("lab") === "1",
		demoWaves: num("demoWaves") ?? 3,
		seed: num("seed") ?? (mode === "fixed" ? 7 : (Date.now() % 100000) + 1),
		wave: num("wave") ?? 1,
		pre: num("pre"),
		mode,
		stopAtTick: num("ticks"),
		backend: backend ?? undefined,
		cam: q.get("cam") ?? undefined,
		hud: q.get("hud") !== "0",
		mute: q.get("mute") === "1",
		camYaw: num("camYaw"),
		camPitch: num("camPitch"),
		camDist: num("camDist"),
		stress: q.get("stress") === "1",
	};
}

/** The arena scene with the gameplay arena's walls and obstacles injected as physics. */
function buildScene(): SceneInput {
	const scene = structuredClone(sceneJson) as Record<string, unknown> & {
		entities: unknown[];
	};
	const b = ARENA.bounds;
	scene.bounds = { min: b.min, max: b.max, height: 4 };
	ARENA.obstacles.forEach((o, i) => {
		scene.entities.push({
			id: `obstacle-${i}`,
			transform: { position: [o.x, o.h / 2, o.z] },
			body: {
				type: "static",
				collider: { shape: "box", halfExtents: [o.hx, o.h / 2, o.hz] },
			},
		});
	});
	return scene as unknown as SceneInput;
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	const game: Game = await createGame({
		canvas,
		scene: buildScene(),
		mode: p.mode,
		backend: p.backend ?? "webgpu",
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(p.stopAtTick !== undefined ? { stopAtTick: p.stopAtTick } : {}),
	});
	const [gltf, ...zombieGltfs] = await Promise.all([
		game.renderer.loadGltf(PLAYER_MODEL.url),
		...ZOMBIES.avatars.map((a) => game.renderer.loadGltf(a.url)),
	]);
	if (!gltf) throw new Error("player model failed to load");
	// Toon style (arena.json post.style): cel-lit copies of the avatars' materials, made once
	// on the cached glTFs before any view clones them.
	for (const g of [gltf, ...zombieGltfs]) if (g) game.renderer.stylize(g.scene);

	const sim = new GameSim(
		defaultConfig({
			seed: p.seed,
			startWave: p.wave,
			...(p.pre !== undefined || p.lab
				? { preWaveFrames: p.lab ? 1e9 : (p.pre as number) }
				: {}),
		}),
	);
	if (p.stress) {
		sim.objective.hp = sim.objective.maxHp = 1e9;
		sim.mods.maxHp = 1e9;
		sim.player.hp = 1e9;
	}
	const lab = p.lab ? new MoveLab(sim) : null;
	const live = p.demo || lab ? null : new LiveInput(canvas);
	const bot = p.demo && !lab ? new DemoBot(sim, p.demoWaves) : null;
	const pres = new Presentation(game, sim, gltf, {
		hud: p.hud ? hudRoot : null,
		mute: p.mute || p.mode === "fixed",
		zombieGltfs,
		auto: p.demo || p.lab,
		canvas,
		onButtons: (bits) => {
			if (live) live.inject |= bits;
		},
	});
	if (p.cam !== undefined) pres.setCameraPreset(p.cam);
	if (new URLSearchParams(location.search).get("rigdbg") === "1") {
		const { Mesh, SphereGeometry, MeshBasicNodeMaterial } = await import(
			"three/webgpu"
		);
		pres.player.markers = [0xff2020, 0x20ff20, 0xff9090, 0x90ff90].map((c) => {
			const m = new Mesh(
				new SphereGeometry(0.025, 10, 8),
				new MeshBasicNodeMaterial({ color: c, depthTest: false }),
			);
			m.renderOrder = 10;
			game.renderer.three.scene.add(m);
			return m;
		});
	}
	const hold = new URLSearchParams(location.search).get("pose");
	if (hold) {
		// ?pose=<move>:<frame> freezes the sword pose (pose tuning)
		const [id, fr] = hold.split(":");
		const i = sim.moves.byId.get(id ?? "");
		if (i === undefined) throw new Error(`bad pose param "${hold}"`);
		pres.player.hold = {
			def: sim.moves.moves[i] as (typeof sim.moves.moves)[number],
			frame: Number(fr ?? 0),
		};
	}
	pres.overrideCamera(p.camYaw, p.camPitch, p.camDist);
	// perf experiments: ?dbg=nozombies,noshadow
	const dbg = new URLSearchParams(location.search).get("dbg") ?? "";
	if (dbg) pres.debug(dbg.split(","));

	const log = new InputLog();
	const input = emptyInput();
	let acc = 0;
	/** Smoothed CPU cost per frame (ms): game ticks and presentation. */
	const cpu = { sim: 0, present: 0 };
	game.onFrame((dt) => {
		const t0 = performance.now();
		acc += dt;
		let n = 0;
		while (acc >= DT - 1e-9 && n < 5) {
			acc -= DT;
			n++;
			if (lab) lab.next(input);
			else if (bot) bot.next(input);
			else if (live) {
				live.sample(input, pres.cameraYaw, DT);
				pres.look(live.lookYaw, live.lookPitch);
			}
			log.push(input);
			sim.step(input);
			pres.drain();
		}
		if (n === 5) acc = 0;
		const t1 = performance.now();
		pres.update(dt, Math.min(1, acc / DT));
		const t2 = performance.now();
		cpu.sim += (t1 - t0 - cpu.sim) * 0.05;
		cpu.present += (t2 - t1 - cpu.present) * 0.05;
	});

	Object.assign(window.__pebble3d ?? {}, {
		game: {
			phase: () => PHASE_NAMES[sim.phase],
			wave: () => sim.wave,
			score: () => sim.score,
			kills: () => sim.kills,
			alive: () => sim.alive,
			hash: () => sim.hash(),
			inputs: () => log.length,
			bot: () => bot?.current ?? lab?.current ?? null,
			cpu: () => ({ simMs: cpu.sim, presentMs: cpu.present }),
			rig: () => ({ ...pres.player.diag }),
			zombies: () => pres.zombieDiag(),
			/** Live brutes in their slam wind-up (capture scouting). */
			bruteWindups: () =>
				sim.zombies.filter(
					(z) => z.alive && z.state === 2 && sim.archetypes[z.type]?.slam,
				).length,
			move: () => sim.combo.def?.id ?? null,
		},
	});
	game.start();
}

main().catch((e: unknown) => {
	const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
	window.__pebble3d = {
		...window.__pebble3d,
		ready: false,
		done: false,
		error: msg,
	};
	console.error(msg);
	const el = document.createElement("pre");
	el.id = "fatal-error";
	el.textContent = msg;
	el.style.cssText =
		"position:fixed;inset:auto 16px 16px 16px;margin:0;padding:12px 16px;background:#2a0d0d;color:#ffd7d7;border:1px solid #ff6b6b;font:14px ui-monospace,monospace;white-space:pre-wrap;z-index:10";
	document.body.append(el);
});
