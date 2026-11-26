import { readSlot } from "@pebble3d/renderer";
import type { Game } from "@pebble3d/sdk/game";
import {
	Color,
	type Material,
	type Mesh,
	type Object3D,
	Quaternion,
	Vector3,
} from "three/webgpu";
import { Sfx } from "./audio/sfx.ts";
import { Bot, type BotTune, DEFAULT_BOT } from "./bot.ts";
import { COUNTDOWN_TICKS, DT, TICK_HZ } from "./constants.ts";
import { COURSES, type Course } from "./courses.ts";
import { EV } from "./events.ts";
import {
	acceptGhost,
	Ghost,
	type GhostRecord,
	recordOf,
	verifyRecord,
} from "./ghost.ts";
import { emptyInput, InputLog } from "./input.ts";
import { LiveInput } from "./live-input.ts";
import { parGhost } from "./par.ts";
import { hostFromHandle, type PhysicsHost } from "./physics.ts";
import { MarbleSim, PHASE, PHASE_NAMES } from "./sim.ts";
import { Track } from "./track.ts";
import { type GhostMode, Hud } from "./ui/hud.ts";
import { CameraRig } from "./view/camera-rig.ts";
import { Ribbon, SpeedLines } from "./view/fx.ts";
import {
	createGhost,
	createMarble,
	type GhostLook,
	SKINS,
	type Skin,
} from "./view/marbles.ts";
import { Sparks } from "./view/sparks.ts";
import { TrackView } from "./view/track-view.ts";

export interface AppParams {
	course: string;
	demo: boolean;
	/** Stay on the title screen (captures). */
	title: boolean;
	skin: Skin;
	ghost: GhostMode;
	seed: number | undefined;
	hud: boolean;
	mute: boolean;
	camAngle: number | undefined;
	camDist: number | undefined;
	/** Demo driver: fast (default), par or slow. */
	bot: string;
	/** Demo runs may save a best ghost (smoke test of the save -> race-your-best path). */
	save: boolean;
}

type Screen = "title" | "race" | "results";

const STORE = "ghostline.v1";
/** The demo driver is a bolder bot than par, so it visibly races the par ghost. */
const DEMO_BOTS: Record<string, BotTune> = {
	fast: { ...DEFAULT_BOT, grip: 17, vmax: 44 },
	par: DEFAULT_BOT,
	slow: { ...DEFAULT_BOT, grip: 11, vmax: 32 },
};

function load<T>(key: string): T | null {
	try {
		const s = localStorage.getItem(`${STORE}.${key}`);
		return s ? (JSON.parse(s) as T) : null;
	} catch {
		return null;
	}
}
function save(key: string, v: unknown): void {
	try {
		localStorage.setItem(`${STORE}.${key}`, JSON.stringify(v));
	} catch {
		// storage unavailable (private mode): bests just do not persist
	}
}

/** Frees the GPU resources of an app-built object (marble skins). */
function disposeTree(root: Object3D): void {
	root.traverse((o) => {
		const m = o as Mesh;
		if (!m.isMesh) return;
		m.geometry.dispose();
		const mats = Array.isArray(m.material) ? m.material : [m.material];
		for (const mat of mats as Material[]) mat.dispose();
	});
}

function drop(key: string): void {
	try {
		localStorage.removeItem(`${STORE}.${key}`);
	} catch {
		// storage unavailable
	}
}

/**
 * The stored best for a course, or null. Corrupt, foreign or stale records (recorded under a
 * different course or sim fingerprint) are removed so they cannot shadow a new best.
 */
function loadBest(course: Course): GhostRecord | null {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(`${STORE}.best.${course.id}`);
	} catch {
		return null;
	}
	if (raw === null) return null;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// fall through: rejected below
	}
	const rec = acceptGhost(parsed, course);
	if (!rec) drop(`best.${course.id}`);
	return rec;
}

const _pos = new Vector3();
const _quat = new Quaternion();
const _vel = new Vector3();
const _gpos = new Vector3();
const _fly = new Vector3();

