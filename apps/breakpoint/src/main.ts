import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/site.json";
import { DT } from "./game/constants.ts";
import { InlineHost, type SimHost, WorkerHost } from "./game/host.ts";
import { LEVELS } from "./game/levels.ts";
import { Presentation } from "./game/present.ts";
import { PHASE_NAMES } from "./game/session.ts";
import type { WorldSource } from "./game/site.ts";

/**
 * Breakpoint URL params:
 *   demo=1               autoplayer: plays every site, then replays the best shot
 *   seed=<n>             run seed (default 7)
 *   level=<n>            start at site n (0-based; the run ends after the last site)
 *   start=1              skip the title (demo implies it after a short hold)
 *   mode=realtime|fixed  fixed = one frame per 1/60 s of game time (captures); ticks=<n> stops
 *   hud=0                hide the HUD; mute=1 no audio; stats=1 show the debug stats line
 *   camYaw/camPitch/camDist  lock the camera around the site (captures)
 *   build=det|fast       Rapier build (default: the scene's, fast: SIMD, same-binary deterministic)
 *   worker=0             run the sim on the main thread (fixed mode always does)
 *   backend=webgpu|webgl renderer backend (default webgpu; webgl = the WebGL fallback path)
 */
interface Params {
	demo: boolean;
	seed: number;
	level: number;
	/** Show the debug stats line (fps, bodies, Rapier ms/tick). */
	stats: boolean;
	start: boolean;
	mode: "realtime" | "fixed";
	stopAtTick: number | undefined;
	hud: boolean;
	mute: boolean;
	cam: { yaw: number; pitch: number; dist: number } | null;
	build: "deterministic" | "fast" | undefined;
	worker: boolean;
	backend: "webgpu" | "webgl";
}

function levelParam(v: number | undefined): number {
	if (v === undefined) return 0;
	if (!Number.isInteger(v) || v < 0 || v >= LEVELS.length)
		throw new Error(`bad level param "${v}" (0..${LEVELS.length - 1})`);
	return v;
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
	const yaw = num("camYaw");
	const build = q.get("build");
	if (build !== null && build !== "det" && build !== "fast")
		throw new Error(`bad build param "${build}"`);
	const backend = q.get("backend") ?? "webgpu";
	if (backend !== "webgpu" && backend !== "webgl")
		throw new Error(`bad backend param "${backend}"`);
	return {
		demo: q.get("demo") === "1",
		seed: num("seed") ?? 7,
		level: levelParam(num("level")),
		start: q.get("start") === "1",
		mode,
		stopAtTick: num("ticks"),
		hud: q.get("hud") !== "0",
		stats: q.get("stats") === "1",
		mute: q.get("mute") === "1",
		cam:
			yaw !== undefined
				? { yaw, pitch: num("camPitch") ?? 0.35, dist: num("camDist") ?? 30 }
				: null,
		build:
			build === "fast" ? "fast" : build === "det" ? "deterministic" : undefined,
		worker: mode === "realtime" && q.get("worker") !== "0",
		backend,
	};
}

/** Frames the demo holds the title before it starts. */
const DEMO_TITLE_FRAMES = 90;

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	const game: Game = await createGame({
		canvas,
		scene: (p.build
			? { ...sceneJson, sim: { ...sceneJson.sim, build: p.build } }
			: sceneJson) as unknown as SceneInput,
		mode: p.mode,
		backend: p.backend,
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(p.stopAtTick !== undefined ? { stopAtTick: p.stopAtTick } : {}),
	});
	const pres = new Presentation(game, {
		demo: p.demo,
		startLevel: p.level,
		hud: p.hud ? hudRoot : null,
		mute: p.mute || p.mode === "fixed",
		cam: p.cam,
		stats: p.stats,
	});
	const build = p.build ?? (sceneJson.sim.build as "deterministic" | "fast");
	const driverOpts = {
		seed: p.seed,
		startLevel: p.level,
		demo: p.demo,
		fixed: p.mode === "fixed",
	};
	let host: SimHost;
	if (p.worker) {
		// Real-time play: Rapier steps in a worker; this thread only renders.
		const wh = new WorkerHost(
			new Worker(new URL("./game/sim.worker.ts", import.meta.url), {
				type: "module",
			}),
			build === "fast" ? fastWasmUrl : detWasmUrl,
			build,
			driverOpts,
			pres,
		);
		await wh.ready;
		wh.onFatal = (msg) => {
			game.stop();
			fatal(new Error(msg));
		};
		// A hidden tab stops rAF; pause the sim clock too so nothing piles up.
		document.addEventListener("visibilitychange", () =>
			wh.pause(document.hidden),
		);
		host = wh;
	} else {
		// The demolition runs in its own worlds (one per site, plus replay copies) made from
		// the wasm build the engine loaded.
		const World = game.sim.world.constructor as new (
			seed: number,
			gravity: number,
		) => Game["sim"]["world"];
		const src: WorldSource = {
			make: () => new World(1, -9.81),
			memory: game.sim.memory,
		};
		host = new InlineHost(src, driverOpts, pres);
	}
	pres.attach(host);
	if (p.start) pres.begin();
	if (!p.hud) hudRoot.style.display = "none";
	let frames = 0;
	game.onFrame((dt) => {
		frames++;
		if (p.demo && frames === DEMO_TITLE_FRAMES) pres.begin();
		pres.frame(p.mode === "fixed" ? DT : Math.min(dt, 0.1));
	});

	Object.assign(window.__pebble3d ?? {}, {
		game: {
			...Object.fromEntries(
				Object.entries({
					phase: () => PHASE_NAMES[host.status().phase],
					probe: () => pres.probe(),
				}),
			),
		},
	});
	game.start();
}

/** Shows a fatal error (overlay, console, `__pebble3d.error`). */
function fatal(e: unknown): void {
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
}

main().catch(fatal);
