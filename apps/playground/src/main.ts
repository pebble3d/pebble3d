import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import { mountOverlay } from "@pebble3d/studio-overlay";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import manifest from "../assets.manifest.json";

/**
 * Playground URL params:
 *   scene=<name>          apps/playground/scenes/<name>.json (default "studio")
 *   mode=realtime|fixed   fixed = one sim tick per frame (screenshots)
 *   ticks=<n>             fixed-mode stopAtTick
 *   backend=webgpu|webgl  explicit backend fails loudly if unavailable; omitted =
 *                         webgpu with a WebGL fallback
 *   cam=<preset>          camera preset; "controller" keeps the scene's controller camera
 *   splat=<url>           overrides environment.splat.url
 *   debug=splatOnly       draws only the splat, no meshes and no post (colour reference)
 *   script=<name>         scripted player input for the whole run (see SCRIPTS)
 *   overlay               show the stats overlay (hidden by default in fixed mode;
 *                         backtick toggles it in either mode)
 */
interface PlaygroundParams {
	scene: string;
	mode: "realtime" | "fixed";
	stopAtTick: number | undefined;
	backend: "webgpu" | "webgl" | undefined;
	cam: string | undefined;
	splat: string | undefined;
	overlay: boolean;
	script: string | undefined;
	debug: string | undefined;
}

const sceneLoaders = import.meta.glob<SceneJson>("../scenes/*.json", {
	import: "default",
});

type SceneJson = Record<string, unknown> & {
	environment?: Record<string, unknown> & {
		preset?: string;
		hdri?: string;
		splat?: Record<string, unknown>;
	};
};

function readParams(search: string): PlaygroundParams {
	const q = new URLSearchParams(search);
	const ticks = q.get("ticks");
	const backend = q.get("backend");
	if (backend !== null && backend !== "webgpu" && backend !== "webgl")
		throw new Error(`bad backend param "${backend}" (webgpu|webgl)`);
	const mode = q.get("mode") ?? "realtime";
	if (mode !== "realtime" && mode !== "fixed")
		throw new Error(`bad mode param "${mode}" (realtime|fixed)`);
	const stopAtTick = ticks === null ? undefined : Number(ticks);
	if (
		stopAtTick !== undefined &&
		!(Number.isInteger(stopAtTick) && stopAtTick >= 0)
	)
		throw new Error(`bad ticks param "${ticks}"`);
	return {
		scene: q.get("scene") ?? "studio",
		mode,
		stopAtTick,
		backend: backend ?? undefined,
		cam: q.get("cam") ?? undefined,
		splat: q.get("splat") ?? undefined,
		overlay: q.has("overlay") && q.get("overlay") !== "0",
		script: q.get("script") ?? undefined,
		debug: q.get("debug") ?? undefined,
	};
}

async function loadScene(p: PlaygroundParams): Promise<SceneInput> {
	const load = sceneLoaders[`../scenes/${p.scene}.json`];
	if (!load) {
		const known = Object.keys(sceneLoaders)
			.map((k) => k.replace(/^.*\/|\.json$/g, ""))
			.join(", ");
		throw new Error(`unknown scene "${p.scene}" (known: ${known})`);
	}
	const json = structuredClone(await load());
	json.environment ??= {};
	const env = json.environment;
	if (p.splat !== undefined) env.splat = { ...env.splat, url: p.splat };
	// The outdoor preset's bundled default HDRI (first manifest entry) when none is given.
	const defaultHdri = manifest.assets.find((a) => a.file.endsWith(".hdr"));
	if ((env.preset ?? "outdoor") === "outdoor" && !env.hdri && defaultHdri)
		env.hdri = `${import.meta.env.BASE_URL}assets/${defaultHdri.file}`;
	return json as SceneInput;
}

/**
 * Scripted player input, applied once before the first frame and held for the whole run.
 * `toward` turns the third-person camera (and so "forward") to face a world XZ point from
 * the player's spawn position; without it the spawn facing is kept. `path` instead steers
 * "forward" through world XZ waypoints every frame, moving on within 0.4 m of each (the last
 * heading is kept after the final one). `jumpAtTick` presses Space for exactly one tick: the
 * sim step that produces that tick sees jump = true.
 */
