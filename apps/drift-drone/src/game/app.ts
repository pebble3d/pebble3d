import { readSlot } from "@pebble3d/renderer";
import type { Game } from "@pebble3d/sdk/game";
import { Quaternion, Vector3 } from "three/webgpu";
import { Sfx } from "./audio/sfx.ts";
import { DEMO_BOT, DroneBot } from "./bot.ts";
import { COUNTDOWN_TICKS, DT, type FlightMode } from "./constants.ts";
import { EV } from "./events.ts";
import {
	acceptGhost,
	GHOST_STATE,
	Ghost,
	type GhostRecord,
	recordLap,
	verifyRecord,
} from "./ghost.ts";
import { emptyInput, InputLog } from "./input.ts";
import { type KeyAction, type Screen, screenActions } from "./keys.ts";
import { LiveInput } from "./live-input.ts";
import { hostFromHandle, type PhysicsHost } from "./physics.ts";
import { DroneSim, PHASE } from "./sim.ts";
import type { Gate, TrackFile } from "./track.ts";
import { SITE, TRACKS } from "./tracks.ts";
import { fmtDelta, fmtTime, Hud } from "./ui/hud.ts";
import { CameraRig, type CamMode } from "./view/camera-rig.ts";
import { CourseView, LIGHT } from "./view/course-view.ts";
import { DroneView } from "./view/drone-view.ts";
import { Trail } from "./view/trail.ts";

export interface AppParams {
	track: number;
	flight: FlightMode;
	demo: boolean;
	/** Stay on the title (captures). */
	title: boolean;
	cam: CamMode;
	ghost: boolean;
	hud: boolean;
	mute: boolean;
	fixed: boolean;
	debug: boolean;
	/** Staged camera px,py,pz,tx,ty,tz,fov while racing (captures). */
	shotCam: number[] | null;
}

const STORE = "drift-drone.v1";
/** Ticks of live (and ghost) poses kept for the photo-finish replay. */
const RING = 96;
/** Photo finish: replay the last PHOTO_TICKS at PHOTO_RATE, then hold. */
const PHOTO_TICKS = 60;
const PHOTO_RATE = 0.22;
const PHOTO_HOLD = 2.6;

function load<T>(key: string): T | null {
	try {
		const s = localStorage.getItem(`${STORE}.${key}`);
		return s ? (JSON.parse(s) as T) : null;
	} catch {
		return null;
	}
}
function drop(key: string): void {
	try {
		localStorage.removeItem(`${STORE}.${key}`);
	} catch {
		// storage unavailable
	}
}
function save(key: string, v: unknown): void {
	try {
		localStorage.setItem(`${STORE}.${key}`, JSON.stringify(v));
	} catch {
		// storage unavailable: bests just do not persist
	}
}

const _p = new Vector3();
const _q = new Quaternion();
const _gp = new Vector3();
const _gq = new Quaternion();
const _v = new Vector3();
const _t = new Vector3();
const _fwd = new Vector3();
const _h = new Vector3();
const _rp = new Vector3();
const _rq = new Quaternion();
const _hq = new Quaternion();

/** Drift Drone: screens, the fixed-tick loop (live run + ghost in lockstep) and presentation. */
export class App {
	private readonly game: Game;
	private readonly p: AppParams;
	private readonly host: PhysicsHost;
	private readonly hud: Hud | null;
	private readonly live: LiveInput;
	private readonly sfx: Sfx;
	private readonly rig: CameraRig;
	private readonly drone: DroneView;
	private readonly ghostView: DroneView;
	private readonly trail: Trail;
	private readonly ghostTrail: Trail;
	private course: CourseView | null = null;

	private screen: Screen = "title";
	private trackIdx: number;
	private mode: FlightMode;
	private sim: DroneSim;
	private bot: DroneBot | null = null;
	private readonly log = new InputLog();
	private readonly input = emptyInput();
	private acc = 0;

	private best: GhostRecord | null = null;
	private ghost: Ghost | null = null;
	private spare: Ghost | null = null;
	private ghostFade = 0;
	private readonly liveSplits: number[] = [];
	private readonly ghostSplits: number[] = [];
	private newBest = false;
	private lastBump = 0;
	private countShow = -1;
	private countT = 0;