/** Ghostline: screens, the fixed-tick loop (live run + ghost in lockstep), and presentation. */
export class App {
	private readonly game: Game;
	private readonly p: AppParams;
	private readonly host: PhysicsHost;
	private readonly course: Course;
	private readonly track: Track;
	private readonly view: TrackView;
	private readonly rig: CameraRig;
	private readonly hud: Hud | null;
	private readonly sfx: Sfx;
	private readonly live: LiveInput;
	private readonly speedLines: SpeedLines;
	private readonly ribbon: Ribbon;
	private readonly sparks: Sparks;
	private readonly accent: Color;
	private readonly white = new Color("#fff4e0");
	private marble = createMarble("glass");
	private readonly ghostLook: GhostLook;
	private skin: Skin;
	private mode: GhostMode;
	private screen: Screen = "title";
	private sim: MarbleSim;
	private ghost: Ghost | null = null;
	private bot: Bot | null = null;
	private readonly log = new InputLog();
	private readonly input = emptyInput();
	private acc = 0;
	private boostGlow = 0;
	private ribbonTick = 0;
	private lastVerify: { ok: boolean; ms: number } | null = null;
	private ghostChecked = false;
	private readonly cpu = { sim: 0, present: 0 };

	constructor(game: Game, p: AppParams, hudRoot: HTMLElement) {
		this.game = game;
		this.p = p;
		this.host = hostFromHandle(game.sim);
		const course = COURSES.find((c) => c.id === p.course);
		if (!course) throw new Error(`unknown course "${p.course}"`);
		this.course = course;
		this.track = new Track(course.track);
		this.skin = p.skin;
		this.mode = p.ghost;

		const r = game.renderer;
		r.controller?.dispose();
		r.controller = null;
		const scene = r.three.scene;
		scene.environmentIntensity *= course.look.envIntensity ?? 1;
		scene.add(r.three.camera);
		r.three.camera.far = 4000;
		r.three.camera.updateProjectionMatrix();

		this.view = new TrackView(this.track, course.look);
		scene.add(this.view.root);
		// ?hide=ground,pillars,piece,gate,pad hides course parts (look-dev / debugging)
		const hide = new Set(
			(new URLSearchParams(location.search).get("hide") ?? "").split(","),
		);
		for (const o of this.view.root.children)
			if (hide.has(o.name)) o.visible = false;
		["deck", "walls", "rails", "hull"].forEach((k, i) => {
			const m = this.view.materials[i];
			if (m && hide.has(k)) m.visible = false;
		});
		this.setSkin(this.skin);
		this.ghostLook = createGhost();
		scene.add(this.ghostLook.group);
		this.ghostLook.group.visible = false;
		this.ribbon = new Ribbon(scene, "#5fe3ff");
		this.sparks = new Sparks(scene);
		this.accent = new Color(course.look.accent);
		this.speedLines = new SpeedLines(r.three.camera, "#e8f6ff");
		this.rig = new CameraRig(r.three.camera);
		if (p.camDist !== undefined) this.rig.distBase = p.camDist;
		this.sfx = new Sfx(!p.mute);
		this.live = new LiveInput();
		this.sim = this.newSim();

		const bests: Record<string, number | null> = {};
		for (const c of COURSES) bests[c.id] = loadBest(c)?.finishTime ?? null;
		this.hud = p.hud
			? new Hud(hudRoot, COURSES, course, this.skin, this.mode, bests, {
					onStart: () => this.startRace(),
					onCourse: (id) => this.gotoCourse(id, true),
					onSkin: (s) => {
						this.setSkin(s);
						this.sfx.ui();
					},
					onGhostMode: (m) => {
						this.mode = m;
						save("mode", m);
						this.hud?.setGhostMode(m);
						this.sfx.ui();
					},
					onRetry: () => this.startRace(),
					onNext: () => this.nextCourse(),
					onMenu: () => this.toTitle(),
				})
			: null;
		if (p.demo && !p.title) this.startRace();
		else this.toTitle();
	}

	private seedFor(rec: GhostRecord | null): number {
		return rec?.seed ?? this.p.seed ?? 1;
	}

	private ghostRecord(): GhostRecord | null {
		if (this.mode === "off") return null;
		if (this.mode === "best") {
			const b = loadBest(this.course);
			if (b) return b;
		}
		return parGhost(this.course.id);
	}

