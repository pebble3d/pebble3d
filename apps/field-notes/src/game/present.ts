import { ThirdPersonController } from "@pebble3d/renderer";
import type { Game } from "@pebble3d/sdk/game";
import { type Object3D, Quaternion, Vector3 } from "three/webgpu";
import { ANOMALIES } from "./anomalies.ts";
import { Sfx } from "./audio/sfx.ts";
import { FRAME_ASPECT } from "./constants.ts";
import { project } from "./photo.ts";
import { type Anomaly, EV, type FieldSim, PHASE } from "./sim.ts";
import type { Site } from "./sites.ts";
import { type FrameBox, Hud } from "./ui/hud.ts";
import { AnomalyView } from "./view/anomaly-view.ts";
import { buildCamp } from "./view/camp-view.ts";

const DEG = Math.PI / 180;
/** Built once: the HUD prompt is read every frame. */
const RAISE_PROMPTS = ANOMALIES.map(
	(d) => `${d.name} — press C to raise the camera`,
);
/** Seconds the camera takes to rise from the shoulder to the eye. */
const RAISE_SECONDS = 0.28;

export interface PresentOptions {
	site: Site;
	sites: readonly Site[];
	hud: HTMLElement | null;
	mute: boolean;
	/** Capture stills: a fixed camera pose [px,py,pz,tx,ty,tz,fov] while surveying. */
	shotCam?: number[];
	/** Exploration camera arm and pitch (captures). */
	camDist?: number;
	camPitch?: number;
}

/**
 * Everything the player sees and hears, driven from sim state: anomaly and camp visuals, the
 * three camera modes (title drift, third-person, photo eye with DOF and exposure), the HUD
 * and the synthesised audio. It reads the sim and never writes it.
 */
export class Presentation {
	private readonly game: Game;
	private sim: FieldSim;
	private readonly anomalies: AnomalyView;
	readonly hud: Hud | null;
	private readonly sfx: Sfx;
	private readonly playerRoot: Object3D | null;
	private readonly canvas: HTMLCanvasElement;
	private readonly box: FrameBox = { x: 0, y: 0, w: 0, h: 0 };
	private readonly proj = { u: 0, v: 0, depth: 0 };
	private raiseT = 1;
	private readonly fromPos = new Vector3();
	private readonly fromQuat = new Quaternion();
	private readonly toPos = new Vector3();
	private readonly toQuat = new Quaternion();
	private readonly look = new Vector3();
	private pendingCapture = -1;
	private lastPhase = -1;
	private readonly baseExposure: number;
	private titleT = 0;
	private readonly titlePos = new Vector3();
	private readonly titleTarget = new Vector3();
	private readonly shotCam: number[] | null;