	/** Ring of recent poses: [x, y, z, qx, qy, qz, qw] live then ghost (NaN = no ghost). */
	private readonly ring = new Float32Array(RING * 14);
	private ringHead = 0;
	private ringCount = 0;
	private photoT = 0;
	private photoFrac = 1;
	private shuttered = false;
	private resultsT = 0;
	private readonly cpu = { sim: 0, present: 0 };

	constructor(game: Game, p: AppParams, hudRoot: HTMLElement) {
		this.game = game;
		this.p = p;
		this.host = hostFromHandle(game.sim);
		this.trackIdx = p.track;
		this.mode = p.flight;
		const r = game.renderer;
		r.controller?.dispose();
		r.controller = null;
		const scene = r.three.scene;
		scene.add(r.three.camera);
		r.three.camera.near = 0.03;
		r.three.camera.updateProjectionMatrix();
		this.hud = p.hud ? new Hud(hudRoot, SITE.credit) : null;
		if (!p.hud) hudRoot.classList.add("hidden");
		this.live = new LiveInput();
		this.sfx = new Sfx(!p.mute && !p.fixed);

		this.drone = new DroneView({
			frame: "#23262c",
			canopy: "#e8ecf0",
			accent: "#ff3d7f",
			ghost: false,
		});
		this.ghostView = new DroneView({
			frame: "",
			canopy: "",
			accent: "#7fe9ff",
			ghost: true,
		});
		scene.add(this.drone.root, this.ghostView.root);
		this.ghostView.root.visible = false;
		this.trail = new Trail(scene, "#ff5c95", 54, 0.032);
		this.ghostTrail = new Trail(scene, "#5fe4ff", 54, 0.03);
		this.rig = new CameraRig(
			r.three.camera,
			SITE,
			(ox, oy, oz, dx, dy, dz, max) => {
				const w = this.sim.world;
				return w.raycast(ox, oy, oz, dx, dy, dz, max, 1, 0)
					? (this.sim.views.scratch[0] as number)
					: -1;
			},
		);
		this.rig.mode = p.cam;
		const dof = r.dof;
		dof.bokeh.value = 1.25;
		dof.backdrop.value = 16;

		this.sim = this.newSim();
		this.loadTrack();
		if (p.demo || !p.title) {
			if (p.demo) this.startRace();
			else this.toTitle();
		} else this.toTitle();
	}

	private get track(): TrackFile {
		return TRACKS[this.trackIdx] as TrackFile;
	}

	private get persist(): boolean {
		return !this.p.demo && !this.p.fixed;
	}

	private bestKey(t: TrackFile, m: FlightMode): string {
		return `best.${t.id}.${m}`;
	}

	private newSim(): DroneSim {
		return new DroneSim(this.host, this.track, SITE, this.mode);
	}

	/** (Re)builds the course view and loads the stored best for this track and mode. */
	private loadTrack(): void {
		const scene = this.game.renderer.three.scene;
		this.course?.dispose(scene);
		this.course = new CourseView(
			scene,
			this.track,
			this.sim.gates,
			SITE,
			this.p.debug,
		);
		this.hud?.setAccent(this.track.colors[0], this.track.colors[1]);
		this.loadBest();
	}

	/** The stored best for this track and mode (none in demo or fixed mode). */
	private loadBest(): void {
		this.best = null;
		if (!this.persist) return;
		const rec = acceptGhost(
			load<unknown>(this.bestKey(this.track, this.mode)),
			this.track,
			SITE,
		);
		if (rec && rec.mode === this.mode) this.best = rec;
	}

	private freeGhosts(): void {
		this.ghost?.free();
		this.spare?.free();
		this.ghost = null;
		this.spare = null;
	}

	private toTitle(): void {
		this.setScreen("title");
		this.freeGhosts();
		this.sim.free();
		this.sim = this.newSim();
		this.trail.clear();
		this.ghostTrail.clear();
		this.hud?.screen("title");
		this.refreshTitle();
	}

	private refreshTitle(): void {
		const bests = TRACKS.map((t) => {
			if (!this.persist) return null;
			const r = acceptGhost(load<unknown>(this.bestKey(t, this.mode)), t, SITE);
			return r ? r.lapTime : null;
		});
		this.hud?.titleScreen(TRACKS, this.trackIdx, this.mode, bests, SITE.name);
	}