	private newSim(seed = this.seedFor(this.ghostRecord())): MarbleSim {
		return new MarbleSim(this.host, this.course, this.track, seed);
	}

	private setSkin(s: Skin): void {
		this.skin = s;
		save("skin", s);
		const scene = this.game.renderer.three.scene;
		const old = this.marble;
		this.marble = createMarble(s);
		this.marble.position.copy(old.position);
		this.marble.quaternion.copy(old.quaternion);
		scene.remove(old);
		disposeTree(old);
		scene.add(this.marble);
		this.hud?.setSkin(s);
	}

	private gotoCourse(id: string, title: boolean): void {
		if (id === this.course.id && title) return;
		const q = new URLSearchParams(location.search);
		q.set("course", id);
		if (title) q.set("title", "1");
		else q.delete("title");
		location.search = q.toString();
	}

	private nextCourse(): void {
		const i = COURSES.findIndex((c) => c.id === this.course.id);
		const n = COURSES[(i + 1) % COURSES.length];
		if (n) this.gotoCourse(n.id, false);
	}

	private toTitle(): void {
		this.screen = "title";
		// keys pressed during the race (WASD, Space...) must not act on the title
		this.live.clearPressed();
		this.hud?.hideResults();
		this.hud?.showRace(false);
		this.hud?.showTitle(true);
		this.ghostLook.group.visible = false;
		this.ribbon.clear();
		this.rig.reset();
		if (this.sim.tick > 0) {
			this.ghost?.free();
			this.ghost = null;
			this.sim.free();
			this.sim = this.newSim();
		}
	}

	startRace(): void {
		this.sfx.ui();
		this.hud?.hideResults();
		this.hud?.showTitle(false);
		this.hud?.showRace(true);
		this.ghost?.free();
		this.ghost = null;
		let rec = this.ghostRecord();
		// A record that validated can still fail to build; never let it block racing:
		// drop a bad best and fall back to par (then to no ghost).
		for (let attempt = 0; rec && !this.ghost && attempt < 2; attempt++) {
			try {
				this.ghost = new Ghost(this.host, this.course, this.track, rec);
			} catch {
				if (rec.by !== "par") drop(`best.${this.course.id}`);
				rec = rec.by === "par" ? null : parGhost(this.course.id);
			}
		}
		if (!this.ghost) rec = null;
		if (this.sim.tick > 0 || this.sim.seed !== this.seedFor(rec)) {
			this.sim.free();
			this.sim = this.newSim(this.seedFor(rec));
		}
		this.ghostChecked = false;
		this.hud?.resetRace();
		if (rec) {
			this.hud?.ghost(
				rec.by === "par" ? "Par ghost" : "Your best",
				`${rec.finishTime.toFixed(2)} s · seed ${rec.seed} · ${rec.ticks} inputs · live re-sim`,
			);
		} else this.hud?.ghost(null, "");
		this.ghostLook.group.visible = rec !== null;
		this.ribbon.clear();
		this.bot = this.p.demo
			? new Bot(this.sim, DEMO_BOTS[this.p.bot] ?? DEMO_BOTS.fast)
			: null;
		this.log.clear();
		this.acc = 0;
		this.lastVerify = null;
		this.screen = "race";
		this.rig.reset();
		this.live.clearPressed();
	}

	/** Once the ghost has replayed its whole log, check it reproduced its recorded hash. */
	private checkGhost(): void {
		const g = this.ghost;
		if (!g || this.ghostChecked || !g.ended) return;
		this.ghostChecked = true;
		const r = g.record;
		const ok = g.verdict();
		this.hud?.ghost(
			r.by === "par" ? "Par ghost" : "Your best",
			ok
				? `${r.finishTime.toFixed(2)} s · seed ${r.seed} · re-sim matched ${r.hash.slice(0, 8)}`
				: "re-simulation DIVERGED from the recorded run",
		);
		if (!ok)
			console.info(`ghostline: ghost diverged (${g.sim.hash()} != ${r.hash})`);
	}

