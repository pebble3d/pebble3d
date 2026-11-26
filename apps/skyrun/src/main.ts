import { createRenderer, updateCsmFrustums } from "@pebble3d/renderer";
import { expandScene } from "@pebble3d/sdk/expand";
import type { Pebble3DHook } from "@pebble3d/sdk/game";
import { FixedStepLoop } from "@pebble3d/sdk/loop";
import { parseScene, type SceneInput } from "@pebble3d/sdk/schema";
import { loadSim } from "@pebble3d/sdk/sim";
import type { GameStats } from "@pebble3d/sdk/types";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { HemisphereLight, Vector3 } from "three/webgpu";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import dawnJson from "../courses/dawnsteps.json";
import dawnPar from "../courses/dawnsteps.par.json";
import galeJson from "../courses/gale-spires.json";
import galePar from "../courses/gale-spires.par.json";
import sceneJson from "../scenes/sky.json";
import { adapterInfoOf } from "./adapter.ts";
import { Sfx } from "./game/audio/sfx.ts";
import { type BotStyle, DemoBot } from "./game/bot.ts";
import { type Course, parseCourse } from "./game/course.ts";
import {
	checkRecord,
	Ghost,
	type GhostRecord,
	loadBest,
	makeRecord,
	saveBest,
} from "./game/ghost.ts";
import { emptyInput, InputLog } from "./game/input.ts";
import { LiveInput } from "./game/live-input.ts";
import { simHost } from "./game/physics.ts";
import { DT, EV, PHASE, SkyrunSim } from "./game/sim.ts";
import { fmtTime, Hud, medalFor } from "./game/ui/hud.ts";
import { CameraRig } from "./game/view/camera-rig.ts";
import { Effects } from "./game/view/effects.ts";
import {
	RUNNERS,
	type RunnerKind,
	RunnerView,
} from "./game/view/runner-view.ts";
import { applySky, buildCloudSea } from "./game/view/sky.ts";
import { WorldView } from "./game/view/world-view.ts";

/**
 * Skyrun URL params:
 *   demo=1             the autoplayer runs the courses (title -> run -> results -> next)
 *   course=<id>        dawnsteps | gale-spires (default: the first)
 *   runner=human|robot
 *   bot=fast|steady    demo bot style (default steady: it races the par ghost)
 *   title=1            stay on the title screen (captures)
 *   ghost=0            no ghost
 *   mode=fixed&ticks=n one tick per frame, stop at n (pnpm shot); backend=webgl; mute=1; hud=0
 *   cam=hero           the scene's hero preset instead of the game camera
 *   camYaw/camPitch/camDist  chase camera overrides
 */
const COURSES: Course[] = [parseCourse(dawnJson), parseCourse(galeJson)];
const PARS: unknown[] = [dawnPar, galePar];

