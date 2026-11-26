import {
	type CharacterFrame,
	type CharacterView,
	createRenderer,
	type EngineRenderer,
	ThirdPersonController,
} from "@pebble3d/renderer";
import { Box3, Vector3 } from "three/webgpu";
import { expandScene } from "./expand.ts";
import { cameraRelativeInput, type MoveKeys } from "./input.ts";
import { FixedStepLoop } from "./loop.ts";
import { parseScene, type SceneInput } from "./schema.ts";
import { loadSim, type SimHandle, StateViews } from "./sim.ts";
import type { ColliderJson, GameStats, SimEntry } from "./types.ts";

export interface CreateGameOptions {
	canvas: HTMLCanvasElement;
	scene: SceneInput;
	mode?: "realtime" | "fixed";
	/** Fixed mode: the sim stops advancing at this tick. */
	stopAtTick?: number;
	backend?: "webgpu" | "webgl";
	/** Debug: draw only the splat with no meshes or post (playground `?debug=splatOnly`). */
	splatOnly?: boolean;
	/** URLs of the two `_bg.wasm` builds; the scene's `sim.build` picks one. */
	wasmUrls: { deterministic: string; fast: string };
	/**
	 * Prefix for the scene's root-absolute asset URLs (`/assets/...`), passed to
	 * `createRenderer`. Default: `VITE_PEBBLE3D_ASSET_BASE`, else Vite's `BASE_URL`, else `"/"`.
	 */
	assetBase?: string;
	/**
	 * Opt-in automatic WebGL fallback when `backend` is `"webgpu"` and WebGPU is missing
	 * (see `createRenderer`). Default: on only with `VITE_PEBBLE3D_WEBGL_FALLBACK=1` or
	 * `?webglFallback=1`.
	 */
	webglFallback?: boolean;
}

/** The player's held input. Keyboard listeners write it; scripts may set it directly. */
export interface PlayerInput {
	keys: MoveKeys;
	jump: boolean;
	sprint: boolean;
}

/** The scene's first character, driven by `input` every frame. */
export interface PlayerRig {
	simId: number;
	view: CharacterView;
	/** Present when the scene's `camera.controller` is `thirdPerson`. */
	camera: ThirdPersonController | null;
	input: PlayerInput;
}

export interface Game {
	start(): void;
	stop(): void;
	sim: SimHandle;
	views: StateViews;
	renderer: EngineRenderer;
	/** sceneId -> sim entity id. */
	ids: Map<string, number>;
	/** Returns the same mutated object every call. */
	stats(): GameStats;
	/**
	 * Runs every frame after `renderer.sync` and before `renderer.render`. `dt` is the frame
	 * time in seconds; in fixed mode it is the sim time advanced this frame (`ticks / 60`, so
	 * `1/60`, or 0 once stopped), which keeps fixed-mode shots reproducible.
	 */
	onFrame(cb: (dt: number) => void): void;
	/** The scene's first character, or null when it has none. */
	player: PlayerRig | null;
	/**
	 * A camera preset name, or "controller" for the scene's controller camera. A preset
	 * suspends the third-person camera (the player still moves relative to its yaw).
	 */
	setCamera(name: string): void;
}

export interface AdapterInfo {
	backend: "webgpu" | "webgl";
	vendor: string;
	architecture: string;
	device: string;
	description: string;
}

/** Test/automation hook installed on `window.__pebble3d` (read by the shot CLI). */
export interface Pebble3DHook {
	/** True once the first frame has rendered. */
	ready: boolean;
	/** Fixed mode: true once the frame at `stopAtTick` has rendered. */
	done: boolean;
	frame: number;
	tick: number;
	stats(): GameStats;
	adapterInfo: AdapterInfo;
	setCamera(name: string): void;
	stateHash(): string;
	/** The player's pose, animation state and camera (null without a character). Allocates. */
	player(): PlayerProbe | null;
	/** Current position of a scene entity's sim body, or null. Allocates. */
	position(sceneId: string): [number, number, number] | null;
}

export interface PlayerProbe {
	/** Capsule centre, from the sim. */
	position: [number, number, number];
	grounded: boolean;
	velocity: [number, number, number];
	anim: string;
	/** Lowest point of the rendered (skinned) model, world Y. */
	modelMinY: number;
	camera: [number, number, number];
	/** Third-person arm length, or null when the scene has no third-person camera. */
	arm: number | null;
}

declare global {
	interface Window {
		__pebble3d?: Partial<Pebble3DHook> & { error?: string };
	}
}