	private startRace(): void {
		this.freeGhosts();
		this.sim.free();
		this.sim = this.newSim();
		this.bot = this.p.demo ? new DroneBot(this.sim, DEMO_BOT) : null;
		this.log.clear();
		this.acc = 0;
		this.live.resetSticks(this.mode === "acro");
		this.liveSplits.length = 0;
		this.ghostSplits.length = 0;
		this.newBest = false;
		this.ringCount = 0;
		this.photoT = 0;
		this.shuttered = false;
		this.countShow = -1;
		this.trail.clear();
		this.ghostTrail.clear();
		this.rig.reset();
		if (this.best && this.p.ghost)
			this.spare = new Ghost(this.host, this.track, SITE, this.best);
		this.setScreen("race");
		this.hud?.screen("race");
		this.hud?.raceSetup(this.track, this.mode, this.sim.gates.length);
		this.game.renderer.dof.enabled = false;
	}

	/** A lap starts: the best-lap ghost leaves the line with you. */
	private launchGhost(): void {
		this.ghost?.free();
		this.ghost = null;
		if (!this.best || !this.p.ghost) return;
		let g = this.spare && this.spare.record === this.best ? this.spare : null;
		if (g) this.spare = null;
		else g = new Ghost(this.host, this.track, SITE, this.best);
		g.arm(Number.POSITIVE_INFINITY);
		g.launch();
		this.ghost = g;
		this.ghostFade = 1;
		this.ghostTrail.clear();
		for (let i = 0; i < this.sim.gates.length; i++)
			this.ghostSplits[i] = Number.NaN;
		// the next lap's ghost catches up in the background, a few hundred ticks per frame
		this.spare?.free();
		this.spare = null;
		if (this.sim.lap < this.sim.laps - 1)
			this.spare = new Ghost(this.host, this.track, SITE, this.best);
	}

	private readonly actions: KeyAction[] = [];

	/** Every screen change goes through here: no key press survives into another screen. */
	private setScreen(s: Screen): void {
		this.screen = s;
		this.live.presses.clear();
	}

	private handleKeys(): void {
		const L = this.live;
		if (this.screen !== "race") L.pollPad();
		if (this.p.demo) {
			L.presses.clear();
			return;
		}
		const acts = screenActions(this.screen, L.presses, this.actions);
		let t = this.trackIdx;
		let m = this.mode;
		for (const a of acts) {
			if (a === "camera") {
				this.rig.mode = this.rig.mode === "chase" ? "fpv" : "chase";
				this.rig.reset();
			} else if (a === "nextTrack") t = (t + 1) % TRACKS.length;
			else if (a === "prevTrack") t = (t + TRACKS.length - 1) % TRACKS.length;
			else if (a === "toggleMode") m = m === "assisted" ? "acro" : "assisted";
			else if (a === "start" || a === "restart") this.startRace();
			else if (a === "title") this.toTitle();
			else if (a === "skip") this.toResults();
		}
		if (this.screen === "title" && (t !== this.trackIdx || m !== this.mode)) {
			const trackChanged = t !== this.trackIdx;
			this.trackIdx = t;
			this.mode = m;
			this.sim.free();
			this.sim = this.newSim();
			if (trackChanged) this.loadTrack();
			else this.loadBest();
			this.refreshTitle();
		}
	}