const TITLE_DEMO_TICKS = 150;
const FINISH_HOLD = 150;
const RESULTS_DEMO_TICKS = 300;

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app / #hud missing");
	const q = new URLSearchParams(location.search);
	const num = (k: string): number | undefined => {
		const v = q.get(k);
		if (v === null) return undefined;
		const n = Number(v);
		if (!Number.isFinite(n)) throw new Error(`bad ${k} param "${v}"`);
		return n;
	};
	const mode = q.get("mode") === "fixed" ? "fixed" : "realtime";
	const stopAtTick = num("ticks");
	const demo = q.get("demo") === "1";
	const stayTitle = q.get("title") === "1";
	const useGhost = q.get("ghost") !== "0";
	const botStyle: BotStyle = q.get("bot") === "fast" ? "fast" : "steady";
	let runner: RunnerKind = q.get("runner") === "robot" ? "robot" : "human";
	let sel = Math.max(
		0,
		COURSES.findIndex((c) => c.id === q.get("course")),
	);
	// Shared assets stay root-absolute ("/assets/...", "/basis/"): the renderer's asset base
	// (VITE_PEBBLE3D_ASSET_BASE on the site, else Vite's BASE_URL) resolves them.
	const scene = parseScene(sceneJson as unknown as SceneInput);
	const x = expandScene(scene);
	const [handle, renderer] = await Promise.all([
		loadSim("deterministic", detWasmUrl, { seed: 1 }),
		createRenderer(canvas, x.settings, {
			backend: q.get("backend") === "webgl" ? "webgl" : "webgpu",
		}),
	]);
	const host = simHost(handle);
	handle.world.free();
	const three = renderer.three;
	three.camera.far = 900;
	three.camera.updateProjectionMatrix();
	applySky(three.scene, 70, 340);
	three.scene.environmentIntensity = 0.6;
	three.scene.add(new HemisphereLight(0xc4d0ff, 0xe8a48a, 0.55));
	buildCloudSea(three.scene, -22);

	const gltfs = new Map<RunnerKind, GLTF>();
	const loadRunner = async (k: RunnerKind): Promise<GLTF> => {
		let g = gltfs.get(k);
		if (!g) {
			g = await renderer.loadGltf(RUNNERS[k].url);
			gltfs.set(k, g);
		}
		return g;
	};
	await Promise.all([loadRunner("human"), loadRunner("robot")]);

	const hud = new Hud(hudRoot);
	if (q.get("hud") === "0") hudRoot.style.display = "none";
	const fx = new Effects(three.scene);
	const sfx = new Sfx(q.get("mute") !== "1" && mode === "realtime");
	const live = demo ? null : new LiveInput();
	const cam = new CameraRig(three.camera, demo ? null : canvas);
	const camYaw = num("camYaw");
	const camPitch = num("camPitch");
	const camDist = num("camDist");
	if (camDist !== undefined) cam.tpc.distance = camDist;

	// --- per-course and per-run state ---
	let course = COURSES[sel] as Course;
	let world: WorldView | null = null;
	let sim: SkyrunSim | null = null;
	let ghost: Ghost | null = null;
	let bot: DemoBot | null = null;
	let runnerView: RunnerView | null = null;
	let ghostView: RunnerView | null = null;
	let screen: "title" | "run" | "results" = "title";
	let screenTicks = 0;
	let doneTicks = 0;
	let lastRun: { time: number; newBest: boolean } = { time: 0, newBest: false };
	const log = new InputLog();
	const input = emptyInput();
	const idle = emptyInput();
	// Sized for the longest course's checkpoints.
	const maxCps = Math.max(...COURSES.map((c) => c.checkpoints.length));
	const splitsLive = new Int32Array(maxCps).fill(-1);
	const splitsGhost = new Int32Array(maxCps).fill(-1);
	const feet = new Vector3();

	const bests = (): (number | null)[] =>
		COURSES.map((c) => {
			const b = loadBest(c);
			return b ? b.ticks * DT : null;
		});

	const parFor = (c: Course): GhostRecord | null =>
		checkRecord(PARS[COURSES.indexOf(c)], c);

	function setRunnerView(): void {
		runnerView?.dispose();
		runnerView = new RunnerView(
			three.scene,
			gltfs.get(runner) as GLTF,
			runner,
			false,
		);
	}

	/** Builds the course view and a fresh sim (title preview or a real run). */
	function newSim(withGhost: boolean): void {
		sim?.free();
		ghost?.free();
		ghost = null;
		ghostView?.dispose();
		ghostView = null;
		sim = new SkyrunSim(host, course);
		if (!world || world.course !== course) {
			world?.dispose();
			world = new WorldView(course, sim);
			three.scene.add(world.group);
			cam.setCourse(course);
		}
		cam.attach(sim.world, sim.views);
		if (!runnerView) setRunnerView();
		runnerView?.face((course.start.yaw * Math.PI) / 180);
		if (withGhost && useGhost) {
			// Captures (fixed mode, demo) always race the shipped par ghost; players their best.
			const rec =
				mode === "fixed" || demo
					? parFor(course)
					: (loadBest(course) ?? parFor(course));
			if (rec) {
				ghost = new Ghost(host, course, rec);
				const gk: RunnerKind = rec.runner;
				ghostView = new RunnerView(
					three.scene,
					gltfs.get(gk) as GLTF,
					gk,
					true,
				);
				ghostView.face((course.start.yaw * Math.PI) / 180);
			}
		}
	}

	function toTitle(): void {
		screen = "title";
		screenTicks = 0;
		bot = null;
		newSim(false);
		cam.mode = "title";
		hud.showTitle({ courses: COURSES, sel, runner, bests: bests() });
	}

	function startRun(): void {
		screen = "run";
		screenTicks = 0;
		doneTicks = 0;
		course = COURSES[sel] as Course;
		newSim(true);
		const s = sim as SkyrunSim;
		bot = demo ? new DemoBot(s, botStyle) : null;
		log.clear();
		splitsLive.fill(-1);
		splitsGhost.fill(-1);
		cam.mode = "chase";
		cam.autoFollow = true;
		cam.snapBehind(camYaw ?? (course.start.yaw * Math.PI) / 180);
		if (camPitch !== undefined) cam.tpc.pitch = camPitch;
		hud.startRun(
			course,
			ghost
				? ghost.record.label === "par"
					? "Ghost · course spirit"
					: `Ghost · best ${fmtTime(ghost.record.ticks * DT)}`
				: null,
		);
	}

	function showResults(): void {
		const s = sim as SkyrunSim;
		screen = "results";
		screenTicks = 0;
		cam.mode = "orbit";
		const best = loadBest(course);
		hud.showResults({
			course,
			time: lastRun.time,
			medal: medalFor(course, lastRun.time),
			shards: s.shards,
			totalShards: course.shards.length,
			falls: s.falls,
			best: best ? best.ticks * DT : null,
			newBest: lastRun.newBest,
			hasNext: COURSES.length > 1,
		});
	}

	function action(a: string, arg?: number): void {
		if (screen === "title") {
			if (a === "select" && arg !== undefined) {
				if (arg === sel) {
					startRun();
					return;
				}
				sel = arg;
				course = COURSES[sel] as Course;
				toTitle();
			} else if (a === "runner" && arg !== undefined) {
				runner = arg === 1 ? "robot" : "human";
				setRunnerView();
				toTitle();
			} else if (a === "start") startRun();
			return;
		}
		if (a === "retry") startRun();
		else if (a === "next") {
			sel = (sel + 1) % COURSES.length;
			startRun();
		} else if (a === "menu") toTitle();
	}
	hud.onAction = action;
	if (live)
		live.onKey = (code) => {
			if (screen === "title") {
				if (code === "ArrowRight" || code === "ArrowLeft") {
					const n = COURSES.length;
					sel = (sel + (code === "ArrowRight" ? 1 : n - 1)) % n;
					course = COURSES[sel] as Course;
					toTitle();
				} else if (code === "Tab") action("runner", runner === "human" ? 1 : 0);
				else if (code === "Enter" || code === "Space") action("start");
			} else if (screen === "results") {
				if (code === "Enter" || code === "KeyR") action("retry");
				else if (code === "KeyN") action("next");
				else if (code === "Escape") action("menu");
			} else if (screen === "run") {
				if (code === "KeyR") action("retry");
				else if (code === "Escape") action("menu");
			}
		};
	window.addEventListener("keydown", (e) => {
		if (e.code === "Tab") e.preventDefault();
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
	updateCsmFrustums(renderer.csm);
	new ResizeObserver(() => {
		applySize();
		updateCsmFrustums(renderer.csm);
	}).observe(canvas);

	// --- automation hook ---
	const r0 = renderer.stats();
	const stats: GameStats = {
		...r0,
		physicsMs: 0,
		activeBodies: 0,
		sleepingBodies: 0,
		build: "deterministic",
		tick: 0,
		errors: renderer.errors(),
	};
	let appTick = 0;
	let camPreset = false;
	const hook: Partial<Pebble3DHook> & { game?: Record<string, () => unknown> } =
		{
			ready: false,
			done: false,
			frame: 0,
			tick: 0,
			adapterInfo: await adapterInfoOf(renderer),
			setCamera: (name: string) => {
				if (name === "controller" || name === "game") {
					camPreset = false;
					return;
				}
				camPreset = true;
				renderer.setCameraPreset(name);
			},
			stateHash: () => sim?.world.stateHash() ?? "",
			stats: () => {
				Object.assign(stats, renderer.stats());
				stats.tick = appTick;
				stats.errors = renderer.errors();
				return stats;
			},
			game: {
				screen: () => screen,
				course: () => course.id,
				runner: () => runner,
				phase: () => sim?.phase ?? -1,
				time: () => Math.round((sim?.time ?? 0) * 100) / 100,
				checkpoints: () => sim?.nextCheckpoint ?? 0,
				shards: () => sim?.shards ?? 0,
				falls: () => sim?.falls ?? 0,
				jumps: () => sim?.jumps ?? 0,
				botStep: () => bot?.stepIndex ?? -1,
				ghost: () => (ghost ? ghost.record.label : "none"),
				ghostOk: () => ghost?.ok ?? null,
				hash: () => sim?.hash() ?? "",
				inputs: () => log.length,
				player: () =>
					sim
						? [sim.px, sim.py, sim.pz].map((v) => Math.round(v * 100) / 100)
						: null,
				model: () => feet.toArray().map((v) => Math.round(v * 100) / 100),
				camera: () =>
					three.camera.position.toArray().map((v) => Math.round(v * 100) / 100),
				arm: () => Math.round(cam.tpc.armLength * 100) / 100,
			},
		};
	window.__pebble3d = hook;
	const camParam = q.get("cam");

	toTitle();
	if (camParam) hook.setCamera?.(camParam);

	// --- loop ---
	const loop = new FixedStepLoop(
		stopAtTick !== undefined
			? { mode, stopAtTick, maxTicksPerFrame: 3 }
			: { mode, maxTicksPerFrame: 3 },
	);
	let last = -1;
	let frame = 0;

	function tick(): void {
		appTick++;
		screenTicks++;
		const s = sim as SkyrunSim;
		if (screen === "title") {
			s.step(idle);
			if (demo && !stayTitle && screenTicks >= TITLE_DEMO_TICKS) startRun();
			return;
		}
		if (screen === "run") {
			if (bot) bot.next(input);
			else if (live) live.sample(input, cam.yaw);
			log.push(input);
			s.step(input);
			if (ghost) {
				ghost.step();
				const ge = ghost.sim.events;
				for (let e = 0; e < ge.n; e++) {
					if (ge.type[e] !== EV.CHECKPOINT) continue;
					const i = ge.a[e] as number;
					splitsGhost[i] = ghost.sim.runTicks;
					if ((splitsLive[i] as number) >= 0)
						hud.delta(((splitsLive[i] as number) - ghost.sim.runTicks) * DT);
				}
			}
			const ev = s.events;
			for (let e = 0; e < ev.n; e++) {
				const t = ev.type[e];
				if (t === EV.BEEP) hud.countdown(ev.a[e] as number);
				else if (t === EV.GO) hud.countdown(0);
				else if (t === EV.CHECKPOINT) {
					const i = ev.a[e] as number;
					splitsLive[i] = s.runTicks;
					hud.toast(
						`Checkpoint ${i + 1}/${course.checkpoints.length} · <b>${fmtTime(s.time)}</b>`,
					);
					if ((splitsGhost[i] as number) >= 0)
						hud.delta((s.runTicks - (splitsGhost[i] as number)) * DT);
				} else if (t === EV.SHARD) {
					if (s.shards === course.shards.length) hud.toast("All sky shards!");
				} else if (t === EV.FALL) {
					hud.toast("Into the clouds…");
				} else if (t === EV.RESPAWN) {
					hud.flash();
					cam.snapBehind(((s.respawnYaw ?? 0) * Math.PI) / 180);
					runnerView?.face(((s.respawnYaw ?? 0) * Math.PI) / 180);
				} else if (t === EV.FINISH) {
					const time = s.time;
					let newBest = false;
					if (!demo && mode === "realtime") {
						const prev = loadBest(course);
						if (!prev || s.runTicks < prev.ticks) {
							saveBest(
								makeRecord(course, s.runTicks, log, runner, "best", s.falls),
							);
							newBest = true;
						}
					}
					lastRun = { time, newBest };
					if (ghost) {
						const g = ghost.record.ticks;
						hud.delta((s.runTicks - g) * DT);
					}
					hud.toast(`Finish · <b>${fmtTime(time)}</b>`);
				}
			}
			fx.handle(ev);
			sfx.handle(ev);
			if (s.phase === PHASE.DONE && ++doneTicks >= FINISH_HOLD) showResults();
			return;
		}
		// results
		s.step(idle);
		ghost?.step();
		if (demo && screenTicks >= RESULTS_DEMO_TICKS) {
			sel = (sel + 1) % COURSES.length;
			startRun();
		}
	}

	const frameStep = (now: number): void => {
		requestAnimationFrame(frameStep);
		const rdt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
		last = now;
		const adv = loop.advance(rdt, appTick);
		for (let i = 0; i < adv.ticks; i++) tick();
		const fdt = mode === "fixed" ? adv.ticks * DT : rdt;
		const s = sim as SkyrunSim;
		s.views.refresh();
		world?.update(s, s.views.prev, s.views.curr, adv.alpha, fdt);
		runnerView?.update(s, adv.alpha, fdt);
		if (ghost && ghostView) {
			ghost.sim.views.refresh();
			ghostView.update(ghost.sim, adv.alpha, fdt);
			// Fade the ghost out once it has finished or when it overlaps the runner.
			ghostView.root.visible = ghost.ok && ghost.sim.phase !== PHASE.DONE;
			const gd = runnerView
				? ghostView.root.position.distanceTo(runnerView.root.position)
				: 9;
			const k = Math.min(1, Math.max(0, (gd - 0.6) / 1.8));
			ghostView.fade.value = k * k * (3 - 2 * k) * 0.92 + 0.08;
		}
		if (runnerView) feet.copy(runnerView.root.position);
		if (live) live.idleLook += fdt;
		const steering = live !== null && (live.idleLook < 1.2 || live.turn !== 0);
		if (!camPreset)
			cam.update(fdt, feet, s.vx, s.vz, live?.turn ?? 0, steering);
		fx.update(fdt);
		hud.animate(fdt);
		if (screen === "run")
			hud.frame(s.time, s.shards, course.shards.length, s.nextCheckpoint);
		sfx.frame(Math.hypot(s.vx, s.vz), !s.grounded && s.vy < -8);
		renderer.render(rdt);
		frame++;
		hook.frame = frame;
		hook.tick = appTick;
		hook.ready = true;
		if (mode === "fixed" && stopAtTick !== undefined && appTick >= stopAtTick)
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
});