	private finishRun(): void {
		const sim = this.sim;
		const rec = recordOf(sim, this.log, "you");
		const finished = sim.finishTime > 0;
		// integrity check: re-simulate the run we just logged on a fresh world, headless
		// (skipped for a DNF: it cannot become a best, and a 5-minute log would hitch)
		const t0 = performance.now();
		const v = finished
			? verifyRecord(this.host, this.course, this.track, rec)
			: { ok: false, hash: rec.hash, finishTime: -1 };
		const ms = performance.now() - t0;
		this.lastVerify = finished ? { ok: v.ok, ms } : null;
		const prev = loadBest(this.course);
		const newBest =
			finished &&
			(!this.p.demo || this.p.save) &&
			v.ok &&
			(!prev || rec.finishTime < prev.finishTime);
		if (newBest) save(`best.${this.course.id}`, rec);
		const m = this.course.medals;
		const t = sim.finishTime;
		const medal = !finished
			? 3
			: t <= m.gold
				? 0
				: t <= m.silver
					? 1
					: t <= m.bronze
						? 2
						: 3;
		if (finished) this.sfx.finish(medal);
		const g = this.ghost?.record ?? null;
		this.hud?.results({
			time: finished ? t : sim.clock(),
			medal,
			newBest,
			ghostLabel: g ? (g.by === "par" ? "par" : "your best") : null,
			ghostTime: g?.finishTime ?? null,
			splits: sim.splits,
			ghostSplits: g?.splits ?? null,
			respawns: sim.respawns,
			verify: !finished
				? null
				: {
						ok: v.ok,
						ticks: rec.ticks,
						hash: v.hash,
						ms,
						bytes: rec.inputs.length,
					},
			hasNext: true,
		});
		this.screen = "results";
		this.hud?.showRace(false);
		this.live.clearPressed();
	}

	private handleKeys(): void {
		const L = this.live;
		if (this.screen === "title") {
			const i = COURSES.findIndex((c) => c.id === this.course.id);
			if (L.took("Enter") || L.took("Space")) this.startRace();
			else if (L.took("ArrowRight") || L.took("KeyD"))
				this.gotoCourse((COURSES[(i + 1) % COURSES.length] as Course).id, true);
			else if (L.took("ArrowLeft") || L.took("KeyA"))
				this.gotoCourse(
					(COURSES[(i + COURSES.length - 1) % COURSES.length] as Course).id,
					true,
				);
			else if (
				L.took("ArrowUp") ||
				L.took("ArrowDown") ||
				L.took("KeyW") ||
				L.took("KeyS")
			) {
				const k = SKINS.indexOf(this.skin);
				this.setSkin(SKINS[(k + 1) % SKINS.length] as Skin);
			} else if (L.took("KeyG")) {
				const order: GhostMode[] = ["best", "par", "off"];
				this.mode = order[(order.indexOf(this.mode) + 1) % 3] as GhostMode;
				save("mode", this.mode);
				this.hud?.setGhostMode(this.mode);
			}
			return;
		}
		if (L.took("Escape")) {
			this.toTitle();
			return;
		}
		if (L.took("KeyR")) {
			this.startRace();
			return;
		}
		if (this.screen === "results") {
			if (L.took("Enter")) this.startRace();
			else if (L.took("KeyN")) this.nextCourse();
		}
	}

