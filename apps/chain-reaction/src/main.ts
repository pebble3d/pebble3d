import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import { Color, DirectionalLight } from "three/webgpu";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import baseScene from "../levels/base.json";
import { App } from "./app.ts";
import { Sfx } from "./audio/sfx.ts";
import { DemoDriver } from "./demo.ts";
import { LEVELS } from "./puzzle/levels.ts";
import { DT, engineFrom, PuzzleSim } from "./puzzle/sim.ts";
import { Hud } from "./ui/hud.ts";

/**
 * Chain Reaction URL params:
 *   demo=1               autoplayer: places each level's reference solution and runs it
 *   level=<n>            start at level n (1-based) in play (or the demo's first level)
 *   solution=1           with level: pre-place the reference solution (edit view)
 *   run=1                with level and solution: press Run immediately
 *   agree=1              run every level's reference solution in this browser at startup
 *                        and expose the results (bench/agree.mjs compares them to Node)
 *   mode=realtime|fixed  fixed = one tick per frame (captures); ticks=<n> stops there
 *   backend=webgpu|webgl, hud=0, mute=1
 */
interface Params {
	demo: boolean;
	level: number | undefined;
	solution: boolean;
	run: boolean;
	agree: boolean;
	mode: "realtime" | "fixed";
	stopAtTick: number | undefined;
	backend: "webgpu" | "webgl";
	hud: boolean;
	mute: boolean;
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
	const backend = q.get("backend") ?? "webgpu";
	if (backend !== "webgpu" && backend !== "webgl")
		throw new Error(`bad backend param "${backend}"`);
	const level = num("level");
	if (
		level !== undefined &&
		!(Number.isInteger(level) && level >= 1 && level <= LEVELS.length)
	)
		throw new Error(`bad level param "${level}" (1-${LEVELS.length})`);
	return {
		demo: q.get("demo") === "1",
		level,
		solution: q.get("solution") === "1",
		run: q.get("run") === "1",
		agree: q.get("agree") === "1",
		mode,
		stopAtTick: num("ticks"),
		backend,
		hud: q.get("hud") !== "0",
		mute: q.get("mute") === "1",
	};
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	// The engine scene for rendering: the shared studio environment, lights and post. The
	// puzzle bodies live in per-run worlds (PuzzleSim) built from the same wasm module.
	const scene = {
		...structuredClone(baseScene),
		prefabs: {},
		entities: [],
	} as unknown as SceneInput;
	const game: Game = await createGame({
		canvas,
		scene,
		mode: p.mode,
		backend: p.backend,
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(p.stopAtTick !== undefined ? { stopAtTick: p.stopAtTick } : {}),
	});
	// The board owns the camera: no orbit controls.
	game.renderer.controller?.dispose();
	game.renderer.controller = null;
	const engine = engineFrom(game.sim);
	// Studio fill: a cool rim from behind-above and a little more environment on the gloss.
	const three = game.renderer.three;
	three.scene.environmentIntensity = 0.55;
	const rim = new DirectionalLight(new Color("#9db8ff"), 0.9);
	rim.position.set(6, 9, -8);
	three.scene.add(rim);

	const agreement = p.agree
		? LEVELS.map((level) => {
				const sim = new PuzzleSim(engine, level, level.solution);
				const r = sim.run();
				sim.dispose();
				return {
					level: level.id,
					status: r.status,
					tick: r.tick,
					hash: r.hash,
					expect: level.expect?.hash ?? null,
				};
			})
		: null;

	if (!p.hud) hudRoot.style.display = "none";
	const sfx = new Sfx(!p.mute && p.mode !== "fixed");
	// The HUD drives the app only when a player does: in `?demo=1` its buttons are inert,
	// so a stray click cannot pull the app out from under the autoplayer.
	let app: App | null = null;
	const ctl = (): App | null => (p.demo ? null : app);
	const hud = new Hud(hudRoot, {
		onPlay: (i) => ctl()?.loadLevel(i),
		onSelectPart: (k) => ctl()?.selectPart(k),
		onRun: () => ctl()?.run(),
		onReset: () => ctl()?.reset(),
		onClear: () => ctl()?.clear(),
		onMenu: () => ctl()?.showTitle(),
		onNext: () => ctl()?.next(),
		onRetry: () => ctl()?.retry(),
	});
	app = new App(game, engine, hud, sfx, canvas, !p.demo);
	const a = app;
	let demo: DemoDriver | null = null;
	if (p.demo) demo = new DemoDriver(a, (p.level ?? 1) - 1, p.mode !== "fixed");
	else if (p.level !== undefined) {
		a.loadLevel(p.level - 1);
		if (p.solution) {
			for (const s of a.level.solution)
				a.place(s.cell[0], s.cell[1], s.part, s.dir);
			if (p.run) a.run();
		}
	} else a.showTitle();

	let acc = 0;
	/** Smoothed CPU cost per frame (ms): ticks (sim + demo) and presentation. */
	const cpu = { simMs: 0, presentMs: 0 };
	game.onFrame((dt) => {
		const t0 = performance.now();
		acc += dt;
		let n = 0;
		while (acc >= DT - 1e-9 && n < 4) {
			acc -= DT;
			n++;
			demo?.step();
			a.tick();
		}
		if (n === 4) acc = 0;
		const t1 = performance.now();
		a.frame(dt, Math.min(1, acc / DT));
		const t2 = performance.now();
		cpu.simMs += (t1 - t0 - cpu.simMs) * 0.05;
		cpu.presentMs += (t2 - t1 - cpu.presentMs) * 0.05;
	});

	// The shot CLI reports `stateHash()`: make it the puzzle world's, not the empty render
	// scene's, so capture sidecars carry the run's real engine state hash.
	Object.assign(window.__pebble3d ?? {}, {
		stateHash: () => a.sim.world.stateHash(),
		game: {
			phase: () => a.phase,
			level: () => a.level.id,
			placements: () => a.placements.length,
			simTick: () => a.sim.tick,
			status: () => a.sim.status,
			hash: () => a.sim.world.stateHash(),
			demo: () => demo?.current ?? null,
			runs: () => a.runs,
			agreement: () => agreement,
			cpu: () => ({ ...cpu }),
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