	/** One fixed tick: live run and ghost in lockstep. */
	private tick(): void {
		const sim = this.sim;
		if (this.bot) this.bot.next(this.input);
		else this.live.sample(this.input, this.mode === "acro", DT);
		if (sim.phase !== PHASE.FINISHED) this.log.push(this.input);
		sim.step(this.input);
		this.ghost?.step();
		this.pushRing();
		// trails
		const s = sim.pos;
		const r = sim.right;
		this.trail.push(
			s[0] as number,
			(s[1] as number) - 0.02,
			s[2] as number,
			r[0] as number,
			r[1] as number,
			r[2] as number,
		);
		const g = this.ghost;
		if (g && g.state === GHOST_STATE.FLYING) {
			const gp = g.sim.pos;
			const gr = g.sim.right;
			this.ghostTrail.push(
				gp[0] as number,
				gp[1] as number,
				gp[2] as number,
				gr[0] as number,
				gr[1] as number,
				gr[2] as number,
			);
			const ge = g.sim.events;
			for (let k = 0; k < ge.length; k++)
				if (ge.type[k] === EV.GATE) {
					const gi = ge.a[k] as number;
					if (gi === 0) continue;
					this.ghostSplits[gi] = ge.b[k] as number;
					const mine = this.liveSplits[gi];
					if (mine !== undefined && !Number.isNaN(mine))
						this.hud?.splitDelta(mine - (ge.b[k] as number));
				}
		}
		const ev = sim.events;
		for (let k = 0; k < ev.length; k++) {
			const ty = ev.type[k];
			const a = ev.a[k] as number;
			const b = ev.b[k] as number;
			if (ty === EV.COUNT) {
				this.countShow = a;
				this.countT = 1;
				this.sfx.count(a);
			} else if (ty === EV.GO) {
				this.countShow = 0;
				this.countT = 0.8;
				this.sfx.count(0);
			} else if (ty === EV.GATE) {
				this.course?.flash(a);
				this.sfx.gate();
				if (a === 0) {
					for (let i = 0; i < sim.gates.length; i++)
						this.liveSplits[i] = Number.NaN;
					if (sim.phase === PHASE.RACE) this.launchGhost();
				} else {
					this.liveSplits[a] = b;
					const gs = this.ghostSplits[a];
					if (this.ghost && gs !== undefined && !Number.isNaN(gs))
						this.hud?.splitDelta(b - gs);
				}
			} else if (ty === EV.LAP) {
				const prevBest = this.best?.lapTime ?? Number.POSITIVE_INFINITY;
				if (this.ghost && this.best)
					this.hud?.splitDelta(b - this.best.lapTime);
				if (b < prevBest) {
					this.best = recordLap(
						sim,
						SITE,
						this.log,
						a,
						this.p.demo ? "demo" : "you",
						sim.hash(),
					);
					this.newBest = true;
					if (this.persist)
						save(this.bestKey(this.track, this.mode), this.best);
					this.spare?.free();
					this.spare = null;
					this.hud?.toast(
						`Lap ${a + 1}  ${fmtTime(b)}`,
						Number.isFinite(prevBest)
							? `new best  ${fmtDelta(b - prevBest)}`
							: "best lap set · ghost armed",
						true,
					);
				} else
					this.hud?.toast(
						`Lap ${a + 1}  ${fmtTime(b)}`,
						`best ${fmtTime(prevBest)}  ${fmtDelta(b - prevBest)}`,
					);
				this.sfx.lap(b < prevBest);
			} else if (ty === EV.CRASH) {
				this.sfx.crash();
				this.rig.kick(0.5);
				this.hud?.signalLost(true);
			} else if (ty === EV.RESPAWN) {
				this.sfx.respawn();
				this.hud?.signalLost(false);
				this.trail.clear();
				this.rig.reset();
			} else if (ty === EV.BUMP) {
				if (sim.tick - this.lastBump > 8) {
					this.sfx.bump(b);
					this.rig.kick(Math.min(0.3, b * 0.06));
					this.lastBump = sim.tick;
				}
			} else if (ty === EV.FINISH) {
				// a timed-out race has no finish line to photograph
				if (sim.finishTime < 0) this.toResults();
				else this.startPhoto();
			}
		}
	}

	private pushRing(): void {
		const o = this.ringHead * 14;
		const R = this.ring;
		const s = this.sim;
		for (let i = 0; i < 3; i++) R[o + i] = s.pos[i] as number;
		for (let i = 0; i < 4; i++) R[o + 3 + i] = s.quat[i] as number;
		const g = this.ghost;
		if (g && g.state === GHOST_STATE.FLYING) {
			for (let i = 0; i < 3; i++) R[o + 7 + i] = g.sim.pos[i] as number;
			for (let i = 0; i < 4; i++) R[o + 10 + i] = g.sim.quat[i] as number;
		} else R[o + 7] = Number.NaN;
		this.ringHead = (this.ringHead + 1) % RING;
		if (this.ringCount < RING) this.ringCount++;
	}

