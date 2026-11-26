import { createGame, type Game } from "@pebble3d/sdk/game";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import { App, type AppParams } from "./game/app.ts";
import { COURSES } from "./game/courses.ts";
import type { GhostMode } from "./game/ui/hud.ts";
import { SKINS, type Skin } from "./game/view/marbles.ts";

/**
 * Ghostline URL params:
 *   course=sunfold|lacquer|undertow   which course (default the first)
 *   demo=1               the bot drives (captures, smoke test); skips the title
 *   title=1              stay on the title screen
 *   skin=glass|chrome|ember, ghost=best|par|off, seed=<n> (only without a ghost)
 *   mode=realtime|fixed  fixed = one tick per frame (captures); ticks=<n> stops there
 *   bot=fast|par|slow    demo driver tuning (fast races ahead of the par ghost)
 *   hud=0 hides the HUD; mute=1 no audio; camAngle=<rad>, camDist=<m> chase overrides
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
	const course = q.get("course") ?? (COURSES[0]?.id as string);
	if (!COURSES.some((c) => c.id === course))
		throw new Error(`bad course param "${course}"`);
	const skinQ = q.get("skin");
	if (skinQ !== null && !SKINS.includes(skinQ as Skin))
		throw new Error(`bad skin param "${skinQ}"`);
	const ghostQ = q.get("ghost");
	if (
		ghostQ !== null &&
		ghostQ !== "best" &&
		ghostQ !== "par" &&
		ghostQ !== "off"
	)
		throw new Error(`bad ghost param "${ghostQ}"`);
	const backend = q.get("backend") ?? "webgpu";
	if (backend !== "webgpu" && backend !== "webgl")
		throw new Error(`bad backend param "${backend}"`);
	const demo = q.get("demo") === "1";
	return {
		course,
		demo,
		title: q.get("title") === "1",
		skin:
			(skinQ as Skin | null) ??
			(mode === "fixed" ? "glass" : (App.savedSkin() ?? "glass")),
		ghost:
			(ghostQ as GhostMode | null) ??
			(demo || mode === "fixed" ? "par" : (App.savedMode() ?? "best")),
		seed: num("seed"),
		hud: q.get("hud") !== "0",
		mute: q.get("mute") === "1" || mode === "fixed",
		camAngle: num("camAngle"),
		camDist: num("camDist"),
		bot: q.get("bot") ?? "fast",
		save: q.get("save") === "1",
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
	const course = COURSES.find((c) => c.id === p.course);
	if (!course) throw new Error("no course");
	const game: Game = await createGame({
		canvas,
		scene: course.scene,
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
