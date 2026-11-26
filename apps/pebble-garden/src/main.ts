import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import { App } from "./app.ts";
import { Sfx } from "./audio/sfx.ts";
import { DemoDriver } from "./demo.ts";
import { gardenByKey } from "./garden/gardens.ts";
import { DT, engineFrom } from "./garden/sim.ts";
import { Hud } from "./ui/hud.ts";

/**
 * Pebble Garden URL params:
 *   demo=1               autoplayer: builds a contraption, plays it, rewinds, exports it
 *   garden=<key>         open a starter garden in the editor (first-roll, domino-terrace,
 *                        turning-rake, rock-garden); free=1 opens a challenge unlocked
 *   solution=1           with garden: place the reference solution; play=1 then presses Play
 *   select=<id>          with garden: select that entity (inspector + gizmo)
 *   panel=export|import|help|picker  open that panel (captures); bad=1 fills the import box
 *                        with a broken scene and validates it
 *   mode=realtime|fixed  fixed = one tick per frame (captures); ticks=<n> stops there
 *   backend=webgpu|webgl, mute=1, hud=0
 */
interface Params {
	demo: boolean;
	garden: string | null;
	free: boolean;
	solution: boolean;
	play: boolean;
	select: string | null;
	panel: string | null;
	bad: boolean;
	mode: "realtime" | "fixed";
	stopAtTick: number | undefined;
	backend: "webgpu" | "webgl";
	mute: boolean;
	hud: boolean;
}

function readParams(search: string): Params {
	const q = new URLSearchParams(search);
	const mode = q.get("mode") ?? "realtime";
	if (mode !== "realtime" && mode !== "fixed")
		throw new Error(`bad mode param "${mode}"`);
	const backend = q.get("backend") ?? "webgpu";
	if (backend !== "webgpu" && backend !== "webgl")
		throw new Error(`bad backend param "${backend}"`);
	const ticks = q.get("ticks");
	const garden = q.get("garden");
	if (garden !== null && !gardenByKey(garden))
		throw new Error(`unknown garden "${garden}"`);
	return {
		demo: q.get("demo") === "1",
		garden,
		free: q.get("free") === "1",
		solution: q.get("solution") === "1",
		play: q.get("play") === "1",
		select: q.get("select"),
		panel: q.get("panel"),
		bad: q.get("bad") === "1",
		mode,
		stopAtTick: ticks !== null ? Number(ticks) : undefined,
		backend,
		mute: q.get("mute") === "1",
		hud: q.get("hud") !== "0",
	};
}

/** The render scene: environment, light and post only. Garden bodies live in per-run worlds. */
const RENDER_SCENE: SceneInput = {
	version: 1,
	environment: {
		preset: "studio",
		backdrop: { horizon: "#e9d9bd", zenith: "#8fa6b5" },
		fog: { near: 22, far: 60, color: "#e2d2b6" },
	},
	lighting: {
		sun: { direction: [-0.6, 0.62, 0.48], intensity: 4.6, color: "#ffe9cc" },
	},
	post: {
		exposure: 0.95,
		bloom: { strength: 0.22, threshold: 1.6 },
		ao: { radius: 0.45 },
	},
	camera: {
		controller: "orbit",
		presets: { hero: { position: [7, 6.5, 10], target: [0, 0.6, 0], fov: 45 } },
	},
	entities: [],
};

