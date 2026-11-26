import type { Game } from "@pebble3d/sdk/game";
import { Raycaster, Vector2, Vector3 } from "three/webgpu";
import { aimVelocity, reachable } from "./aim.ts";
import { Sfx } from "./audio/sfx.ts";
import { BOT_CARD_TICKS } from "./bot.ts";
import { SPEED_MAX, SPEED_MIN } from "./constants.ts";
import { type AppState, type DriverStatus, REPLAY_SCALE } from "./driver.ts";
import type { HostSink, SimHost, SiteView } from "./host.ts";
import { LEVELS, type LevelDef } from "./levels.ts";
import { pickRay } from "./pick.ts";
import { PHASE, type Phase, Session, type ShotResult } from "./session.ts";
import type { Shot } from "./site.ts";
import { Hud, type HudCallbacks } from "./ui/hud.ts";
import { AimView } from "./view/aim-view.ts";
import { BlocksView } from "./view/blocks-view.ts";
import { CameraDirector } from "./view/camera.ts";
import { Dust } from "./view/dust.ts";
import { type ImpactSink, ImpactWatch } from "./view/impacts.ts";
import { WorldView } from "./view/world-view.ts";

export interface PresentOptions {
	demo: boolean;
	startLevel: number;
	hud: HTMLElement | null;
	mute: boolean;
	cam: { yaw: number; pitch: number; dist: number } | null;
	/** Show the debug stats line. */
	stats: boolean;
}

const _v = new Vector3();
/** Charge hints per integer speed, built once (no per-frame strings). */
const SPEED_HINTS: string[] = [];
for (let v = Math.floor(SPEED_MIN); v <= Math.ceil(SPEED_MAX); v++)
	SPEED_HINTS[v] = `${v} m/s · release to fire`;
const _d = new Vector3();

/**
 * Breakpoint's presentation: views, input, camera director, VFX, audio and HUD. The
 * simulation lives behind a SimHost (inline for captures, a Web Worker for play); this class
 * only reads its status and per-tick body states and sends it intent.
 */
export class Presentation implements ImpactSink, HostSink {
	private host!: SimHost;
	private readonly game: Game;
	private readonly opts: PresentOptions;
	private readonly blocks: BlocksView;
	private readonly world: WorldView;
	private readonly aimView: AimView;
	private readonly dust: Dust;
	private readonly impacts = new ImpactWatch();
	private readonly cam: CameraDirector;
	private readonly hud: Hud | null;
	private readonly sfx: Sfx;
	private view: SiteView | null = null;
	private frames = 0;
	private lastPhase: Phase = -1 as Phase;
	private lastState: AppState | "" = "";
	private ballHit = false;
	/** Live aim. */
	private readonly target = new Vector3(0, 2.5, 0);
	private charging = false;
	private charge = 0;
	private readonly vel: [number, number, number] = [0, 0, 0];
	private readonly pointer = new Vector2();
	private pointerFresh = false;
	private readonly ray = new Raycaster();
	private replayLevel = -1;
	/** A replay is showing (set by events, so it never lags the worker's status). */
	private replaying = false;
	/** Shots finished this run (for the "New best shot" toast). */
	private shotsDone = 0;
	private readonly tgt: [number, number, number] = [0, 0, 0];
	/** `frame:phase:level:shot` and `frame:state` entries (capture scripting). */
	readonly timeline: string[] = [];

