import { createRenderer, updateCsmFrustums } from "@pebble3d/renderer";
import { expandScene } from "@pebble3d/sdk/expand";
import type { Pebble3DHook } from "@pebble3d/sdk/game";
import { parseScene, type SceneInput } from "@pebble3d/sdk/schema";
import type { SimBuild } from "@pebble3d/sdk/sim";
import type { GameStats } from "@pebble3d/sdk/types";
import { HemisphereLight, Vector3 } from "three/webgpu";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/plateau.json";
import { adapterInfoOf } from "./game/adapter.ts";
import { Sfx } from "./game/audio/sfx.ts";
import { MAX_TOWERS, WAVES } from "./game/constants.ts";
import { TOWERS } from "./game/defs.ts";
import { EV } from "./game/events.ts";
import {
	type HostOptions,
	InlineHost,
	makeSim,
	type SimHost,
	WorkerHost,
} from "./game/host.ts";
import { CMD } from "./game/input.ts";
import { buildMask, buildPaths } from "./game/path.ts";
import { defaultConfig, PHASE, PHASE_NAMES, PICK } from "./game/sim.ts";
import {
	E_STRIDE,
	H,
	OFF_EVENTS,
	OFF_TOWERS,
	T_STRIDE,
} from "./game/snapshot.ts";
import { Hud, type PerfInfo } from "./game/ui/hud.ts";
import { Fx } from "./game/vfx/fx.ts";
import { CameraRig } from "./game/view/camera-rig.ts";
import { SwarmView } from "./game/view/swarm-view.ts";
import { TowerView } from "./game/view/tower-view.ts";
import { WorldView } from "./game/view/world-view.ts";

/**
 * Swarm Siege URL params:
 *   demo=1             autoplayer: places towers by raycast pick, calls waves, restarts
 *   seed=<n>           run seed (default: random in realtime, 7 in fixed mode)
 *   wave=<n>           first wave; gold=<n> extra starting gold; start=1 skips the title
 *   stress=1 rate=<n>  perf stress: an endless stream of rate/s mites that loop (no towers needed)
 *   worker=0|1         sim in a Web Worker (default 1 in realtime; fixed mode always inline)
 *   build=fast|deterministic   wasm build (default: the scene's, fast)
 *   mode=realtime|fixed, ticks=<n>   fixed = one tick per frame (captures), stop at tick n
 *   backend=webgpu|webgl, hud=0, perf=0 (hide the perf panel), mute=1, cam=<preset>
 *   camYaw/camPitch/camDist/camX/camZ   camera overrides; drift=<rad/s> slow orbit
 *   select=<tower index>  show that tower's selection card (captures)
 *   ghost=<type>@<x>,<z>  show a placement ghost at world (x, z) (captures)
 */
