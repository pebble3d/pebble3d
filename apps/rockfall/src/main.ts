import {
	createRenderer,
	type EngineRenderer,
	updateCsmFrustums,
} from "@pebble3d/renderer";
import { expandScene } from "@pebble3d/sdk/expand";
import type { AdapterInfo, Pebble3DHook } from "@pebble3d/sdk/game";
import { FixedStepLoop } from "@pebble3d/sdk/loop";
import { parseScene, type SceneInput } from "@pebble3d/sdk/schema";
import { loadSim, type SimBuild } from "@pebble3d/sdk/sim";
import type { GameStats } from "@pebble3d/sdk/types";
import { HemisphereLight } from "three/webgpu";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/arena.json";
import { Sfx } from "./game/audio/sfx.ts";
import { DemoBot } from "./game/bot.ts";
import { DT, MAX_ROCKS, MAX_ROCKS_FAST } from "./game/constants.ts";
import { EV } from "./game/events.ts";
import { worldFactory } from "./game/factory.ts";
import { emptyInput, InputLog } from "./game/input.ts";
import { LiveInput } from "./game/live-input.ts";
import { PHASE, PHASE_NAMES } from "./game/phase.ts";
import { KIND } from "./game/rocks.ts";
import { defaultConfig, RockfallSim } from "./game/sim.ts";
import { type EngineStats, Hud } from "./game/ui/hud.ts";
import { Effects } from "./game/vfx/effects.ts";
import { buildArena } from "./game/view/arena-view.ts";
import { CameraRig } from "./game/view/camera-rig.ts";
import { PickupView } from "./game/view/pickup-view.ts";
import { PlayerView, ROBOT_URL } from "./game/view/player-view.ts";
import { RockView } from "./game/view/rock-view.ts";
import { TelegraphView } from "./game/view/telegraph-view.ts";

/**
 * Rockfall URL params:
 *   demo=1               autoplayer (starts from the title, restarts after game over)
 *   demoWaves=<n>        the autoplayer stands down after wave n (0 = never)
 *   seed=<n>             run seed (default: random in realtime, 7 in fixed mode)
 *   wave=<n>             first wave of a run; rubble=<n> rocks dropped in the countdown
 *   god=1                no damage (perf runs, long captures)
 *   build=deterministic|fast   engine build (default: the scene's, deterministic)
 *   mode=realtime|fixed  fixed = one tick per frame (captures); ticks=<n> stops there
 *   backend=webgpu|webgl, hud=0, mute=1
 *   camYaw/camPitch/camDist  gameplay camera overrides (radians, metres)
 *   cam=<preset>         a scene camera preset (hero, overhead) instead of the chase camera
 */
interface Params {
	demo: boolean;
	seed: number;
	wave: number;
	rubble: number;
	god: boolean;
	build: SimBuild | undefined;
	mode: "realtime" | "fixed";
	stopAtTick: number | undefined;
	backend: "webgpu" | "webgl";
	hud: boolean;
	mute: boolean;
	camYaw: number | undefined;
	camPitch: number | undefined;
	camDist: number | undefined;
	start: boolean;
	demoWaves: number;
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
	const build = q.get("build");
	if (build !== null && build !== "deterministic" && build !== "fast")
		throw new Error(`bad build param "${build}"`);
	return {
		demo: q.get("demo") === "1",
		seed: num("seed") ?? (mode === "fixed" ? 7 : (Date.now() % 100000) + 1),
		wave: num("wave") ?? 1,
		rubble: num("rubble") ?? 0,
		god: q.get("god") === "1",
		build: build ?? undefined,
		mode,
		stopAtTick: num("ticks"),
		backend,
		hud: q.get("hud") !== "0",
		mute: q.get("mute") === "1",
		camYaw: num("camYaw"),
		camPitch: num("camPitch"),
		camDist: num("camDist"),
		start: q.get("start") === "1",
		demoWaves: num("demoWaves") ?? 0,
	};
}

interface GpuAdapterInfoLike {
	vendor?: string;
	architecture?: string;
	device?: string;
	description?: string;
}

/**
 * WebGPU: the device's adapter info (or a fresh adapter's). WebGL: the unmasked GL vendor and
 * renderer strings, so `pnpm shot` can still recognise (and refuse) SwiftShader. Mirrors the
 * sdk's `createGame` probe.
 */