	constructor(game: Game, opts: PresentOptions) {
		this.game = game;
		this.opts = opts;
		const three = game.renderer.three;
		game.renderer.controller = null; // the director drives the camera
		// Low warm sun as the key; the noon HDRI only fills.
		three.scene.environmentIntensity = 0.42;
		three.scene.backgroundIntensity = 0.85;
		three.camera.fov = 42;
		three.camera.updateProjectionMatrix();
		const maxBlocks = Math.max(...LEVELS.map((l) => l.build(1).length)) + 64;
		this.blocks = new BlocksView(three.scene, maxBlocks);
		this.world = new WorldView(three.scene);
		this.aimView = new AimView(three.scene);
		this.dust = new Dust(three.scene);
		this.cam = new CameraDirector(three.camera);
		this.cam.override = opts.cam;
		this.sfx = new Sfx(opts.mute);
		const totalBlocks = LEVELS.reduce((n, l) => n + l.build(1).length, 0);
		const cb: HudCallbacks = {
			start: () => this.begin(),
			next: () => {
				this.host.advance();
				this.sfx.click();
			},
			replay: () => {
				this.host.requestReplay();
				this.sfx.click();
			},
			restart: () => location.reload(),
		};
		this.hud = opts.hud ? new Hud(opts.hud, cb, totalBlocks) : null;
		this.cam.set("title", true);
		this.bindInput(three.renderer.domElement);
	}

	/** Connects the sim (its constructor may already call `level`). */
	attach(host: SimHost): void {
		this.host = host;
	}

	begin(): void {
		if (this.host.status().state !== "title") return;
		this.host.begin();
		this.hud?.show("title", false);
		this.sfx.click();
	}

	// --- host events -------------------------------------------------------------------

	level(index: number, _seed: number, view: SiteView): void {
		this.bindView(view);
		this.dust.clear();
		const b = this.world.bounds;
		this.cam.site.set((b[0] + b[2]) / 2, 3, (b[1] + b[3]) / 2);
		this.cam.siteRadius = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2;
		this.cam.cannon.set(...view.level.launcher);
		this.target.set(this.cam.site.x, 2.5, this.cam.site.z);
		this.hud?.settle(view.level, index, LEVELS.length);
	}

	private bindView(view: SiteView): void {
		this.view = view;
		this.blocks.bind(view);
		this.impacts.bind(view);
		this.world.setLevel(view.level, view.blocks);
	}

	fire(shot: Shot): void {
		this.sfx.fire();
		this.ballHit = false;
		this.cam.ballVel.set(shot.vx, shot.vy, shot.vz);
		this.cam.impactDir.set(shot.vx, 0, shot.vz).normalize();
		this.cam.impactAt.copy(this.target);
		this.cam.set("flight");
		this.cam.shake(0.35);
		const [x, y, z] = (this.view as SiteView).level.launcher;
		this.dust.puff(
			x,
			y + 0.2,
			z - 0.8,
			10,
			0.6,
			shot.vx * 0.05,
			shot.vz * 0.05,
		);
		this.aimView.hide();
	}

	shotDone(r: ShotResult, best: boolean): void {
		this.shotsDone++;
		this.hud?.toast(
			`+${(r.kg / 1000).toFixed(1)} t`,
			best && this.shotsDone > 1 ? "New best shot" : `Shot ${r.index + 1}`,
		);
		this.sfx.chime(best);
	}

	tick(view: SiteView): void {
		this.impacts.scan(this);
		void view;
	}

	replayStart(
		levelIndex: number,
		shot: Shot,
		result: ShotResult,
		view: SiteView,
	): void {
		this.replayLevel = levelIndex;
		this.replaying = true;
		this.bindView(view);
		this.dust.clear();
		this.hud?.show("card", false);
		this.hud?.show("top", false);
		this.hud?.show("power", false);
		this.hud?.hideToast();
		const lv = LEVELS[levelIndex];
		this.hud?.replay(
			true,
			`Replay · ${REPLAY_SCALE}×`,
			`<b>${lv?.name ?? ""}</b> · shot ${result.index + 1} · ${(result.kg / 1000).toFixed(1)} t<br>Re-simulated from the level seed and ${result.index + 1} recorded input${result.index ? "s" : ""} · tick ${shot.tick}`,
		);
		this.hud?.verify("Re-simulating…", false);
		this.cam.replayScale = REPLAY_SCALE;
		this.cam.ballVel.set(shot.vx, shot.vy, shot.vz);
		this.cam.impactDir.set(shot.vx, 0, shot.vz).normalize();
		const b = this.world.bounds;
		this.cam.site.set((b[0] + b[2]) / 2, 3, (b[1] + b[3]) / 2);
		this.cam.set("flight", true);
		this.ballHit = false;
		this.sfx.fire();
	}