function readParams(search: string) {
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
		// Clamped: a fractional or out-of-range wave would never finish spawning.
		wave: Math.min(WAVES, Math.max(1, Math.round(num("wave") ?? 1))),
		gold: Math.max(0, Math.round(num("gold") ?? 0)),
		start: q.get("start") === "1",
		stress: q.get("stress") === "1",
		rate: Math.min(20000, Math.max(1, num("rate") ?? 400)),
		worker: mode === "realtime" && q.get("worker") !== "0",
		build: (build ?? undefined) as SimBuild | undefined,
		mode: mode as "realtime" | "fixed",
		stopAtTick: num("ticks"),
		backend: backend as "webgpu" | "webgl",
		hud: q.get("hud") !== "0",
		perf: q.get("perf") !== "0",
		mute: q.get("mute") === "1",
		cam: q.get("cam"),
		camYaw: num("camYaw"),
		camPitch: num("camPitch"),
		camDist: num("camDist"),
		camX: num("camX"),
		camZ: num("camZ"),
		drift: num("drift"),
		select: num("select"),
		ghost: q.get("ghost"),
	};
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const p = readParams(location.search);
	const scene = parseScene(sceneJson as unknown as SceneInput);
	const x = expandScene(scene);
	const build: SimBuild = p.build ?? scene.sim.build;
	const wasmUrl = new URL(
		build === "deterministic" ? detWasmUrl : fastWasmUrl,
		location.href,
	).href;
	const opts: HostOptions = {
		build,
		wasmUrl,
		cfg: defaultConfig({
			seed: p.seed,
			stress: p.stress,
			stressRate: p.rate,
			autoStart: p.start,
			startWave: p.wave,
			bonusGold: p.gold,
		}),
		demo: p.demo,
		mode: p.mode,
		...(p.stopAtTick !== undefined ? { stopAtTick: p.stopAtTick } : {}),
	};
	const fatal = (msg: string): void => showFatal(msg);
	const [host, renderer]: [
		SimHost,
		Awaited<ReturnType<typeof createRenderer>>,
	] = await Promise.all([
		p.worker
			? WorkerHost.start(opts, fatal)
			: makeSim(opts).then((sim) => new InlineHost(sim, opts)),
		createRenderer(canvas, x.settings, { backend: p.backend }),
	]);
	const three = renderer.three;
	three.scene.environmentIntensity = 0.12;
	three.scene.add(new HemisphereLight(0x5a5cff, 0x120a18, 0.45));
	const paths = buildPaths();
	const mask = buildMask(paths);
	const world = new WorldView(three.scene, paths, mask);
	const swarm = new SwarmView(three.scene);
	const towers = new TowerView(three.scene);
	const fx = new Fx(three.scene);
	const cam = new CameraRig(three.camera, canvas);
	if (p.camYaw !== undefined) cam.yaw = p.camYaw;
	if (p.camPitch !== undefined) cam.pitch = p.camPitch;
	if (p.camDist !== undefined) cam.dist = p.camDist;
	if (p.camX !== undefined) cam.tx = p.camX;
	if (p.camZ !== undefined) cam.tz = p.camZ;
	if (p.drift !== undefined) cam.drift = p.drift;
	const sfx = new Sfx(!p.mute && p.mode === "realtime");

	// --- player intent ---
	let chosen = -1;
	let selected = p.select ?? -1;
	const towerOk = (t: number): boolean =>
		t >= 0 && (host.curr[OFF_TOWERS + t * T_STRIDE] as number) >= 0;
	const phase = (): number => host.curr[H.PHASE] as number;
	const start = (): void => {
		const ph = phase();
		if (ph === PHASE.TITLE) host.command(CMD.START);
		else if (ph === PHASE.WON || ph === PHASE.LOST) host.command(CMD.RESTART);
	};
	const hud = p.hud
		? new Hud(
				hudRoot,
				{
					selectType: (t) => {
						chosen = chosen === t ? -1 : t;
						selected = -1;
						hud?.setChosen(chosen);
					},
					upgrade: () => {
						if (towerOk(selected)) host.command(CMD.UPGRADE, selected);
					},
					sell: () => {
						if (towerOk(selected)) {
							host.command(CMD.SELL, selected);
							selected = -1;
						}
					},
					callWave: () => host.command(CMD.CALL_WAVE),
					start,
				},
				p.stress,
			)
		: null;
	// perf=0: hide the perf panel. Fixed-mode captures hold each frame for a screenshot, so
	// its fps reading there is meaningless.
	if (!p.perf)
		hudRoot
			.querySelector<HTMLElement>(".panel.perf")
			?.style.setProperty("display", "none");
	if (!p.demo) {
		window.addEventListener("keydown", (e) => {
			const ph = phase();
			if (e.code === "Enter" || e.code === "Space") {
				// A held key must not start the run and then call wave 1 on its repeats.
				if (e.repeat) {
					e.preventDefault();
					return;
				}
				if (ph === PHASE.BUILD) host.command(CMD.CALL_WAVE);
				else start();
				e.preventDefault();
			} else if (e.code >= "Digit1" && e.code <= "Digit4") {
				const t = Number(e.code.slice(5)) - 1;
				chosen = chosen === t ? -1 : t;
				selected = -1;
				hud?.setChosen(chosen);
			} else if (e.code === "KeyU" && towerOk(selected))
				host.command(CMD.UPGRADE, selected);
			else if (e.code === "KeyX" && towerOk(selected)) {
				host.command(CMD.SELL, selected);
				selected = -1;
			} else if (e.code === "Escape") {
				chosen = -1;
				selected = -1;
				hud?.setChosen(-1);
			}
		});
	}
	let ndcX = 0;
	let ndcY = 0;
	let hovering = false;
	let downX = 0;
	let downY = 0;
	canvas.addEventListener("pointermove", (e) => {
		const r = canvas.getBoundingClientRect();
		ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
		ndcY = -((e.clientY - r.top) / r.height) * 2 + 1;
		hovering = true;
	});
	canvas.addEventListener("pointerleave", () => {
		hovering = false;
	});
	canvas.addEventListener("pointerdown", (e) => {
		downX = e.clientX;
		downY = e.clientY;
	});
	canvas.addEventListener("pointerup", (e) => {
		if (e.button !== 0 || p.demo) return;
		if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) return;
		const ph = phase();
		if (ph !== PHASE.BUILD && ph !== PHASE.WAVE) return;
		const pk = host.lastPick;
		if (pk.kind === PICK.TOWER) {
			selected = pk.tower;
			chosen = -1;
			hud?.setChosen(-1);
		} else if (chosen >= 0 && pk.kind === PICK.CELL) {
			if (pk.buildable) host.command(CMD.PLACE, chosen, pk.cell);
			else hud?.flash("Can't build there");
		} else selected = -1;
	});

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
	cam.update(0);
	updateCsmFrustums(renderer.csm);

	// --- snapshot consumers ---
	host.onSnapshot = (s) => {
		fx.handle(s);
		hud?.handle(s);
		sfx.handle(s);
		const n = s[H.EVENTS] as number;
		for (let e = 0; e < n; e++) {
			const o = OFF_EVENTS + e * E_STRIDE;
			const t = s[o] as number;
			if (t === EV.LEAK) world.hit(s[o + 1] as number);
			else if (t === EV.RESET) selected = -1;
		}
	};

	// --- hook ---
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
	const perf: PerfInfo = {
		cpuMs: 0,
		frameMs: 16.7,
		fps: 60,
		simMs: 0,
		host: host.kind,
		build,
		drawCalls: 0,
		drawn: 0,
	};
	const hook: Partial<Pebble3DHook> & { game?: Record<string, () => unknown> } =
		{
			ready: false,
			done: false,
			frame: 0,
			tick: 0,
			adapterInfo: await adapterInfoOf(renderer),
			setCamera: (name: string) => {
				if (name === "controller" || name === "game") {
					cam.enabled = true;
					return;
				}
				cam.enabled = false;
				renderer.setCameraPreset(name);
			},
			stateHash: () => host.hash(),
			stats: () => {
				Object.assign(stats, renderer.stats());
				stats.tick = host.curr[H.TICK] as number;
				stats.physicsMs = host.curr[H.SIM_MS] as number;
				stats.errors = renderer.errors();
				return stats;
			},
			game: {
				phase: () => PHASE_NAMES[phase()] ?? "?",
				wave: () => host.curr[H.WAVE],
				gold: () => host.curr[H.GOLD],
				core: () => host.curr[H.CORE],
				alive: () => host.curr[H.ALIVE],
				kills: () => host.curr[H.KILLS],
				leaks: () => host.curr[H.LEAKS],
				towers: () => host.curr[H.TOWERS],
				score: () => host.curr[H.SCORE],
				spawned: () => host.curr[H.SPAWNED],
				simMs: () => Math.round((host.curr[H.SIM_MS] as number) * 1000) / 1000,
				frameMs: () => Math.round(perf.frameMs * 100) / 100,
				cpuMs: () => Math.round(perf.cpuMs * 100) / 100,
				prof: () => Array.from(prof, (v) => Math.round(v * 100) / 100),
				host: () => host.kind,
				build: () => build,
				drawn: () => swarm.drawn,
				bot: () => host.botState(),
				pick: () => [
					host.lastPick.kind,
					host.lastPick.cell,
					host.lastPick.buildable,
				],
				selected: () => selected,
				level: (t = selected) =>
					t >= 0 ? host.curr[OFF_TOWERS + t * T_STRIDE + 1] : 0,
			},
		};
	window.__pebble3d = hook;
	if (p.cam) hook.setCamera?.(p.cam);

	// --- loop ---
	const origin = new Vector3();
	const dir = new Vector3();
	let ghostType = -1;
	let ghostX = 0;
	let ghostZ = 0;
	if (p.ghost) {
		const m = /^(\d)@(-?[\d.]+),(-?[\d.]+)$/.exec(p.ghost);
		if (m) {
			ghostType = Number(m[1]);
			ghostX = Number(m[2]);
			ghostZ = Number(m[3]);
		}
	}
	let last = -1;
	let frame = 0;
	let hudDt = 0;
	/** EMA ms: sim host, camera/pick, swarm view, towers/fx/hud, render submit. */
	const prof = new Float64Array(5);
	const step = (): void => {
		requestAnimationFrame(step);
		const now = performance.now();
		const rdt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
		last = now;
		if (rdt > 0) {
			perf.frameMs += (rdt * 1000 - perf.frameMs) * 0.05;
			perf.fps = 1000 / perf.frameMs;
		}
		host.frame(rdt);
		let pt = performance.now();
		prof[0] = (prof[0] as number) * 0.95 + (pt - now) * 0.05;
		const fdt = p.mode === "fixed" ? 1 / 60 : rdt;
		const s = host.curr;
		const ph = s[H.PHASE] as number;
		cam.shake = Math.max(cam.shake - fdt * 2, fx.shake);
		if (cam.enabled) cam.update(fdt);
		// Hover picking: an engine raycast from the camera through the cursor.
		const playing = ph === PHASE.BUILD || ph === PHASE.WAVE;
		if (hovering && playing && !p.demo) {
			cam.ray(ndcX, ndcY, origin, dir);
			host.pick(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z);
		}
		const pk = host.lastPick;
		if (ghostType >= 0) towers.setGhost(ghostType, ghostX, ghostZ, true);
		else if (
			chosen >= 0 &&
			hovering &&
			playing &&
			pk.kind !== PICK.NONE &&
			pk.kind !== PICK.TOWER
		) {
			const c = pk.cell;
			const cx = c >= 0 ? -40 + 2 * (c % 40) + 1 : pk.x;
			const cz = c >= 0 ? -40 + 2 * Math.floor(c / 40) + 1 : pk.z;
			towers.setGhost(
				chosen,
				cx,
				cz,
				pk.kind === PICK.CELL &&
					pk.buildable &&
					(s[H.GOLD] as number) >= (TOWERS[chosen]?.cost ?? 0),
			);
		} else towers.setGhost(-1, 0, 0, false);
		world.showGrid((chosen >= 0 && playing) || ghostType >= 0);
		if (selected >= MAX_TOWERS) selected = -1;
		const alpha = host.alpha();
		let pt2 = performance.now();
		prof[1] = (prof[1] as number) * 0.95 + (pt2 - pt) * 0.05;
		swarm.update(fdt, host.prev, s, alpha);
		pt = performance.now();
		prof[2] = (prof[2] as number) * 0.95 + (pt - pt2) * 0.05;
		towers.update(fdt, s, selected);
		fx.update(fdt, s, host.prev, alpha);
		world.update(fdt, Math.max(0, s[H.CORE] as number) / 200);
		perf.drawn = swarm.drawn;
		hudDt += fdt;
		if (hud && (frame % 3 === 0 || p.mode === "fixed")) {
			perf.drawCalls = renderer.stats().drawCalls;
			hud.update(hudDt, s, selected, perf);
			hudDt = 0;
		}
		if (frame % 15 === 0) sfx.frame(s[H.ALIVE] as number);
		pt2 = performance.now();
		prof[3] = (prof[3] as number) * 0.95 + (pt2 - pt) * 0.05;
		renderer.render(rdt);
		prof[4] = (prof[4] as number) * 0.95 + (performance.now() - pt2) * 0.05;
		perf.cpuMs += (performance.now() - now - perf.cpuMs) * 0.05;
		frame++;
		hook.frame = frame;
		hook.tick = s[H.TICK] as number;
		hook.ready = true;
		if (p.mode === "fixed" && host.stopped()) hook.done = true;
	};
	host.go();
	requestAnimationFrame(step);
}

/** Puts a fatal error on screen and on `__pebble3d.error` (boot failures and later worker errors). */
function showFatal(msg: string): void {
	if (document.getElementById("fatal-error")) return;
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

main().catch((e: unknown) => {
	showFatal(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
});
