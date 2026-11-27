import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/academy.json";
import { App, type AppParams } from "./game/app.ts";
import type { Belt } from "./game/cpu.ts";

/**
 * Flowroll URL params:
 *   demo=1                CPU vs CPU plays the whole loop, rematches forever (captures, smoke)
 *   title=1               stay on the title screen
 *   belt=white|blue|black CPU partner's belt (default blue); demo: the second CPU's belt
 *   belt2=white|blue|black demo: the first CPU's belt (default = belt)
 *   versus=1              two players on one keyboard
 *   tutorial=1            start in the guided tutorial roll
 *   round=<seconds>       round length (default 180; 30..600)
 *   seed=<n>              match seed (default random in realtime, 1 in fixed mode / demo)
 *   pose=<id|all>         pose gallery (review); view=q|front|side|top|back for one pose
 *   mode=realtime|fixed   fixed = one tick per frame (captures); ticks=<n> stops there
 *   dof=1 turns on depth of field on submissions (off by default: it bands on the mat);
 *   hud=0 hides the HUD; mute=1 no audio; backend=webgl; webglFallback=1
 */
function readParams(search: string): AppParams & {
	mode: "realtime" | "fixed";
	ticks: number | undefined;
	backend: "webgpu" | "webgl";
} {
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
	const belt = (k: string, d: Belt): Belt => {
		const v = q.get(k) ?? d;
		if (v !== "white" && v !== "blue" && v !== "black")
			throw new Error(`bad ${k} param "${v}"`);
		return v;
	};
	const demo = q.get("demo") === "1";
	const round = num("round") ?? 180;
	if (round < 30 || round > 600)
		throw new Error(`bad round param "${round}" (30..600)`);
	const b = belt("belt", "blue");
	// a random seed is picked at boot, outside the sim, only for realtime human play
	const seed =
		num("seed") ?? (demo || mode === "fixed" ? 1 : Date.now() % 100000);
	return {
		demo,
		title: q.get("title") === "1",
		belt: b,
		belt2: belt("belt2", b),
		versus: q.get("versus") === "1",
		tutorial: q.get("tutorial") === "1",
		roundSec: round,
		seed,
		pose: q.get("pose"),
		view: q.get("view") ?? "q",
		hud: q.get("hud") !== "0",
		dof: q.get("dof") === "1",
		mute: q.get("mute") === "1" || mode === "fixed",
		fixed: mode === "fixed",
		mode,
		ticks: num("ticks"),
		backend,
	};
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	const game: Game = await createGame({
		canvas,
		scene: sceneJson as unknown as SceneInput,
		mode: p.mode,
		backend: p.backend,
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(p.ticks !== undefined ? { stopAtTick: p.ticks } : {}),
	});
	const app = new App(game, p, hudRoot);
	game.onFrame((dt) => app.frame(dt));
	Object.assign(window.__pebble3d ?? {}, {
		game: { probe: () => app.probe() },
		// report the match's own state, not createGame's empty physics world
		stateHash: () => app.hash(),
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