	replayVerified(ok: boolean, hash: string): void {
		const best = this.host.status().best;
		this.hud?.verify(
			ok
				? `✓ state hash ${hash} matches the live run`
				: `✗ hash ${hash} ≠ ${best?.endHash ?? "?"}`,
			ok,
		);
	}

	replayEnd(view: SiteView): void {
		this.replaying = false;
		this.bindView(view);
		this.hud?.replay(false);
		this.hud?.show("top", true);
		this.lastPhase = -1 as Phase;
		this.cam.set("survey");
	}

	impact(
		x: number,
		y: number,
		z: number,
		dv: number,
		kg: number,
		ball: boolean,
	): void {
		if (ball) {
			if (!this.ballHit) {
				this.ballHit = true;
				this.cam.impactAt.set(x, y, z);
				if (this.replaying) this.cam.set("replay");
				else if (!this.opts.cam) this.cam.set("impact");
				this.cam.shake(0.5);
				this.dust.puff(x, y, z, 26, 1.6);
				this.dust.spray(x, y, z, 60, 11);
			} else {
				this.dust.puff(x, y, z, 4, 0.8);
			}
			this.sfx.impact(1, true);
			return;
		}
		const e = dv * kg;
		const p = Math.min(1, e / 4000);
		// Ground hits raise plumes; hits higher up shed a little grit.
		if (y < 0.8)
			this.dust.puff(x, 0.3, z, 1 + Math.round(p * 4), 0.5 + p * 1.3);
		else if (p > 0.4) this.dust.puff(x, y, z, 1, 0.4);
		if (p > 0.25) this.dust.spray(x, y, z, 2 + Math.round(p * 6), 3 + p * 5);
		if (p > 0.7) this.cam.shake(0.04);
		this.sfx.impact(p, false);
	}

	// --- input -------------------------------------------------------------------------

	private bindInput(canvas: HTMLCanvasElement): void {
		canvas.addEventListener("pointermove", (e) => {
			const r = canvas.getBoundingClientRect();
			this.pointer.set(
				((e.clientX - r.left) / r.width) * 2 - 1,
				-((e.clientY - r.top) / r.height) * 2 + 1,
			);
			this.pointerFresh = true;
		});
		canvas.addEventListener("pointerdown", (e) => {
			if (e.button !== 0 || this.opts.demo) return;
			const st = this.host.status();
			if (st.state === "title") return this.begin();
			if (this.replaying) return this.host.skipReplay();
			if (st.phase === PHASE.AIM && st.state === "play") {
				this.charging = true;
				this.charge = 0;
			}
		});
		// A cancelled pointer or a lost focus drops the charge without firing.
		const cancel = (): void => {
			this.charging = false;
			this.charge = 0;
		};
		canvas.addEventListener("pointercancel", cancel);
		window.addEventListener("blur", cancel);
		window.addEventListener("pointerup", () => {
			if (!this.charging) return;
			this.charging = false;
			const lv = (this.view as SiteView).level;
			aimVelocity(
				lv.launcher,
				[this.target.x, this.target.y, this.target.z],
				this.speed(),
				this.vel,
			);
			this.host.fire(this.vel[0], this.vel[1], this.vel[2]);
			this.charge = 0;
		});
		window.addEventListener("keydown", (e) => {
			if (this.opts.demo) return;
			if (e.code === "Space" || e.code === "Enter") {
				e.preventDefault();
				if (this.host.status().state === "title") this.begin();
				else if (this.replaying) this.host.skipReplay();
				else this.host.advance();
			}
			if (e.code === "KeyR" && this.host.status().phase === PHASE.RUN_DONE)
				this.host.requestReplay();
		});
	}

	private speed(): number {
		return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * this.charge;
	}