	constructor(game: Game, sim: FieldSim, opts: PresentOptions) {
		this.game = game;
		this.sim = sim;
		const scene = game.renderer.three.scene;
		this.anomalies = new AnomalyView(scene, sim);
		const view = opts.site.world.view;
		buildCamp(scene, view.props);
		this.titlePos.set(...view.titlePos);
		this.titleTarget.set(...view.titleTarget);
		this.hud = opts.hud
			? new Hud(opts.hud, {
					survey: sim.cfg.seed,
					site: opts.site,
					sites: opts.sites,
				})
			: null;
		this.sfx = new Sfx(!opts.mute);
		this.shotCam = opts.shotCam ?? null;
		this.canvas = game.renderer.three.renderer.domElement as HTMLCanvasElement;
		this.playerRoot = game.player
			? (game.renderer.characterObject(game.player.simId) ?? null)
			: null;
		this.baseExposure = game.renderer.three.renderer.toneMappingExposure;
		const rig = game.player;
		if (rig?.camera) {
			// The engine's arm ray sees every static collider, including the invisible bounds
			// walls, which pull the camera into the player's head at the edge of the yard.
			// Outdoors the arm passes through them; interiors (`cameraWalls`) keep them.
			const old = rig.camera;
			old.enabled = false;
			old.disconnect();
			const world = game.sim.world;
			const scratch = (): Float32Array => game.views.scratch;
			const walls = new Set<number>();
			if (!view.cameraWalls)
				for (const [k, id] of game.ids)
					if (k.startsWith("__bounds.")) walls.add(id);
			const tpc = new ThirdPersonController(cam3(game), (o, d, max) => {
				if (!world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, 1, 0))
					return null;
				const sc = scratch();
				return walls.has(sc[4] as number) ? null : (sc[0] as number);
			});
			tpc.yaw = old.yaw;
			tpc.connect(this.canvas);
			rig.camera = tpc;
		}
		const tpc = game.player?.camera;
		if (tpc) {
			tpc.distance = opts.camDist ?? view.camDist;
			tpc.pitch = opts.camPitch ?? view.camPitch;
		}
		const dof = game.renderer.dof;
		dof.backdrop.value = view.backdrop;
		dof.bokeh.value = 1.1;
	}

	/** A new survey (restart): rebind to the new sim. */
	reset(sim: FieldSim): void {
		this.sim = sim;
		this.anomalies.rebind(sim);
		this.hud?.reset();
		this.pendingCapture = -1;
		this.lastPhase = -1;
	}

	/** Exploration camera yaw (movement frame). */
	get cameraYaw(): number {
		return this.game.player?.camera?.yaw ?? 0;
	}

	set cameraYaw(y: number) {
		const tpc = this.game.player?.camera;
		if (tpc) tpc.yaw = y;
	}

	/** Reacts to this tick's sim events (audio, toasts, captures). */
	drain(): void {
		const ev = this.sim.events;
		for (let i = 0; i < ev.length; i++) {
			const t = ev.type[i] as number;
			const arg = ev.arg[i] as number;
			switch (t) {
				case EV.REVEAL: {
					const a = this.sim.anomalies[arg] as Anomaly;
					this.sfx.reveal();
					this.hud?.showToast(
						a.def.name,
						"something is taking shape",
						200,
						this.sim.tick,
					);
					break;
				}
				case EV.SHUTTER:
					this.sfx.shutter();
					this.hud?.shutterFlash();
					this.pendingCapture = arg;
					break;
				case EV.DOCUMENTED:
					this.sfx.documented();
					break;
				case EV.AF:
					this.sfx.focus(arg >= 0);
					break;
				case EV.PHOTO_ON:
				case EV.PHOTO_OFF:
					this.sfx.raise(t === EV.PHOTO_ON);
					break;
				case EV.EV_STEP:
					this.sfx.click();
					break;
				case EV.RESULTS:
					this.sfx.results();
					break;
			}
		}
	}

	/** The 16:9 frame inside the canvas, CSS pixels. */
	private layoutBox(): void {
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const b = this.box;
		if (w / h > FRAME_ASPECT) {
			b.h = h;
			b.w = h * FRAME_ASPECT;
		} else {
			b.w = w;
			b.h = w / FRAME_ASPECT;
		}
		b.x = (w - b.w) / 2;
		b.y = (h - b.h) / 2;
	}

	update(dt: number): void {
		const sim = this.sim;
		const r = this.game.renderer;
		const cam = r.three.camera;
		const tpc = this.game.player?.camera ?? null;
		const phase = sim.phase;
		const t = sim.tick / 60;
		this.layoutBox();
		this.hud?.layoutFrame(this.box);

		if (phase !== this.lastPhase) {
			if (phase === PHASE.PHOTO) {
				this.raiseT = 0;
				this.fromPos.copy(cam.position);
				this.fromQuat.copy(cam.quaternion);
			}
			if (this.lastPhase === PHASE.PHOTO && tpc) {
				tpc.yaw = sim.cam.yaw;
			}
			this.lastPhase = phase;
		}

		const photo = phase === PHASE.PHOTO;
		if (tpc) tpc.enabled = phase === PHASE.EXPLORE;
		if (phase === PHASE.TITLE || phase === PHASE.RESULTS) {
			this.titleT += dt;
			const s = this.titleT * 0.05;
			const amp = Math.min(
				1.6,
				this.titlePos.distanceTo(this.titleTarget) * 0.12,
			);
			cam.position.set(
				this.titlePos.x + Math.sin(s) * amp,
				this.titlePos.y + Math.sin(s * 0.7) * amp * 0.15,
				this.titlePos.z - Math.sin(s) * amp * 0.5,
			);
			cam.fov = 40;
			cam.updateProjectionMatrix();
			cam.lookAt(this.titleTarget);
			cam.updateMatrixWorld();
		} else if (photo) {
			const c = sim.cam;
			// Keep the vertical FOV of the 16:9 frame when the window is narrower than 16:9.
			const aspect = cam.aspect;
			const tanH =
				Math.tan((c.fovDeg * DEG) / 2) * Math.max(1, FRAME_ASPECT / aspect);
			const fov = (2 * Math.atan(tanH)) / DEG;
			this.toPos.set(c.x, c.y, c.z);
			this.look.set(
				c.x - Math.sin(c.yaw) * Math.cos(c.pitch),
				c.y + Math.sin(c.pitch),
				c.z - Math.cos(c.yaw) * Math.cos(c.pitch),
			);
			cam.position.copy(this.toPos);
			cam.lookAt(this.look);
			this.toQuat.copy(cam.quaternion);
			if (this.raiseT < 1) {
				this.raiseT = Math.min(1, this.raiseT + dt / RAISE_SECONDS);
				const k = 1 - (1 - this.raiseT) ** 3;
				cam.position.lerpVectors(this.fromPos, this.toPos, k);
				cam.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, k);
			}
			if (cam.fov !== fov) {
				cam.fov = fov;
				cam.updateProjectionMatrix();
			}
			cam.updateMatrixWorld();
		} else if (cam.fov !== 50) {
			cam.fov = 50;
			cam.updateProjectionMatrix();
		}
		const sc = this.shotCam;
		if (sc && (phase === PHASE.EXPLORE || phase === PHASE.PHOTO)) {
			cam.position.set(sc[0] ?? 0, sc[1] ?? 0, sc[2] ?? 0);
			cam.fov = sc[6] ?? 50;
			cam.updateProjectionMatrix();
			cam.lookAt(sc[3] ?? 0, sc[4] ?? 0, sc[5] ?? 0);
			cam.updateMatrixWorld();
		}
		if (this.playerRoot)
			this.playerRoot.visible = !(photo && this.raiseT > 0.6 && !sc);

		// Photo-quality post only while the camera is up.
		const dof = r.dof;
		dof.enabled = photo && this.raiseT >= 1;
		if (photo) {
			const c = sim.cam;
			dof.focus.value = c.focus;
			dof.range.value = Math.min(
				8,
				Math.max(0.35, c.focus * 0.42 * (40 / c.fovDeg)),
			);
		}
		r.three.renderer.toneMappingExposure =
			this.baseExposure * (photo ? 2 ** sim.cam.ev : 1);

		this.anomalies.update(t);
		this.sfx.signal(phase === PHASE.EXPLORE || photo ? sim.signal : 0);

		// HUD: the eye-AF box around the live subject.
		let su = Number.NaN;
		let sv = Number.NaN;
		let size = 0;
		if (photo && sim.subject >= 0) {
			const a = sim.anomalies[sim.subject] as Anomaly;
			if (project(sim.cam, a.x, a.y, a.z, this.proj)) {
				su = this.proj.u;
				sv = this.proj.v;
				size =
					a.def.r / (this.proj.depth * Math.tan((sim.cam.fovDeg * DEG) / 2));
			}
		}
		this.hud?.update(sim, su, sv, size, this.prompt());

		if (this.pendingCapture >= 0) {
			const n = this.pendingCapture;
			this.pendingCapture = -1;
			// After this frame renders (same task, before it is presented).
			queueMicrotask(() => this.capture(n));
		}
	}

	private prompt(): string {
		const sim = this.sim;
		if (sim.phase !== PHASE.EXPLORE || sim.wrapT >= 0) return "";
		for (const a of sim.anomalies) {
			if (!a.revealed || a.bestStars > 0) continue;
			if (Math.hypot(a.x - sim.px, a.z - sim.pz) < 6.5)
				return RAISE_PROMPTS[a.kind] ?? "";
		}
		if (sim.revealedCount === 0 && sim.tick < 900)
			return "Follow the signal · motes drift where something is hiding";
		return "";
	}

	/** Copies the 16:9 frame of the canvas into the roll's thumbnail `n`. */
	private capture(n: number): void {
		const dst = this.hud?.thumbs[n];
		const ctx = dst?.getContext("2d");
		if (!dst || !ctx) return;
		const sx = this.canvas.width / this.canvas.clientWidth;
		const b = this.box;
		ctx.drawImage(
			this.canvas,
			b.x * sx,
			b.y * sx,
			b.w * sx,
			b.h * sx,
			0,
			0,
			dst.width,
			dst.height,
		);
		// A little vignette, like the viewfinder.
		const g = ctx.createRadialGradient(
			dst.width / 2,
			dst.height / 2,
			dst.height * 0.35,
			dst.width / 2,
			dst.height / 2,
			dst.width * 0.62,
		);
		g.addColorStop(0, "rgba(0,0,0,0)");
		g.addColorStop(1, "rgba(0,0,0,0.38)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, dst.width, dst.height);
		this.hud?.captured(n);
	}
}

function cam3(game: Game) {
	return game.renderer.three.camera;
}