interface InputScript {
	keys: { f?: boolean; b?: boolean; l?: boolean; r?: boolean };
	sprint?: boolean;
	toward?: [number, number];
	path?: [number, number][];
	jumpAtTick?: number;
}
const SIDE_PATH: [number, number][] = [
	[6.0, 12.9],
	[10.2, 7.5],
];
const SCRIPTS: Record<string, InputScript> = {
	/** Hold W. */
	"walk-forward": { keys: { f: true } },
	/** Hold W toward the crate stacks (the KCC pushes them). */
	"walk-into-crates": { keys: { f: true }, toward: [8.3, 7.9] },
	/** Sprint along the +Z edge toward the -X bounds wall (the KCC must stop at it). */
	"walk-to-bounds": { keys: { f: true }, sprint: true, toward: [-20, 13.4] },
	/**
	 * Hold W along the +Z edge, then turn and cross the hero camera's view side-on (an open
	 * 6.8 m lane for foot-sliding checks; reaches the lane at about tick 250).
	 */
	"walk-side": { keys: { f: true }, path: SIDE_PATH },
	/** As walk-side, sprinting (reaches the lane at about tick 75). */
	"sprint-side": { keys: { f: true }, sprint: true, path: SIDE_PATH },
	/** Hold W; Space for one tick at tick 40. */
	jump: { keys: { f: true }, jumpAtTick: 40 },
	/** walk-side with Space for one tick at tick 280, on the lane in the hero camera's view. */
	"jump-side": { keys: { f: true }, path: SIDE_PATH, jumpAtTick: 280 },
};

function applyScript(game: Game, name: string): void {
	const script = SCRIPTS[name];
	if (!script)
		throw new Error(
			`unknown script "${name}" (known: ${Object.keys(SCRIPTS).join(", ")})`,
		);
	const player = game.player;
	if (!player)
		throw new Error(`script "${name}" needs a scene with a character`);
	Object.assign(player.input.keys, script.keys);
	player.input.sprint = script.sprint === true;
	if (script.toward && player.camera) {
		const t = game.sim.world.transformOf(player.simId);
		if (!t) throw new Error(`script "${name}": player has no transform`);
		const dx = script.toward[0] - (t[0] as number);
		const dz = script.toward[1] - (t[2] as number);
		// forward = (-sin yaw, -cos yaw)
		player.camera.yaw = Math.atan2(-dx, -dz);
	}
	const path = script.path;
	const camera = player.camera;
	if (path && camera) {
		let next = 0;
		game.onFrame(() => {
			const t = game.sim.world.transformOf(player.simId);
			if (!t) return;
			let wp = path[next];
			while (wp) {
				const dx = wp[0] - (t[0] as number);
				const dz = wp[1] - (t[2] as number);
				if (dx * dx + dz * dz > 0.16) {
					camera.yaw = Math.atan2(-dx, -dz);
					break;
				}
				wp = path[++next];
			}
		});
	}
	const jumpAt = script.jumpAtTick;
	if (jumpAt !== undefined) {
		// onFrame runs after the player's input is sent for the next step, so a value set in
		// the frame at tick t is read in frame t + 1 and consumed by the step producing t + 2.
		const input = player.input;
		game.onFrame(() => {
			input.jump = game.sim.world.tick() === jumpAt - 2;
		});
	}
}

function isBackendUnavailable(e: unknown): boolean {
	return e instanceof Error && e.message.startsWith("BackendUnavailable");
}

async function main(): Promise<void> {
	const el = document.getElementById("app");
	if (!(el instanceof HTMLCanvasElement))
		throw new Error("#app canvas missing");
	let canvas: HTMLCanvasElement = el;
	const p = readParams(location.search);
	const scene = await loadScene(p);
	const base = {
		canvas,
		scene,
		mode: p.mode,
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		splatOnly: p.debug === "splatOnly",
		...(p.stopAtTick !== undefined ? { stopAtTick: p.stopAtTick } : {}),
	};
	let game: Game;
	try {
		game = await createGame({ ...base, backend: p.backend ?? "webgpu" });
	} catch (e) {
		// Only an implicit backend falls back; an explicit one must fail loudly.
		if (p.backend !== undefined || !isBackendUnavailable(e)) throw e;
		console.info("WebGPU unavailable, using the WebGL backend");
		// A canvas keeps its first context type; retry on a fresh one.
		const fresh = canvas.cloneNode() as HTMLCanvasElement;
		canvas.replaceWith(fresh);
		canvas = fresh;
		game = await createGame({ ...base, canvas, backend: "webgl" });
	}
	if (p.cam !== undefined) game.setCamera(p.cam);
	if (p.script !== undefined) applyScript(game, p.script);
	mountOverlay(game, undefined, {
		startVisible: p.mode !== "fixed" || p.overlay,
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
	showFatal(msg);
});

/** Makes a fatal startup error visible on the page, not just in the console. */
function showFatal(msg: string): void {
	const el = document.createElement("pre");
	el.id = "fatal-error";
	el.setAttribute("role", "alert");
	el.textContent = msg;
	el.style.cssText =
		"position:fixed;inset:auto 16px 16px 16px;margin:0;padding:12px 16px;" +
		"background:#2a0d0d;color:#ffd7d7;border:1px solid #ff6b6b;border-radius:6px;" +
		"font:14px/1.4 ui-monospace,monospace;white-space:pre-wrap;z-index:10";
	document.body.append(el);
}