	/** Raycasts the pointer into the site to place the live aim target. */
	private updatePointerTarget(): void {
		if (!this.pointerFresh || !this.view) return;
		this.pointerFresh = false;
		this.ray.setFromCamera(this.pointer, this.game.renderer.three.camera);
		const o = this.ray.ray.origin;
		const d = this.ray.ray.direction;
		const toi = pickRay(this.view, o.x, o.y, o.z, d.x, d.y, d.z, 200);
		if (toi > 0) this.target.copy(o).addScaledVector(d, toi);
	}

	// --- frame -------------------------------------------------------------------------

	/** One rendered frame; `dt` is real seconds (fixed mode: exactly 1/60). */
	frame(dt: number): void {
		this.frames++;
		this.host.setTimeScale(this.cam.timeScale);
		this.host.frame(dt);
		this.present(dt, this.host.status());
	}

	private present(dt: number, st: DriverStatus): void {
		const three = this.game.renderer.three;
		const view = this.view;
		if (!view) return;
		const phase = st.phase;
		const level = LEVELS[st.levelIndex] as LevelDef;
		if (st.state === "play" && phase !== this.lastPhase) {
			this.onPhase(phase, st);
			this.timeline.push(
				`${this.frames}:${phase}:${st.levelIndex}:${st.shotIndex}`,
			);
			this.lastPhase = phase;
		}
		if (st.state !== this.lastState) {
			this.timeline.push(`${this.frames}:${st.state}`);
			if (this.lastState === "title") this.hud?.show("title", false);
			this.lastState = st.state;
		}

		// Aim: pointer target and charge (live), or the bot's reticle (demo).
		const aiming = st.state === "play" && phase === PHASE.AIM;
		if (aiming && !st.bot) {
			this.updatePointerTarget();
			if (this.charging) this.charge = Math.min(1, this.charge + dt / 1.1);
		}
		if (aiming && st.bot?.aiming) {
			this.target.set(st.bot.x, st.bot.y, st.bot.z);
			this.charge = st.bot.charge;
		}
		if (st.state !== "title") this.cam.reticle.copy(this.target);

		// Camera follow targets.
		const bi = view.ballSlots.length - 1;
		if (bi >= 0 && this.blocks.ballPosition(bi, _v)) {
			this.cam.ball.copy(_v);
			const o = (view.ballSlots[bi] as number) * 8;
			_d.set(
				(view.curr[o] as number) - (view.prev[o] as number),
				(view.curr[o + 1] as number) - (view.prev[o + 1] as number),
				(view.curr[o + 2] as number) - (view.prev[o + 2] as number),
			);
			if (_d.lengthSq() > 1e-6) this.cam.ballVel.copy(_d).multiplyScalar(60);
		}
		if (this.cam.mode === "impact" && this.cam.modeTime > 4.2)
			this.cam.set("survey");
		this.cam.update(dt);

		// World.
		this.blocks.update(this.host.alpha());
		const k = this.charge;
		const speed =
			SPEED_MIN + (SPEED_MAX - SPEED_MIN) * (aiming ? Math.max(k, 0.55) : 0.55);
		const lv = view.level.launcher;
		const tgt = this.tgt;
		tgt[0] = this.target.x;
		tgt[1] = this.target.y;
		tgt[2] = this.target.z;
		aimVelocity(lv, tgt, speed, this.vel);
		this.world.aim(this.vel[0], this.vel[1], this.vel[2]);
		const ok = reachable(lv, tgt, speed);
		if (aiming)
			this.aimView.show(lv, this.vel, this.target, ok, three.camera, dt);
		else this.aimView.hide();
		const gameScale = st.state === "replay" ? REPLAY_SCALE : this.cam.timeScale;
		this.dust.update(
			dt * gameScale * Math.min(1, st.pace / Math.max(0.05, gameScale)),
			three.camera,
		);
		this.world.setLineVisible(st.state !== "replay");
		this.sfx.charge(
			aiming && (this.charging || (st.bot?.charge ?? 0) > 0) ? k : 0,
		);
		this.sfx.rumble(Math.min(1, this.impacts.motion() / 900));

		// HUD.
		const hud = this.hud;
		if (!hud) return;
		if (st.state === "play" && !this.replaying) {
			hud.show("settle", phase === PHASE.SETTLING);
			const showTop = phase !== PHASE.SETTLING;
			hud.show("top", showTop);
			if (showTop)
				hud.top(
					level,
					st.levelIndex,
					LEVELS.length,
					st.shotsLeft,
					st.knockedKg / st.aboveKg,
					st.knockedKg,
				);
			hud.show("power", aiming);
			if (aiming)
				hud.power(
					k,
					ok,
					st.bot
						? "Demo · the autoplayer is aiming"
						: this.charging
							? (SPEED_HINTS[Math.round(speed)] ?? "")
							: "Point at a weak spot · hold to charge · release to fire",
				);
		} else if (st.state === "title") {
			hud.show("settle", false);
		}
		if (this.opts.stats && this.frames % 10 === 0) {
			const fps = this.game.renderer.stats().fps;
			hud.perf(
				`<b>${fps.toFixed(0)}</b> fps · <b>${st.awake}</b>/${view.n} bodies awake · Rapier <b>${st.tickMs.toFixed(1)}</b> ms/tick (${this.host.kind === "worker" ? "worker" : "main thread"}) · game time <b>${Math.min(gameScale, st.pace).toFixed(2)}×</b>`,
			);
		}
	}