	/** Pose `back` ticks before the newest (fractional), interpolated. Ghost = offset 7. */
	private ringPose(
		back: number,
		off: number,
		pos: Vector3,
		quat: Quaternion,
	): boolean {
		const n = this.ringCount;
		if (n === 0) return false;
		const b = Math.max(0, Math.min(n - 1, back));
		const i0 = Math.floor(b);
		const i1 = Math.min(n - 1, i0 + 1);
		const f = b - i0;
		const o0 = ((this.ringHead - 1 - i0 + RING * 2) % RING) * 14 + off;
		const o1 = ((this.ringHead - 1 - i1 + RING * 2) % RING) * 14 + off;
		const R = this.ring;
		if (Number.isNaN(R[o0] as number) || Number.isNaN(R[o1] as number))
			return false;
		pos.set(R[o0] as number, R[o0 + 1] as number, R[o0 + 2] as number);
		_rp.set(R[o1] as number, R[o1 + 1] as number, R[o1 + 2] as number);
		pos.lerp(_rp, f);
		quat.set(
			R[o0 + 3] as number,
			R[o0 + 4] as number,
			R[o0 + 5] as number,
			R[o0 + 6] as number,
		);
		_rq.set(
			R[o1 + 3] as number,
			R[o1 + 4] as number,
			R[o1 + 5] as number,
			R[o1 + 6] as number,
		);
		quat.slerp(_rq, f);
		return true;
	}

	private startPhoto(): void {
		this.setScreen("photo");
		this.photoT = 0;
		this.shuttered = false;
		// the finish line was crossed (1 - frac) of a tick before the newest pose
		this.photoFrac = Math.max(
			0,
			Math.min(1, (this.sim.raceTime - this.sim.finishTime) / DT),
		);
		const best = Math.min(...this.sim.lapTimes);
		const gr = this.ghost?.record;
		const last = this.sim.lapTimes[this.sim.lapTimes.length - 1] ?? 0;
		const vs = gr
			? `  ·  last lap vs ghost ${fmtDelta(last - gr.lapTime)}`
			: "";
		this.hud?.screen("photo");
		this.hud?.photoFinish(
			"Photo finish",
			`${fmtTime(this.sim.finishTime)}  ·  best lap ${fmtTime(best)}${vs}`,
			`${this.track.name.toUpperCase()}<br>${this.track.laps} LAPS · ${this.sim.crashes} CRASH${this.sim.crashes === 1 ? "" : "ES"}`,
		);
	}

	private toResults(): void {
		this.setScreen("results");
		this.resultsT = 0;
		this.game.renderer.dof.enabled = false;
		this.hud?.flash(0);
		let ghostLine = "";
		let ok: boolean | null = null;
		const b = this.best;
		if (b) {
			if (this.newBest) {
				const v = verifyRecord(this.host, this.track, SITE, b);
				ok = v.ok;
				ghostLine = `Best lap re-simulated from ${b.lapEnd.toLocaleString("en")} logged inputs: hash <b class="${v.ok ? "" : "bad"}">${v.hash.slice(0, 8)} ${v.ok ? "MATCH" : "MISMATCH"}</b>`;
			} else
				ghostLine = `Ghost: your best lap, ${fmtTime(b.lapTime)}, re-simulated from its inputs.`;
			const g = this.ghost;
			if (g && g.verdict() === false) {
				// it no longer reproduces its own time here (e.g. a different engine build): drop it
				ghostLine +=
					"<br>The ghost diverged on this machine, so it was discarded.";
				if (g.record === this.best) {
					this.best = null;
					if (this.persist) drop(this.bestKey(this.track, this.mode));
				}
			}
		}
		if (this.sim.finishTime < 0)
			ghostLine = `Race abandoned after ${Math.round(this.sim.raceTime / 60)} minutes.${ghostLine ? `<br>${ghostLine}` : ""}`;
		this.lastVerified = ok;
		this.hud?.screen("results");
		this.hud?.showResults({
			track: this.track,
			mode: this.mode,
			total: this.sim.finishTime,
			laps: this.sim.lapTimes,
			crashes: this.sim.crashes,
			best: b?.lapTime ?? -1,
			newBest: this.newBest,
			ghostLine,
			ghostOk: ok,
		});
	}
	private lastVerified: boolean | null = null;