	/** One fixed tick: live run and ghost step together. */
	private tick(): void {
		const sim = this.sim;
		const cam = this.rig.cam;
		if (this.bot) this.bot.next(this.input);
		else {
			cam.getWorldDirection(_fly);
			const l = Math.hypot(_fly.x, _fly.z) || 1;
			this.live.sample(this.input, _fly.x / l, _fly.z / l, DT);
		}
		if (sim.phase === PHASE.DONE) return;
		this.log.push(this.input);
		sim.step(this.input);
		this.ghost?.step();
		this.checkGhost();
		const ev = sim.events;
		for (let k = 0; k < ev.length; k++) {
			const ty = ev.type[k];
			const a = ev.a[k] as number;
			const b = ev.b[k] as number;
			if (ty === EV.COUNT) this.sfx.count();
			else if (ty === EV.GO) {
				this.sfx.go();
			} else if (ty === EV.CHECKPOINT) {
				const gs = this.ghost?.record.splits[a];
				const delta = gs !== undefined ? b - gs : null;
				this.hud?.split(delta, b);
				this.hud?.setPips(a + 1);
				this.sfx.checkpoint(delta === null ? null : delta <= 0);
				this.burstAtMarble(24, 0.3, 6, 1.4, this.accent, 3);
				const glow = this.view.gateGlow[a];
				if (glow) glow.color.set("#ffffff");
			} else if (ty === EV.BOOST) {
				this.boostGlow = 1;
				this.burstAtMarble(28, -1, 7, 0.5, this.accent, 4);
				this.hud?.flash();
				this.sfx.boost();
				this.rig.kick(0.25);
			} else if (ty === EV.JUMP) this.sfx.jump();
			else if (ty === EV.LAND) {
				this.sfx.land(b);
				if (b > 2)
					this.burstAtMarble(
						Math.min(30, Math.round(b * 3)),
						0,
						3 + b * 0.4,
						1.2,
						this.white,
						2.5,
					);
				this.rig.kick(Math.min(0.5, b * 0.05));
			} else if (ty === EV.RESPAWN) {
				this.sfx.respawn();
				this.rig.reset();
			} else if (ty === EV.FINISH) {
				const g = this.ghost?.record.finishTime;
				this.hud?.split(g !== undefined && g > 0 ? b - g : null, b);
				this.hud?.setPips(this.track.checkpoints.length + 1);
				this.rig.orbitAngle = 0;
			}
		}
		if (this.ghost && ++this.ribbonTick % 2 === 0) {
			const gp = this.ghost.sim.pos;
			this.ribbon.push(gp[0] as number, gp[1] as number, gp[2] as number);
		}
		if ((sim.phase as number) === PHASE.DONE && this.screen === "race")
			this.finishRun();
	}

	/** Sparks from the marble's contact patch: backwards (dir -1), radial (0) or forwards. */
	private burstAtMarble(
		n: number,
		dir: number,
		speed: number,
		spread: number,
		c: Color,
		k: number,
	): void {
		const s = this.sim;
		const p = s.pos;
		const sp = s.speed() || 1;
		this.sparks.burst(
			n,
			p[0] as number,
			(p[1] as number) - 0.4,
			p[2] as number,
			((s.vel[0] as number) / sp) * dir,
			0.6,
			((s.vel[2] as number) / sp) * dir,
			speed,
			spread,
			c,
			k,
		);
	}

	frame(dt: number): void {
		const t0 = performance.now();
		this.handleKeys();
		if (this.screen !== "title") {
			this.acc += dt;
			let n = 0;
			while (this.acc >= DT - 1e-9 && n < 5) {
				this.acc -= DT;
				this.tick();
				n++;
			}
			if (n === 5) this.acc = 0;
		}
		const t1 = performance.now();
		this.present(dt, Math.min(1, this.acc / DT));
		const t2 = performance.now();
		this.cpu.sim += (t1 - t0 - this.cpu.sim) * 0.05;
		this.cpu.present += (t2 - t1 - this.cpu.present) * 0.05;
	}