	private onPhase(phase: Phase, st: DriverStatus): void {
		const hud = this.hud;
		const i = st.levelIndex;
		const level = LEVELS[i] as LevelDef;
		if (phase === PHASE.AIM) {
			if (!this.opts.cam) this.cam.set("aim");
			hud?.show("card", false);
		} else if (phase === PHASE.SETTLING) {
			this.cam.set("survey");
		} else if (phase === PHASE.LEVEL_DONE || phase === PHASE.RUN_DONE) {
			const fr = (st.levelKg[i] ?? 0) / (st.levelMax[i] ?? 1);
			if (!this.opts.cam) this.cam.set("survey");
			if (phase === PHASE.LEVEL_DONE) {
				const shots = st.results.filter((r) => r.level === i);
				const bestKg = Math.max(...shots.map((r) => r.kg));
				hud?.levelCard({
					level,
					index: i,
					count: LEVELS.length,
					fraction: fr,
					stars: Session.stars(level, fr),
					kg: st.levelKg[i] ?? 0,
					shots: shots.map((r) => ({ kg: r.kg, best: r.kg === bestKg })),
				});
			} else {
				const levels = [];
				for (let l = this.opts.startLevel; l <= i; l++) {
					const lf = (st.levelKg[l] ?? 0) / (st.levelMax[l] ?? 1);
					const def = LEVELS[l];
					if (def)
						levels.push({
							name: def.name,
							stars: Session.stars(def, lf),
							fraction: lf,
						});
				}
				const b = st.best;
				hud?.runCard({
					totalKg: st.totalKg,
					levels,
					best: b
						? { level: LEVELS[b.level]?.name ?? "", index: b.index, kg: b.kg }
						: null,
					blocks: this.view?.n ?? 0,
				});
			}
		}
	}

	/** Probe for captures and benches. */
	probe(): Record<string, unknown> {
		const st = this.host.status();
		return {
			sim: this.host.kind,
			state: st.state,
			phase: st.phase,
			level: st.levelIndex,
			shot: st.shotIndex,
			tick: st.tick,
			blocks: this.view?.n ?? 0,
			awake: st.awake,
			knockedKg: Math.round(st.knockedKg),
			totalKg: Math.round(st.totalKg),
			best: st.best
				? {
						level: st.best.level,
						index: st.best.index,
						kg: Math.round(st.best.kg),
					}
				: null,
			replayReady: st.replayReady,
			replayVerified: st.replayVerified,
			replayLevel: this.replayLevel,
			tickMs: Number(st.tickMs.toFixed(2)),
			pace: Number(st.pace.toFixed(2)),
			timeScale: Number(this.cam.timeScale.toFixed(2)),
			cardTicks: BOT_CARD_TICKS,
			timeline: this.timeline.join(" "),
		};
	}
}
