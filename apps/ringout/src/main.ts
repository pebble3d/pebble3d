import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/arena.json";
import { App, type AppParams } from "./game/app.ts";
import type { SlotKind } from "./game/match.ts";

/**
 * Ringout URL params:
 *   demo=1                bots fill every seat and the match plays itself (captures, smoke)
 *   title=1               stay on the title screen
 *   seats=p1,p2,bot,off   seat setup (default p1,bot,bot,bot; demo bot,bot,bot,bot)
 *   bestOf=3|5|7          match length (default 5; demo 3)
 *   seed=<n>              match seed (default: random in realtime, 1 in fixed mode / demo)
 *   replay=0              skip instant replays
 *   mode=realtime|fixed   fixed = one tick per frame (captures); ticks=<n> stops there
 *   hud=0 hides the HUD; mute=1 no audio; backend=webgl
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
	const demo = q.get("demo") === "1";
	const kinds: SlotKind[] = ["p1", "p2", "bot", "off"];
	const seatsQ = q.get("seats");
	let slots: SlotKind[] = demo
		? ["bot", "bot", "bot", "bot"]
		: ["p1", "bot", "bot", "bot"];
	if (seatsQ !== null) {
		const parts = seatsQ.split(",");
		if (parts.length !== 4 || parts.some((p) => !kinds.includes(p as SlotKind)))
			throw new Error(`bad seats param "${seatsQ}" (four of p1|p2|bot|off)`);
		if (
			parts.filter((p) => p === "p1").length > 1 ||
			parts.filter((p) => p === "p2").length > 1
		)
			throw new Error(
				`bad seats param "${seatsQ}" (p1 and p2 may each appear once)`,
			);
		slots = parts as SlotKind[];
	}
	const bestOf = num("bestOf") ?? (demo ? 3 : 5);
	if (![3, 5, 7].includes(bestOf))
		throw new Error(`bad bestOf param "${bestOf}"`);
	// a random seed is picked at boot, outside the sim, only for realtime human play
	const seed =
		num("seed") ?? (demo || mode === "fixed" ? 1 : Date.now() % 100000);
	return {
		demo,
		title: q.get("title") === "1",
		slots,
		toWin: (bestOf + 1) / 2,
		seed,
		hud: q.get("hud") !== "0",
		mute: q.get("mute") === "1" || mode === "fixed",
		replay: q.get("replay") !== "0",
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
	game.onFrame((dt) => app.frame_(dt));
	Object.assign(window.__pebble3d ?? {}, {
		game: { probe: () => app.probe() },
		// report the round's own world, not createGame's empty one
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