	frame(dt: number): void {
		const t0 = performance.now();
		this.handleKeys();
		if (this.screen === "race" || this.screen === "results") {
			this.acc += dt;
			let n = 0;
			while (this.acc >= DT - 1e-9 && n < 5) {
				this.acc -= DT;
				this.tick();
				n++;
				if ((this.screen as Screen) === "photo") {
					this.acc = 0;
					break;
				}
			}
			if (n === 5) this.acc = 0;
		}
		if (this.spare && this.spare.state === GHOST_STATE.ARMING)
			this.spare.arm(400);
		if (this.screen === "photo") {
			this.photoT += dt;
			const replay = PHOTO_TICKS / 60 / PHOTO_RATE;
			if (this.photoT > replay + PHOTO_HOLD) this.toResults();
		}
		if (this.screen === "results") {
			this.resultsT += dt;
			if (this.p.demo && this.resultsT > 7) this.startRace();
		}
		const t1 = performance.now();
		this.present(dt);
		const t2 = performance.now();
		this.cpu.sim += (t1 - t0 - this.cpu.sim) * 0.05;
		this.cpu.present += (t2 - t1 - this.cpu.present) * 0.05;
	}

	private present(dt: number): void {
		const sim = this.sim;
		const alpha = Math.min(1, this.acc / DT);
		const v = sim.views;
		v.refresh();
		const photo = this.screen === "photo";
		const replay = PHOTO_TICKS / 60 / PHOTO_RATE;
		const photoBack = photo
			? Math.max(0, (1 - Math.min(1, this.photoT / replay)) * PHOTO_TICKS) +
				(1 - this.photoFrac)
			: 0;
		let haveLive: boolean;
		if (photo) haveLive = this.ringPose(photoBack, 0, _p, _q);
		else haveLive = readSlot(v.prev, v.curr, sim.slot, alpha, _p, _q);
		if (haveLive) {
			this.drone.root.position.copy(_p);
			this.drone.root.quaternion.copy(_q);
		}
		const armed = sim.tick >= COUNTDOWN_TICKS - 1 && sim.freeze === 0;
		this.drone.update(photo ? dt * PHOTO_RATE : dt, sim.thrust, armed);
		const fpv =
			this.rig.mode === "fpv" && this.screen === "race" && !this.p.shotCam;
		this.drone.root.visible = !fpv;
		// ghost
		const g = this.ghost;
		let ghostOn = false;
		if (photo) {
			ghostOn = this.ringPose(photoBack, 7, _gp, _gq);
		} else if (
			g &&
			(g.state === GHOST_STATE.FLYING || g.state === GHOST_STATE.ENDED)
		) {
			const gv = g.sim.views;
			gv.refresh();
			ghostOn = readSlot(
				gv.prev,
				gv.curr,
				g.sim.slot,
				g.state === GHOST_STATE.ENDED ? 1 : alpha,
				_gp,
				_gq,
			);
			if (g.state === GHOST_STATE.ENDED)
				this.ghostFade = Math.max(0, this.ghostFade - dt * 2);
			ghostOn = ghostOn && this.ghostFade > 0;
		}
		this.ghostView.root.visible = ghostOn;
		if (ghostOn) {
			this.ghostView.root.position.copy(_gp);
			this.ghostView.root.quaternion.copy(_gq);
			this.ghostView.update(dt, 0.5, true);
			// fade the ghost out when it passes the lens
			const d = _gp.distanceTo(this.rig.cam.position);
			this.ghostView.setOpacity(
				Math.max(0, Math.min(1, (d - 0.6) / 1.2)) *
					Math.min(1, this.ghostFade * 2),
			);
		}
		this.ghostTrail.mesh.visible = ghostOn && !photo;
		if (ghostOn && !photo) this.ghostTrail.rebuild(_gp.x, _gp.y, _gp.z);
		this.trail.mesh.visible =
			(this.screen === "race" || this.screen === "results") && !fpv;
		if (this.trail.mesh.visible) this.trail.rebuild(_p.x, _p.y - 0.02, _p.z);

		this.lightGates();
		this.course?.update(dt);
		this.camera(dt, photo, photoBack);
		this.hudFrame(dt);
		this.sfx.motor(
			photo ? 0 : sim.thrust,
			photo ? 0 : sim.speed(),
			armed && !photo && this.screen !== "title",
		);
	}