async function adapterInfoOf(renderer: EngineRenderer): Promise<AdapterInfo> {
	const backend = renderer.stats().backend;
	const out: AdapterInfo = {
		backend,
		vendor: "",
		architecture: "",
		device: "",
		description: "",
	};
	const be = renderer.three.renderer.backend as {
		device?: { adapterInfo?: GpuAdapterInfoLike };
		gl?: WebGL2RenderingContext;
	};
	if (backend === "webgpu") {
		let info = be.device?.adapterInfo;
		if (!info) {
			const gpu = (
				navigator as {
					gpu?: {
						requestAdapter(
							o?: object,
						): Promise<{ info?: GpuAdapterInfoLike } | null>;
					};
				}
			).gpu;
			info = (await gpu?.requestAdapter({ featureLevel: "compatibility" }))
				?.info;
		}
		out.vendor = info?.vendor ?? "";
		out.architecture = info?.architecture ?? "";
		out.device = info?.device ?? "";
		out.description = info?.description ?? "";
		return out;
	}
	const gl = be.gl;
	if (gl) {
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		const vendor = String(
			gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
		);
		const device = String(
			gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
		);
		out.vendor = vendor;
		out.device = device;
		out.description = device;
		out.architecture = /swiftshader/i.test(device) ? "swiftshader" : "";
	}
	return out;
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	const input0 = structuredClone(sceneJson) as unknown as SceneInput & {
		post: { ao: { enabled: boolean } };
	};
	// ?ao=0: GTAO off (perf experiments on weak GPUs).
	if (new URLSearchParams(location.search).get("ao") === "0")
		input0.post.ao.enabled = false;
	const scene = parseScene(input0);
	const x = expandScene(scene);
	const build: SimBuild = p.build ?? scene.sim.build;
	const wasmUrl = build === "deterministic" ? detWasmUrl : fastWasmUrl;
	const [handle, renderer] = await Promise.all([
		loadSim(build, wasmUrl, { seed: p.seed }),
		createRenderer(canvas, x.settings, { backend: p.backend }),
	]);
	const three = renderer.three;
	const sim = new RockfallSim(
		worldFactory(handle),
		defaultConfig({
			seed: p.seed,
			startWave: p.wave,
			rubble: p.rubble,
			god: p.god,
			autoStart: p.start,
			maxRocks: build === "fast" ? MAX_ROCKS_FAST : MAX_ROCKS,
		}),
	);

	// Golden-hour grade: a dimmer sky IBL plus a warm bounce fill, so walls facing away from
	// the sun read as warm shade rather than black.
	three.scene.environmentIntensity = 0.55;
	three.scene.backgroundIntensity = 1;
	three.scene.add(new HemisphereLight(0xffd2a1, 0x6b4428, 1.1));
	buildArena(three.scene);
	const gltf = await renderer.loadGltf(ROBOT_URL);
	const player = new PlayerView(three.scene, gltf, sim);
	const rocks = new RockView(renderer);
	const rings = new TelegraphView(three.scene, sim);
	const pickups = new PickupView(three.scene, sim);
	const fx = new Effects(three.scene, sim);
	const cam = new CameraRig(three.camera, sim);
	if (p.camYaw !== undefined) cam.yaw = p.camYaw;
	if (p.camPitch !== undefined) cam.pitch = p.camPitch;
	if (p.camDist !== undefined) cam.dist = p.camDist;
	const hud = p.hud ? new Hud(hudRoot, sim, three.camera) : null;
	const sfx = new Sfx(!p.mute && p.mode === "realtime");
	const bot = p.demo ? new DemoBot(sim, { waves: p.demoWaves }) : null;
	const live = bot ? null : new LiveInput(canvas);

	// --- resize ---
	const applySize = (): void => {
		renderer.resize(
			canvas.clientWidth,
			canvas.clientHeight,
			Math.min(window.devicePixelRatio || 1, 2),
		);
	};
	applySize();
	new ResizeObserver(applySize).observe(canvas);
	// A device-pixel-ratio change (window dragged to another display) re-applies the size.
	const watchDpr = (): void => {
		matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
			"change",
			() => {
				applySize();
				watchDpr();
			},
			{ once: true },
		);
	};
	watchDpr();
	cam.update(0);
	updateCsmFrustums(renderer.csm);

	// --- stats + hook ---
	const eng: EngineStats = {
		active: 0,
		sleeping: 0,
		build,
		fps: 0,
		physicsMs: 0,
		fixed: p.mode === "fixed",
	};
	const r0 = renderer.stats();
	const stats: GameStats = {
		...r0,
		physicsMs: 0,
		activeBodies: 0,
		sleepingBodies: 0,
		build,
		tick: 0,
		errors: renderer.errors(),
	};
	const sample = (): void => {
		const [a, s] = sim.bodyCounts();
		eng.active = a;
		eng.sleeping = s;
		stats.activeBodies = a;
		stats.sleepingBodies = s;
	};
	sample();
	const log = new InputLog();
	const hook: Partial<Pebble3DHook> & {
		game?: Record<string, () => unknown>;
	} = {
		ready: false,
		done: false,
		frame: 0,
		tick: 0,
		adapterInfo: await adapterInfoOf(renderer),
		// "controller" (or "game") returns to the chase camera; any scene preset name
		// suspends it and frames that preset.
		setCamera: (name: string) => {
			if (name === "controller" || name === "game") {
				cam.enabled = true;
				return;
			}
			cam.enabled = false;
			renderer.setCameraPreset(name);
		},
		stateHash: () => sim.world.stateHash(),
		stats: () => {
			const r = renderer.stats();
			Object.assign(stats, r);
			stats.tick = sim.tick;
			stats.errors = renderer.errors();
			return stats;
		},
		game: {
			phase: () => PHASE_NAMES[sim.phase],
			wave: () => sim.wave,
			score: () => sim.score,
			hp: () => sim.hp,
			mult: () => sim.mult,
			nearMisses: () => sim.nearMisses,
			crystals: () => sim.crystals,
			rocks: () => sim.rockCount,
			spawned: () => sim.totalSpawned,
			bodies: () => sim.bodyCounts(),
			rings: () => rings.count,
			hash: () => sim.hash(),
			inputs: () => log.length,
			simMs: () => Math.round(eng.physicsMs * 100) / 100,
			player: () => [sim.px, sim.py, sim.pz],
		},
	};
	window.__pebble3d = hook;
	// `pnpm shot --cam <preset>` arrives as ?cam=<preset>.
	const camParam = new URLSearchParams(location.search).get("cam");
	if (camParam) hook.setCamera?.(camParam);

	// --- loop ---
	const loop = new FixedStepLoop(
		// At most 2 catch-up ticks per frame: under load the game slows down instead of
		// spiralling (each extra tick makes the next frame later still).
		p.stopAtTick !== undefined
			? { mode: p.mode, stopAtTick: p.stopAtTick, maxTicksPerFrame: 2 }
			: { mode: p.mode, maxTicksPerFrame: 2 },
	);
	const input = emptyInput();
	let last = -1;
	let frame = 0;
	let falling = 0;
	const frameStep = (now: number): void => {
		requestAnimationFrame(frameStep);
		const rdt = last < 0 ? 0 : (now - last) / 1000;
		last = now;
		const adv = loop.advance(rdt, sim.tick);
		const t0 = performance.now();
		for (let i = 0; i < adv.ticks; i++) {
			if (bot) bot.next(input);
			else if (live)
				live.sample(
					input,
					sim.phase === PHASE.TITLE || sim.phase === PHASE.OVER,
				);
			log.push(input);
			sim.step(input);
			const ev = sim.events;
			for (let e = 0; e < ev.n; e++) {
				const t = ev.type[e];
				if (t === EV.RESET) {
					rocks.clear();
					player.reset();
				} else if (t === EV.HIT) {
					player.hit();
					cam.shake((ev.v[e] as number) > 0 ? 0.35 : 0.6);
				} else if (t === EV.BLAST) {
					const d = Math.hypot(
						(ev.x[e] as number) - sim.px,
						(ev.z[e] as number) - sim.pz,
					);
					cam.shake(Math.max(0.15, 0.75 - d * 0.04));
				} else if (t === EV.LAND && (ev.a[e] as number) >= KIND.BOULDER) {
					const d = Math.hypot(
						(ev.x[e] as number) - sim.px,
						(ev.z[e] as number) - sim.pz,
					);
					cam.shake(Math.max(0, 0.32 - d * 0.025));
				}
			}
			rocks.apply(sim);
			fx.handle(ev);
			hud?.handle(ev);
			sfx.handle(ev, sim);
		}
		const t1 = performance.now();
		if (adv.ticks > 0)
			eng.physicsMs += ((t1 - t0) / adv.ticks - eng.physicsMs) * 0.1;
		stats.physicsMs = eng.physicsMs;
		const fdt = p.mode === "fixed" ? adv.ticks * DT : rdt;
		const views = sim.views;
		views.refresh();
		renderer.sync(views.prev, views.curr, adv.alpha);
		player.update(fdt, adv.alpha);
		if (cam.enabled) cam.update(fdt);
		rings.update(fdt, adv.alpha);
		pickups.update(fdt);
		fx.update(fdt, three.camera);
		eng.fps = renderer.stats().fps;
		hud?.update(fdt, eng);
		if ((frame & 7) === 0) {
			falling = rings.count;
			sfx.frame(falling);
		}
		renderer.render(rdt);
		frame++;
		if (frame % 30 === 0) sample();
		hook.frame = frame;
		hook.tick = sim.tick;
		hook.ready = true;
		if (
			p.mode === "fixed" &&
			p.stopAtTick !== undefined &&
			sim.tick >= p.stopAtTick
		)
			hook.done = true;
	};
	requestAnimationFrame(frameStep);
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
