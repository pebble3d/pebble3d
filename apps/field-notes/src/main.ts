import { createGame, type Game } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import { DemoBot } from "./game/bot.ts";
import { BTN, emptyInput, InputLog, quantizeInput } from "./game/input.ts";
import { LiveInput } from "./game/live-input.ts";
import { Presentation } from "./game/present.ts";
import {
	FieldSim,
	type OcclusionQuery,
	PHASE,
	PHASE_NAMES,
} from "./game/sim.ts";
import { SITES, type Site, siteById } from "./game/sites.ts";

/**
 * Field Notes URL params:
 *   site=yard|courtyard  survey site (splat capture), default yard
 *   demo=1               autoplayer (title, then every anomaly, then the results)
 *   seed=<n>             survey seed (anomaly placement; default random realtime, 23 fixed)
 *   mode=realtime|fixed  fixed = one tick per frame (captures); ticks=<n> stops there
 *   start=1              skip the title (straight into the survey)
 *   hud=0                hide the HUD; mute=1 no audio
 *   camDist, camPitch    exploration camera arm / pitch overrides (captures)
 *   shotCam=px,py,pz,tx,ty,tz,fov  fixed camera while surveying (staged capture stills)
 *   backend=webgpu|webgl
 */
interface Params {
	site: Site;
	demo: boolean;
	seed: number;
	mode: "realtime" | "fixed";
	stopAtTick: number | undefined;
	start: boolean;
	hud: boolean;
	mute: boolean;
	backend: "webgpu" | "webgl";
	camDist: number | undefined;
	camPitch: number | undefined;
	shotCam: number[] | undefined;
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
	return {
		site: siteById(q.get("site")),
		demo: q.get("demo") === "1",
		seed: num("seed") ?? (mode === "fixed" ? 23 : (Date.now() % 9000) + 100),
		mode,
		stopAtTick: num("ticks"),
		start: q.get("start") === "1",
		hud: q.get("hud") !== "0",
		mute: q.get("mute") === "1",
		backend,
		camDist: num("camDist"),
		camPitch: num("camPitch"),
		shotCam: q.get("shotCam")?.split(",").map(Number),
	};
}

/** The site's scene plus its world's bounds and obstacles as static physics. */
function buildScene(site: Site): SceneInput {
	const WORLD = site.world;
	const scene = structuredClone(site.scene) as Record<string, unknown> & {
		entities: Record<string, unknown>[];
	};
	const b = WORLD.bounds;
	scene.bounds = { min: b.min, max: b.max, height: 4 };
	WORLD.obstacles.forEach((o, i) => {
		scene.entities.push({
			id: `obstacle-${i}`,
			transform: { position: [o.x, o.h / 2, o.z] },
			body: {
				type: "static",
				collider: { shape: "box", halfExtents: [o.hx, o.h / 2, o.hz] },
			},
		});
	});
	const player = scene.entities.find((e) => e.id === "player") as {
		transform: { position: number[] };
	};
	player.transform.position = [WORLD.playerStart[0], 0.8, WORLD.playerStart[1]];
	return scene as unknown as SceneInput;
}