	private lightGates(): void {
		const c = this.course;
		if (!c) return;
		const sim = this.sim;
		const n = sim.gates.length;
		const racing = this.screen === "race" || this.screen === "photo";
		for (let i = 0; i < n; i++) {
			let l: (typeof LIGHT)[keyof typeof LIGHT] = racing
				? LIGHT.AFTER
				: i === 0
					? LIGHT.NEXT
					: LIGHT.AHEAD;
			if (racing && sim.phase !== PHASE.FINISHED) {
				if (i === sim.nextGate) l = LIGHT.NEXT;
				else if (i === (sim.nextGate + 1) % n) l = LIGHT.AHEAD;
				else if (sim.lap >= 0 && i < sim.nextGate) l = LIGHT.DONE;
			}
			c.setLight(i, l);
		}
	}

	private camera(dt: number, photo: boolean, photoBack: number): void {
		const rig = this.rig;
		const sim = this.sim;
		const dof = this.game.renderer.dof;
		const sc = this.p.shotCam;
		const t = this.track;
		if (this.screen === "title") {
			rig.sway(
				dt,
				t.view.center[0],
				t.view.center[1],
				t.view.center[2],
				t.view.radius,
				t.view.height,
				t.view.angle,
			);
			dof.enabled = false;
			return;
		}
		if (this.screen === "results") {
			rig.sway(
				dt,
				t.view.center[0],
				t.view.center[1],
				t.view.center[2],
				t.view.radius,
				t.view.height,
				t.view.angle,
			);
			dof.enabled = false;
			return;
		}
		if (photo) {
			// the finish-line camera: level with the gate, beside it on the hall side, just past the
			// line, panning with the drone on a long lens; it freezes on the crossing
			const g = sim.gates[0] as Gate;
			const side = -3.0;
			const cx = g.cx + g.rx * side + g.nx * 1.5;
			const cz = g.cz + g.rz * side + g.nz * 1.5;
			const cy = g.cy + 0.3;
			const dp = this.drone.root.position;
			const push = Math.min(1, this.photoT / (PHOTO_TICKS / 60 / PHOTO_RATE));
			const fov = 30 - push * 6;
			rig.staged(cx, cy, cz, dp.x, dp.y - 0.04, dp.z, fov);
			const cam = rig.cam;
			cam.getWorldDirection(_fwd);
			_v.subVectors(this.drone.root.position, cam.position);
			const focus = Math.max(0.5, _v.dot(_fwd));
			dof.enabled = true;
			dof.focus.value = focus;
			dof.range.value = Math.max(0.25, focus * 0.16);
			// flash and shutter on the crossing frame
			if (photoBack <= 1e-3 + (1 - this.photoFrac) && !this.shuttered) {
				this.shuttered = true;
				this.sfx.shutter();
				this.flashT = 1;
			}
			return;
		}
		dof.enabled = false;
		if (sc) {
			rig.staged(
				sc[0] ?? 0,
				sc[1] ?? 0,
				sc[2] ?? 0,
				sc[3] ?? 0,
				sc[4] ?? 0,
				sc[5] ?? 0,
				sc[6] ?? 50,
			);
			return;
		}
		if (rig.mode === "fpv") rig.fpv(_p, _q, sim.speed());
		else {
			_v.set(sim.vel[0] as number, sim.vel[1] as number, sim.vel[2] as number);
			const hist = this.ringPose(
				18 + (1 - Math.min(1, this.acc / DT)),
				0,
				_h,
				_hq,
			)
				? _h
				: null;
			rig.chase(dt, _p, sim.hfx, sim.hfz, _v, hist);
		}
	}
	private flashT = 0;

