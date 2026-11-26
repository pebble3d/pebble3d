import { createGame } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/yard.json";
import { App, type AppParams } from "./game/app.ts";
import { TRACKS } from "./game/tracks.ts";

/**
 * Drift Drone URL params:
 *   track=hall-circuit|needle-and-eaves   (default the first)
 *   flight=assisted|acro   flight mode (default assisted)
 *   demo=1                 the bot flies (skips the title; races again after the results)
 *   title=1                stay on the title screen
 *   cam=chase|fpv          start camera; ghost=0 no ghost; hud=0; mute=1
 *   debug=colliders        draw the proxy colliders and flight volume
 *   shotCam=px,py,pz,tx,ty,tz,fov  fixed camera while racing (staged capture stills)
 *   mode=realtime|fixed    fixed = one tick per frame (captures); ticks=<n> stops there
 */
interface Params extends AppParams {
	mode: "realtime" | "fixed";
	ticks: number | undefined;
	backend: "webgpu" | "webgl";
}

function readParams(search: string): Params {
	const q = new URLSearchParams(search);
	const mode = q.get("mode") ?? "realtime";
	if (mode !== "realtime" && mode !== "fixed")
		throw new Error(`bad mode param "${mode}"`);
	const trackQ = q.get("track");
	const track = trackQ === null ? 0 : TRACKS.findIndex((t) => t.id === trackQ);
	if (track < 0) throw new Error(`bad track param "${trackQ}"`);
	const flight = q.get("flight") ?? "assisted";
	if (flight !== "assisted" && flight !== "acro")
		throw new Error(`bad flight param "${flight}"`);
	const cam = q.get("cam") ?? "chase";
	if (cam !== "chase" && cam !== "fpv")
		throw new Error(`bad cam param "${cam}"`);
	const backend = q.get("backend") ?? "webgpu";
	if (backend !== "webgpu" && backend !== "webgl")
		throw new Error(`bad backend param "${backend}"`);
	const ticksQ = q.get("ticks");
	const ticks = ticksQ === null ? undefined : Number(ticksQ);
	if (ticks !== undefined && !(ticks >= 0))
		throw new Error(`bad ticks param "${ticksQ}"`);
	const sc = q.get("shotCam");
	const shotCam = sc ? sc.split(",").map(Number) : null;
	if (
		shotCam &&
		(shotCam.length !== 7 || shotCam.some((v) => !Number.isFinite(v)))
	)
		throw new Error(`bad shotCam param "${sc}"`);
	return {
		track,
		mode,
		ticks,
		backend,
		flight,
		demo: q.get("demo") === "1",
		title: q.get("title") === "1",
		cam,
		ghost: q.get("ghost") !== "0",
		hud: q.get("hud") !== "0",
		mute: q.get("mute") === "1",
		fixed: mode === "fixed",
		debug: q.get("debug") === "colliders",
		shotCam,
	};
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	const game = await createGame({
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