/** Static-only engine raycast: the planters, the field case, the bounds walls. */
function occlusionOf(game: Game): OcclusionQuery {
	const world = game.sim.world;
	return (ox, oy, oz, dx, dy, dz, max) =>
		world.raycast(ox, oy, oz, dx, dy, dz, max, 1, 0);
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const q = new URLSearchParams(location.search);
	if (q.has("scout")) {
		const { scout } = await import("./scout.ts");
		return scout(canvas, q);
	}
	const p = readParams(location.search);
	const game = await createGame({
		canvas,
		scene: buildScene(p.site),
		mode: p.mode,
		backend: p.backend,
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(p.stopAtTick !== undefined ? { stopAtTick: p.stopAtTick } : {}),
	});
	const rig = game.player;
	if (!rig) throw new Error("scene has no player character");
	const occlusion = occlusionOf(game);
	const WORLD = p.site.world;
	let seed = p.seed;
	let sim = new FieldSim({ seed, world: WORLD, occlusion });
	const startYaw = rig.camera?.yaw ?? 0;
	let bot = p.demo ? new DemoBot(sim, WORLD, startYaw) : null;
	const live = p.demo ? null : new LiveInput(canvas);
	const pres = new Presentation(game, sim, {
		site: p.site,
		sites: SITES,
		hud: p.hud ? hudRoot : null,
		mute: p.mute || p.mode === "fixed",
		...(p.camDist !== undefined ? { camDist: p.camDist } : {}),
		...(p.camPitch !== undefined ? { camPitch: p.camPitch } : {}),
		...(p.shotCam ? { shotCam: p.shotCam } : {}),
	});
	if (!p.hud) hudRoot.classList.add("hidden");

	const world = game.sim.world;
	const slot = (): number => world.slotOf(rig.simId);
	const log = new InputLog();
	const input = emptyInput();
	if (p.start) {
		input.buttons = BTN.START;
		input.camYaw = startYaw;
		sim.step(input);
	}
	let lastTick = world.tick();
	const cpu = { ms: 0 };

	const restart = (): void => {
		seed += 1;
		sim = new FieldSim({ seed, world: WORLD, occlusion });
		world.teleport(rig.simId, WORLD.playerStart[0], 0.8, WORLD.playerStart[1]);
		pres.reset(sim);
		if (bot) bot = new DemoBot(sim, WORLD, startYaw, 1);
		pres.cameraYaw = startYaw;
		log.clear(); // one replayable log per survey
	};

	// Title: Tab (or 1/2) picks the other site; the page reloads into it.
	window.addEventListener("keydown", (e) => {
		if (sim.phase !== PHASE.TITLE || p.demo) return;
		const i = SITES.indexOf(p.site);
		let next = -1;
		if (e.code === "Tab") next = (i + 1) % SITES.length;
		else if (/^Digit[1-9]$/.test(e.code)) next = Number(e.code.slice(5)) - 1;
		if (next < 0 || next >= SITES.length || next === i) return;
		e.preventDefault();
		const q = new URLSearchParams(location.search);
		q.set("site", (SITES[next] as Site).id);
		location.search = q.toString();
	});

	game.onFrame((dt) => {
		const t0 = performance.now();
		const now = world.tick();
		const ticks = Math.min(5, now - lastTick);
		lastTick = now;
		const views = game.views;
		for (let i = 0; i < ticks; i++) {
			if (bot) bot.next(input);
			else if (live) {
				live.photo = sim.phase === PHASE.PHOTO;
				live.menu = sim.phase === PHASE.TITLE || sim.phase === PHASE.RESULTS;
				live.sample(input, pres.cameraYaw, sim.cam.fovDeg, sim.cam.focus);
			}
			quantizeInput(input);
			log.push(input);
			const o = slot() * 8;
			const c = views.curr;
			sim.setPlayer(c[o] as number, c[o + 1] as number, c[o + 2] as number);
			sim.step(input);
			pres.drain();
			if (sim.restartRequested) {
				// A new survey straight into exploring (the results' START is the start).
				restart();
				input.buttons = BTN.START;
				sim.step(input);
				pres.drain();
			}
		}
		// Movement for the engine's next tick: only while exploring.
		const b = sim.phase === PHASE.EXPLORE && sim.wrapT < 0 ? input.buttons : 0;
		const k = rig.input.keys;
		k.f = (b & BTN.F) !== 0;
		k.b = (b & BTN.B) !== 0;
		k.l = (b & BTN.L) !== 0;
		k.r = (b & BTN.R) !== 0;
		rig.input.sprint = (b & BTN.SPRINT) !== 0;
		rig.input.jump = (b & BTN.JUMP) !== 0;
		if (bot && sim.phase === PHASE.EXPLORE) pres.cameraYaw = input.camYaw;
		pres.update(dt);
		cpu.ms += (performance.now() - t0 - cpu.ms) * 0.05;
	});

	Object.assign(window.__pebble3d ?? {}, {
		game: {
			site: () => p.site.id,
			phase: () => PHASE_NAMES[sim.phase],
			seed: () => seed,
			score: () => sim.score,
			documented: () => sim.documented,
			revealed: () => sim.revealedCount,
			film: () => sim.film,
			stars: () => sim.totalStars,
			photos: () =>
				sim.photos
					.filter((r) => r.used)
					.map((r) => ({
						anomaly: r.anomaly >= 0 ? sim.anomalies[r.anomaly]?.def.id : null,
						total: r.score.total,
						stars: r.score.stars,
						occluded: r.score.occluded,
						tick: r.tick,
						fov: Math.round(r.cam.fovDeg),
					})),
			hash: () => sim.hash(),
			inputs: () => log.length,
			bot: () => bot?.current ?? null,
			cpuMs: () => cpu.ms,
			player: () => [sim.px, sim.py, sim.pz],
			anomalies: () =>
				sim.anomalies.map((a) => ({
					id: a.def.id,
					at: [a.x, a.y, a.z],
					revealed: a.revealed,
					best: a.best,
				})),
		},
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