/** `bodyCounts()` allocates, so it is sampled on this frame interval only. */
const BODY_COUNT_INTERVAL = 30;
/** Cap on the device pixel ratio (laptop GPU budget). */
const MAX_DPR = 2;
/** Sim tick, seconds. */
const TICK = 1 / 60;
/** The third-person camera looks at this height above the character's capsule centre. */
const PIVOT_HEIGHT = 0.8;
/** wasm `raycast` filter: static bodies only (moving props never pop the camera). */
const RAY_STATIC_ONLY = 1;

const KEY_BINDINGS: Record<string, "f" | "b" | "l" | "r" | "jump" | "sprint"> =
	{
		KeyW: "f",
		ArrowUp: "f",
		KeyS: "b",
		ArrowDown: "b",
		KeyA: "l",
		ArrowLeft: "l",
		KeyD: "r",
		ArrowRight: "r",
		Space: "jump",
		ShiftLeft: "sprint",
		ShiftRight: "sprint",
	};

/**
 * Builds a running game from a scene: parse, expand, load the sim build, spawn, build the
 * renderer and entity visuals, then drive the fixed-step loop from requestAnimationFrame.
 * Call `start()` to begin.
 */
export async function createGame(opts: CreateGameOptions): Promise<Game> {
	const scene = parseScene(opts.scene);
	const x = expandScene(scene);
	const build = scene.sim.build;
	const mode = opts.mode ?? "realtime";

	const [simR, rendR] = await Promise.allSettled([
		loadSim(build, opts.wasmUrls[build], {
			seed: scene.sim.seed,
			gravity: scene.sim.gravity,
		}),
		createRenderer(opts.canvas, x.settings, {
			backend: opts.backend ?? "webgpu",
			splatOnly: opts.splatOnly === true,
			...(opts.assetBase !== undefined ? { assetBase: opts.assetBase } : {}),
			...(opts.webglFallback !== undefined
				? { webglFallback: opts.webglFallback }
				: {}),
		}),
	]);
	if (rendR.status === "rejected") {
		if (simR.status === "fulfilled") simR.value.world.free();
		throw rendR.reason;
	}
	const renderer = rendR.value;
	if (simR.status === "rejected") {
		renderer.dispose();
		throw simR.reason;
	}
	const sim = simR.value;
	const world = sim.world;

	// --- spawn: everything but pending hulls first, then hulls once their points exist ---
	const pending = new Set(x.pendingHulls);
	const ids = sim.spawnScene(x.sim.filter((e) => !pending.has(e.sceneId)));
	const hullEntries: SimEntry[] = [];
	for (const sceneId of x.pendingHulls) {
		const entry = x.sim.find((e) => e.sceneId === sceneId);
		const re = x.render.find((r) => r.sceneId === sceneId);
		const collider = entry ? hullCollider(entry) : undefined;
		if (!entry || !collider || re?.mesh?.kind !== "gltf") continue;
		try {
			const pts = await renderer.hullPoints(re.mesh.url, re.scale);
			collider.points = Array.from(pts);
			hullEntries.push(entry);
		} catch {
			renderer.reportError(`GltfLoadError: ${re.mesh.url}`);
		}
	}
	for (const [k, v] of sim.spawnScene(hullEntries)) ids.set(k, v);

	// expandScene never sets simId (ids only exist after spawning); this also places
	// __ground at ground.y through its sim slot.
	const templateKeyBySpawnerSimId = new Map<number, string>();
	for (const r of x.render) {
		if (r.templateKey !== undefined) {
			const spawnerId = ids.get(r.templateKey);
			if (spawnerId !== undefined)
				templateKeyBySpawnerSimId.set(spawnerId, r.templateKey);
			continue;
		}
		const simId = ids.get(r.sceneId);
		if (simId !== undefined) r.simId = simId;
	}
	await renderer.addEntities(x.render, (simId) => world.slotOf(simId));

	const views = new StateViews(sim);
	const loop = new FixedStepLoop(
		opts.stopAtTick !== undefined
			? { mode, stopAtTick: opts.stopAtTick }
			: { mode },
	);
	const stopAtTick = opts.stopAtTick ?? Number.POSITIVE_INFINITY;

	// --- resize / DPR ----------------------------------------------------------------
	const canvas = opts.canvas;
	const applySize = (): void => {
		renderer.resize(
			canvas.clientWidth,
			canvas.clientHeight,
			Math.min(window.devicePixelRatio || 1, MAX_DPR),
		);
	};
	applySize();
	new ResizeObserver(applySize).observe(canvas);
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

	// --- stats -----------------------------------------------------------------------
	const r0 = renderer.stats();
	const statsObj: GameStats = {
		...r0,
		physicsMs: 0,
		activeBodies: 0,
		sleepingBodies: 0,
		build,
		tick: world.tick(),
		errors: renderer.errors(),
	};
	const sampleBodies = (): void => {
		const c = world.bodyCounts();
		statsObj.activeBodies = c[0] ?? 0;
		statsObj.sleepingBodies = c[1] ?? 0;
	};
	sampleBodies();
	const stats = (): GameStats => {
		const r = renderer.stats();
		statsObj.fps = r.fps;
		statsObj.frameMs = r.frameMs;
		statsObj.drawCalls = r.drawCalls;
		statsObj.triangles = r.triangles;
		statsObj.splats = r.splats;
		statsObj.textureMB = r.textureMB;
		statsObj.backend = r.backend;
		statsObj.tick = world.tick();
		statsObj.errors = renderer.errors();
		return statsObj;
	};

	// --- automation hook ---------------------------------------------------------------
	const hook: Omit<Pebble3DHook, "player" | "position"> &
		Partial<Pick<Pebble3DHook, "player" | "position">> = {
		ready: false,
		done: false,
		frame: 0,
		tick: world.tick(),
		stats,
		adapterInfo: await adapterInfoOf(renderer),
		setCamera: (name) => renderer.setCameraPreset(name),
		stateHash: () => world.stateHash(),
	};
	window.__pebble3d = hook;

	// --- player: first character -> CharacterView, input, optional third-person camera ----
	const player = createPlayer();
	function createPlayer(): PlayerRig | null {
		const entry = x.sim.find((e) => e.desc.character !== undefined);
		const simId = entry ? ids.get(entry.sceneId) : undefined;
		if (!entry?.desc.character || simId === undefined) return null;
		const root = renderer.characterObject(simId);
		if (!root) return null;
		const re = x.render.find((r) => r.sceneId === entry.sceneId);
		const clipMap = re?.mesh?.kind === "gltf" ? (re.mesh.animations ?? {}) : {};
		const view = renderer.attachCharacter(simId, clipMap);
		let tpc: ThirdPersonController | null = null;
		if (x.settings.controller === "thirdPerson") {
			tpc = new ThirdPersonController(renderer.three.camera, (o, d, max) =>
				world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, RAY_STATIC_ONLY, 0)
					? (views.scratch[0] as number)
					: null,
			);
			// Start behind the character, looking where its initial rotation faces (+Z at yaw 0).
			const [qx, qy, qz, qw] = entry.desc.rotation ?? [0, 0, 0, 1];
			const fx = 2 * (qx * qz + qw * qy);
			const fz = 1 - 2 * (qx * qx + qy * qy);
			tpc.yaw = Math.atan2(fx, fz) + Math.PI;
			tpc.connect(canvas);
		}
		const rig: PlayerRig = {
			simId,
			view,
			camera: tpc,
			input: {
				keys: { f: false, b: false, l: false, r: false },
				jump: false,
				sprint: false,
			},
		};
		const setKey = (code: string, down: boolean): boolean => {
			const k = KEY_BINDINGS[code];
			if (k === undefined) return false;
			if (k === "jump" || k === "sprint") rig.input[k] = down;
			else rig.input.keys[k] = down;
			return true;
		};
		window.addEventListener("keydown", (e) => {
			if (setKey(e.code, true) && e.code === "Space") e.preventDefault();
		});
		window.addEventListener("keyup", (e) => setKey(e.code, false));
		window.addEventListener("blur", () => {
			for (const code in KEY_BINDINGS) setKey(code, false);
		});
		return rig;
	}

	// Preallocated per-frame state for the player callback.
	const frameState: CharacterFrame = {
		grounded: false,
		vx: 0,
		vz: 0,
		vy: 0,
		sprintSpeed:
			x.sim.find((e) => e.desc.character !== undefined)?.desc.character
				?.sprintSpeed ?? 7,
	};
	const pivot = new Vector3();
	const camDir = new Vector3();
	const moveDir = new Float32Array(2);
	const playerFrame = (dt: number): void => {
		if (!player) return;
		const id = player.simId;
		if (world.characterState(id)) {
			const sc = views.scratch;
			frameState.grounded = (sc[8] as number) > 0.5;
			frameState.vx = sc[9] as number;
			frameState.vz = sc[10] as number;
			frameState.vy = sc[11] as number;
			player.view.update(frameState, dt);
		}
		const tpc = player.camera;
		if (tpc?.enabled) {
			pivot.copy(player.view.root.position);
			pivot.y += PIVOT_HEIGHT;
			tpc.update(pivot, dt);
		}
		let yaw: number;
		if (tpc) yaw = tpc.yaw;
		else {
			renderer.three.camera.getWorldDirection(camDir);
			yaw = Math.atan2(-camDir.x, -camDir.z);
		}
		cameraRelativeInput(player.input.keys, yaw, moveDir);
		const inp = player.input;
		world.setCharacterInput(
			id,
			moveDir[0] as number,
			moveDir[1] as number,
			inp.jump,
			inp.sprint,
		);
	};
	const setCamera = (name: string): void => {
		const tpc = player?.camera ?? null;
		if (name === "controller") {
			if (tpc) tpc.enabled = true;
			return;
		}
		if (tpc) tpc.enabled = false;
		renderer.setCameraPreset(name);
	};
	hook.setCamera = setCamera;
	hook.position = (sceneId) => {
		const id = ids.get(sceneId);
		const t = id === undefined ? undefined : world.transformOf(id);
		return t ? [t[0] as number, t[1] as number, t[2] as number] : null;
	};
	hook.player = () => {
		if (!player) return null;
		const t = world.transformOf(player.simId);
		world.characterState(player.simId);
		const sc = views.scratch;
		const box = new Box3().setFromObject(player.view.root, true);
		const c = renderer.three.camera.position;
		return {
			position: [t?.[0] ?? 0, t?.[1] ?? 0, t?.[2] ?? 0],
			grounded: (sc[8] as number) > 0.5,
			velocity: [sc[9] as number, sc[11] as number, sc[10] as number],
			anim: player.view.animState,
			modelMinY: box.min.y,
			camera: [c.x, c.y, c.z],
			arm: player.camera?.armLength ?? null,
		};
	};

	// --- frame loop ------------------------------------------------------------------
	const callbacks: ((dt: number) => void)[] = [playerFrame];
	let raf = 0;
	let last = -1;
	let frame = 0;

	const step = (now: number): void => {
		raf = requestAnimationFrame(step);
		const dt = last < 0 ? 0 : (now - last) / 1000;
		last = now;

		const adv = loop.advance(dt, world.tick());
		if (adv.ticks > 0) {
			const t0 = performance.now();
			world.step(adv.ticks);
			statsObj.physicsMs = performance.now() - t0;
		} else {
			statsObj.physicsMs = 0;
		}
		if (world.spawnedPending() > 0) {
			const d = world.drainSpawned();
			for (let i = 0; i + 2 < d.length; i += 3) {
				const key = templateKeyBySpawnerSimId.get(d[i + 2] as number);
				if (key !== undefined) renderer.addSpawned(key, d[i + 1] as number);
			}
		}
		views.refresh();
		renderer.sync(views.prev, views.curr, adv.alpha);
		const cbDt = mode === "fixed" ? adv.ticks * TICK : dt;
		for (let i = 0; i < callbacks.length; i++)
			(callbacks[i] as (dt: number) => void)(cbDt);
		renderer.render(dt);

		frame++;
		if (frame % BODY_COUNT_INTERVAL === 0) sampleBodies();
		const tick = world.tick();
		hook.frame = frame;
		hook.tick = tick;
		hook.ready = true;
		if (mode === "fixed" && tick >= stopAtTick) hook.done = true;
	};

	return {
		start() {
			if (raf !== 0) return;
			last = -1;
			raf = requestAnimationFrame(step);
		},
		stop() {
			cancelAnimationFrame(raf);
			raf = 0;
		},
		sim,
		views,
		renderer,
		ids,
		stats,
		onFrame(cb) {
			callbacks.push(cb);
		},
		player,
		setCamera,
	};
}

function hullCollider(
	e: SimEntry,
): Extract<ColliderJson, { shape: "convexHull" }> | undefined {
	const c =
		e.desc.body?.collider ?? e.desc.spawner?.template.body?.collider ?? null;
	return c?.shape === "convexHull" ? c : undefined;
}

interface GpuAdapterInfoLike {
	vendor?: string;
	architecture?: string;
	device?: string;
	description?: string;
}

/** WebGPU: the device's adapter info. WebGL: the unmasked GL vendor/renderer strings. */
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
						requestAdapter(o?: object): Promise<{
							info?: GpuAdapterInfoLike;
						} | null>;
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