	private present(dt: number, alpha: number): void {
		const sim = this.sim;
		const v = sim.views;
		v.refresh();
		readSlot(v.prev, v.curr, sim.marbleSlot, alpha, _pos, _quat);
		this.marble.position.copy(_pos);
		this.marble.quaternion.copy(_quat);
		_vel.set(sim.vel[0] as number, sim.vel[1] as number, sim.vel[2] as number);
		// sweepers follow their kinematic bodies
		const meshes = this.view.sweeperMeshes;
		for (let k = 0; k < meshes.length; k++) {
			const s = sim.sweepers[k];
			const m = meshes[k];
			if (!s || !m) continue;
			if (
				readSlot(v.prev, v.curr, sim.world.slotOf(s.id), alpha, _gpos, _quat)
			) {
				m.matrix.compose(_gpos, _quat, m.scale);
				m.matrixWorldNeedsUpdate = true;
			}
		}
		// ghost
		const g = this.ghost;
		if (g) {
			const gv = g.sim.views;
			gv.refresh();
			readSlot(gv.prev, gv.curr, g.sim.marbleSlot, alpha, _gpos, _quat);
			this.ghostLook.group.position.copy(_gpos);
			// fade the ghost near your marble and near the lens (it must never hide the view)
			const d = _gpos.distanceTo(_pos);
			const dc = _gpos.distanceTo(this.rig.cam.position);
			this.ghostLook.opacity.value =
				Math.min(1, Math.max(0.15, (d - 0.6) / 3)) *
				Math.min(1, Math.max(0, (dc - 2.5) / 5));
			this.ribbon.opacity.value = this.ghostLook.opacity.value;
			this.ribbon.update(this.rig.cam.position, _gpos.x, _gpos.y, _gpos.z);
			const gap = (g.sim.progress - sim.progress) * 0.5;
			this.hud?.ghostGapMetres(sim.phase === PHASE.RUN ? gap : null);
		} else this.ribbon.update(this.rig.cam.position, 0, 0, 0);

		// camera
		const t = this.track;
		if (this.screen === "title") {
			const b = t.bounds;
			const ext = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
			this.rig.overview(
				dt,
				(b.min[0] + b.max[0]) / 2,
				(b.min[1] + b.max[1]) / 2,
				(b.min[2] + b.max[2]) / 2,
				ext * 0.85,
				ext * 0.42,
			);
		} else if (sim.phase === PHASE.COUNTDOWN) {
			this.rig.update(
				dt,
				"intro",
				_pos,
				_vel,
				t,
				sim.progress,
				0,
				sim.tick / 150,
			);
		} else if (sim.phase === PHASE.RUN) {
			if (this.p.camAngle !== undefined) this.rig.orbitAngle = this.p.camAngle;
			this.rig.update(
				dt,
				"chase",
				_pos,
				_vel,
				t,
				sim.progress,
				this.bot ? 0 : this.live.steer,
			);
		} else this.rig.update(dt, "orbit", _pos, _vel, t, sim.progress, 0);

		const speed = sim.speed();
		this.boostGlow = Math.max(0, this.boostGlow - dt * 1.4);
		this.speedLines.update(
			dt,
			sim.phase === PHASE.RUN ? speed : 0,
			this.boostGlow,
		);
		this.sfx.roll(speed, sim.grounded, this.screen === "race");
		for (const glow of this.view.gateGlow)
			glow.color.lerp(this.view.accent, Math.min(1, dt * 2));
		if (this.hud) {
			// 3-2-1-GO from the sim clock (frame-rate independent, capture friendly)
			const c = COUNTDOWN_TICKS - sim.tick;
			if (this.screen !== "race") this.hud.countdown(null, 0);
			else if (c > 0)
				this.hud.countdown(
					String(Math.ceil(c / TICK_HZ)),
					1 - ((c - 1) % TICK_HZ) / TICK_HZ,
				);
			else if (c > -45) this.hud.countdown("GO", -c / 45);
			else this.hud.countdown(null, 0);
		}
		if (this.hud && this.screen === "race") {
			this.hud.setClock(sim.clock());
			this.hud.setSpeed(speed);
			this.hud.tickSplit(dt);
		}
	}

	/** Automation hook (window.__pebble3d.game). */
	probe(): Record<string, unknown> {
		const s = this.sim;
		return {
			screen: this.screen,
			course: this.course.id,
			phase: PHASE_NAMES[s.phase],
			tick: s.tick,
			clock: s.clock(),
			speed: s.speed(),
			progress: s.progress,
			splits: s.splits.slice(),
			respawns: s.respawns,
			hash: s.hash(),
			inputs: this.log.length,
			ghost: this.ghost
				? {
						by: this.ghost.record.by,
						verdict: this.ghost.verdict(),
						tick: this.ghost.sim.tick,
						hash: this.ghost.sim.hash(),
						progress: this.ghost.sim.progress,
						finishTime: this.ghost.sim.finishTime,
					}
				: null,
			verify: this.lastVerify,
			cpu: { simMs: this.cpu.sim, presentMs: this.cpu.present },
			tickHz: TICK_HZ,
		};
	}

	static savedSkin(): Skin | null {
		const s = load<string>("skin");
		return SKINS.includes(s as Skin) ? (s as Skin) : null;
	}
	static savedMode(): GhostMode | null {
		const m = load<string>("mode");
		return m === "best" || m === "par" || m === "off" ? m : null;
	}
}
