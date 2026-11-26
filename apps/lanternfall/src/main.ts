import { createGame } from "@pebble3d/sdk/game";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import { Sfx } from "./audio/sfx.ts";
import { showDump } from "./dump.ts";
import { DemoBot } from "./game/bot.ts";
import { LiveInput } from "./game/live-input.ts";
import {
	emptyInput,
	GUARD_NAMES,
	LanternSim,
	PHASE,
	PHASE_NAMES,
} from "./game/sim.ts";
import { generateKeep } from "./gen/generate.ts";
import { Hud } from "./ui/hud.ts";
import { Presentation } from "./view/present.ts";

/**
 * Lanternfall URL params:
 *   seed=<n>             keep seed (default random in realtime, 64 in fixed mode)
 *   demo=1               autoplayer (title, the heist, results, retry)
 *   dumpScene=1          show and download the generated scene JSON instead of playing
 *                        (&layout=1 adds the game metadata: guard routes, lights, loot)
 *   mode=realtime|fixed  fixed = one tick per frame (captures); ticks=<n> stops there
 *   start=1              skip the title
 *   guards=<n>           warden count (default 4)
 *   hud=0                hide the HUD; mute=1 no audio
 *   shotCam=px,py,pz,tx,ty,tz,fov  fixed camera (staged capture stills)
 *   backend=webgpu|webgl
 */
function num(q: URLSearchParams, k: string): number | undefined {
	const v = q.get(k);
	if (v === null) return undefined;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new Error(`bad ${k} param "${v}"`);
	return n;
}

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	const hudRoot = document.getElementById("hud");
	if (!(canvas instanceof HTMLCanvasElement) || !hudRoot)
		throw new Error("#app canvas / #hud missing");
	const q = new URLSearchParams(location.search);
	const mode = q.get("mode") === "fixed" ? "fixed" : "realtime";
	// A random keep per visit is picked here, outside the sim; the sim only sees the seed.
	const seed =
		num(q, "seed") ?? (mode === "fixed" ? 64 : (Date.now() % 9973) + 1);
	const g = num(q, "guards");
	const guards =
		g === undefined ? undefined : Math.max(1, Math.min(6, Math.round(g)));
	const keep = generateKeep(seed, guards !== undefined ? { guards } : {});
	if (q.get("dumpScene") === "1") {
		showDump(keep, seed, q.get("layout") === "1");
		return;
	}
	const demo = q.get("demo") === "1";
	const ticks = num(q, "ticks");
	const game = await createGame({
		canvas,
		scene: keep.scene,
		mode,
		backend: q.get("backend") === "webgl" ? "webgl" : "webgpu",
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(ticks !== undefined ? { stopAtTick: ticks } : {}),
	});
	const sim = new LanternSim(game, keep);
	const bot = demo ? new DemoBot(sim) : null;
	const live = demo ? null : new LiveInput();
	const pres = new Presentation(game, sim, keep);
	const shotCam = q.get("shotCam")?.split(",").map(Number);
	if (shotCam && shotCam.length === 7) pres.shotCam = shotCam;
	const hud = new Hud(hudRoot, sim, { seed, demo });
	if (q.get("hud") === "0") hudRoot.classList.add("hidden");
	const sfx = new Sfx(q.get("mute") !== "1" && mode !== "fixed");
	if (q.get("start") === "1") sim.begin();

	const world = game.sim.world;
	const input = emptyInput();
	const cpu = { ms: 0 };
	game.onFrame((dt) => {
		const t0 = performance.now();
		while (sim.tick < world.tick()) {
			if (bot) bot.next(input);
			else live?.sample(input);
			sim.step(input);
			sfx.handle(sim);
		}
		// Every frame, 0-tick frames included: the sim's intent wins over the rig's keyboard.
		sim.assertInput();
		// The unseeded demo tours keeps: a few seconds after each result, the next one.
		const tour =
			bot !== null &&
			!q.has("seed") &&
			mode === "realtime" &&
			sim.phase >= PHASE.CAUGHT &&
			sim.phaseT > 270;
		if (live?.newKeep || tour) {
			if (live) live.newKeep = false;
			const nq = new URLSearchParams(location.search);
			nq.set("seed", String(seed + 1));
			location.search = nq.toString();
		}
		pres.update(dt);
		sfx.frame(sim, dt);
		hud.update(
			game.renderer.three.camera,
			pres.guardPositions,
			canvas.clientWidth,
			canvas.clientHeight,
		);
		cpu.ms += (performance.now() - t0 - cpu.ms) * 0.05;
	});

	Object.assign(window.__pebble3d ?? {}, {
		game: {
			seed: () => seed,
			attempt: () => keep.layout.attempt,
			phase: () => PHASE_NAMES[sim.phase],
			score: () => sim.score,
			loot: () => sim.lootCount,
			relic: () => sim.hasRelic,
			alerts: () => sim.alerts,
			light: () => Math.round(sim.playerLight * 100) / 100,
			guards: () => sim.guards.map((g) => GUARD_NAMES[g.state]),
			bot: () => bot?.current ?? null,
			hash: () => sim.hash(),
			cpuMs: () => cpu.ms,
			entities: () => keep.scene.entities?.length ?? 0,
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
	el.textContent = msg;
	el.style.cssText =
		"position:fixed;inset:auto 16px 16px 16px;margin:0;padding:12px 16px;background:#2a0d0d;color:#ffd7d7;border:1px solid #ff6b6b;font:14px ui-monospace,monospace;white-space:pre-wrap;z-index:10";
	document.body.append(el);
});