const BROKEN_SAMPLE = `{
  "version": 1,
  "entities": [
    { "id": "pebble", "mesh": { "primitive": "sphere", "material": { "colour": "#d9482f" } } },
    { "id": "ramp", "mesh": { "primitive": "cube" }, "body": { "type": "static" },
      "transform": { "position": [0, 1], "scale": [3, -0.1, 1] } },
    { "id": "bowl", "mesh": { "primitive": "cylinder", "material": { "roughness": 1.4 } },
      "body": { "type": "solid" } }
  ]
}`;

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	const game: Game = await createGame({
		canvas,
		scene: RENDER_SCENE,
		mode: p.mode,
		backend: p.backend,
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(p.stopAtTick !== undefined ? { stopAtTick: p.stopAtTick } : {}),
	});
	const three = game.renderer.three;
	three.scene.environmentIntensity = 0.32;
	const ctl = game.renderer.controller as {
		controls?: {
			mouseButtons?: object;
			minDistance: number;
			maxDistance: number;
		};
	} | null;
	if (ctl?.controls) {
		ctl.controls.minDistance = 3;
		ctl.controls.maxDistance = 32;
	}
	if (!p.hud) hudRoot.style.display = "none";
	const sfx = new Sfx(!p.mute && p.mode !== "fixed");
	const live = !p.demo;
	let app: App | null = null;
	const hud = new Hud(hudRoot, {
		action: (a, arg) => app?.action(a, arg),
		field: (c, commit) => app?.field(c, commit),
		importFile: (f) => app?.importFile(f),
	});
	hud.interactive = live;
	const a = new App(game, engineFrom(game.sim), hud, sfx, canvas, live);
	app = a;
	let demo: DemoDriver | null = null;
	if (p.demo) demo = new DemoDriver(a);
	else if (p.garden) {
		a.openGarden(p.garden, p.free);
		const g = gardenByKey(p.garden);
		if (p.solution && g)
			for (const s of g.solution) a.place(s.piece, s.position, s.rotation);
		if (p.select) a.selectEntity(p.select);
		if (p.play) a.play();
	} else if (p.panel === "picker") {
		a.showTitle();
		a.showPicker("challenges");
	} else a.showTitle();
	if (p.panel === "export") a.exportGarden();
	else if (p.panel === "help") hud.showHelp();
	else if (p.panel === "import") {
		if (p.bad) a.importScene(BROKEN_SAMPLE, "broken.json");
		else hud.showImport();
	}

	let acc = 0;
	const cpu = { simMs: 0, presentMs: 0 };
	game.onFrame((dt) => {
		const t0 = performance.now();
		acc += dt;
		let n = 0;
		while (acc >= DT - 1e-9 && n < 4) {
			acc -= DT;
			n++;
			demo?.tick();
			a.tick();
		}
		if (n === 4) acc = 0;
		const t1 = performance.now();
		a.frame(dt, Math.min(1, acc / DT));
		const t2 = performance.now();
		cpu.simMs += (t1 - t0 - cpu.simMs) * 0.05;
		cpu.presentMs += (t2 - t1 - cpu.presentMs) * 0.05;
	});

	// Shot sidecars report the garden run's own engine hash, not the empty render world's.
	const bootHash = game.sim.world.stateHash.bind(game.sim.world);
	Object.assign(window.__pebble3d ?? {}, {
		stateHash: () => a.sim?.hash() ?? bootHash(),
		game: {
			phase: () => a.phase,
			garden: () => a.gardenName,
			entities: () => a.doc.entities.length,
			simTick: () => a.sim?.tick ?? 0,
			status: () => a.sim?.status ?? null,
			inGoal: () => a.sim?.inGoal ?? 0,
			result: () => a.result,
			demo: () => (demo ? `${demo.stage}:${demo.current}` : null),
			runs: () => a.runs,
			exports: () => a.exports,
			exportBytes: () => a.lastExport.length,
			imports: () => ({ ...a.imports }),
			cpu: () => ({ ...cpu }),
		},
	});
	if (new URLSearchParams(location.search).get("debug") === "1")
		(window as unknown as { __garden: unknown }).__garden = { app: a, game };
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
	el.textContent = msg;
	el.style.cssText =
		"position:fixed;inset:auto 16px 16px 16px;margin:0;padding:12px 16px;background:#2a0d0d;color:#ffd7d7;border:1px solid #ff6b6b;font:14px ui-monospace,monospace;white-space:pre-wrap;z-index:10";
	document.body.append(el);
});