	private hudFrame(dt: number): void {
		const h = this.hud;
		if (!h) return;
		h.update(dt);
		if (this.flashT > 0) {
			this.flashT = Math.max(0, this.flashT - dt * 2.2);
			h.flash(this.flashT * 0.85);
		}
		if (this.screen !== "race") return;
		const sim = this.sim;
		const racing = sim.phase === PHASE.RACE;
		const clock =
			sim.tick < COUNTDOWN_TICKS
				? 0
				: sim.lap >= 0
					? sim.raceTime - sim.lapStart
					: sim.raceTime;
		const best = this.best
			? `BEST ${fmtTime(this.best.lapTime)}`
			: "NO BEST YET";
		h.timer(
			sim.lap,
			sim.laps,
			Math.max(0, clock),
			`RACE ${fmtTime(Math.max(0, sim.raceTime))}  ·  ${best}`,
		);
		const ng = sim.gates[sim.nextGate] as Gate;
		h.gates(
			sim.nextGate,
			sim.lap < 0 ? "Start line" : ng.name,
			racing && sim.lap >= 0,
		);
		const g = this.ghost;
		if (!this.p.ghost) h.ghostInfo("GHOST <b>OFF</b>");
		else if (g && g.state === GHOST_STATE.FLYING)
			h.ghostInfo(
				`GHOST <b>${fmtTime(g.record.lapTime)}</b><br>BEST LAP · ${g.record.by.toUpperCase()}`,
			);
		else if (this.best)
			h.ghostInfo(
				`GHOST <b>${fmtTime(this.best.lapTime)}</b><br>WAITING AT THE LINE`,
			);
		else h.ghostInfo("NO GHOST YET<br>SET A LAP TO RACE IT");
		h.osd(sim.pos[1] as number, sim.speed() * 3.6, sim.thrust);
		h.camLabel(this.rig.mode, this.mode);
		if (this.countT > 0) {
			this.countT -= dt;
			h.countdown(this.countT > 0 ? this.countShow : -1);
		} else h.countdown(-1);
		// FPV overlay: horizon from the drone's roll and pitch
		const fpv = this.rig.mode === "fpv" && !this.p.shotCam;
		const u = sim.up;
		const f = sim.fwd;
		const roll = Math.atan2(-(sim.right[1] as number), u[1] as number);
		const pitch = Math.asin(Math.max(-1, Math.min(1, f[1] as number)));
		const pxPerRad = window.innerHeight / ((this.rig.cam.fov * Math.PI) / 180);
		h.fpvOverlay(fpv, -roll, (pitch + 0.38) * pxPerRad);
		// next gate arrow when it is off screen
		const cam = this.rig.cam;
		_t.set(ng.cx, ng.cy, ng.cz);
		cam.getWorldDirection(_fwd);
		_v.subVectors(_t, cam.position);
		const behind = _v.dot(_fwd) < 0;
		_t.project(cam);
		let x = _t.x;
		let y = _t.y;
		if (behind) {
			x = -x;
			y = -y;
		}
		const off = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.95;
		if (off && sim.freeze === 0 && sim.phase !== PHASE.FINISHED) {
			const m = Math.max(Math.abs(x), Math.abs(y), 1e-3);
			const ex = (x / m) * 0.88;
			const ey = (y / m) * 0.82;
			const W = window.innerWidth;
			const H = window.innerHeight;
			h.gateArrow(
				true,
				(ex * 0.5 + 0.5) * W,
				(-ey * 0.5 + 0.5) * H,
				Math.atan2(x, y),
			);
		} else h.gateArrow(false);
	}

	probe(): Record<string, unknown> {
		const s = this.sim;
		return {
			screen: this.screen,
			track: this.track.id,
			mode: this.mode,
			phase: ["countdown", "race", "finished"][s.phase],
			tick: s.tick,
			lap: s.lap,
			nextGate: s.nextGate,
			laps: s.lapTimes.map((t) => Math.round(t * 1000) / 1000),
			finish: s.finishTime,
			crashes: s.crashes,
			best: this.best?.lapTime ?? null,
			ghost: this.ghost
				? ["arming", "parked", "flying", "ended"][this.ghost.state]
				: null,
			verified: this.lastVerified,
			pos: [s.pos[0], s.pos[1], s.pos[2]].map(
				(v) => Math.round((v as number) * 100) / 100,
			),
			speed: Math.round(s.speed() * 100) / 100,
			inputs: this.log.length,
			hash: s.hash(),
			bot: this.bot?.current ?? null,
			cpu: { sim: this.cpu.sim, present: this.cpu.present },
		};
	}
}
