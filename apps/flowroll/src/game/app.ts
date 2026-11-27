/**
 * Flowroll's app: title → (tutorial) → intro → roll → finish replay → results → rematch.
 * Owns the fixed-tick loop (60 Hz, input log per tick), the CPU seats, presentation-only
 * hit-stop, and everything on screen. The sim (sim.ts) never sees any of this.
 */
import type { Game } from "@pebble3d/sdk/game";
import { Vector3 } from "three/webgpu";
import { Sfx } from "./audio/sfx.ts";
import { BELTS, type Belt, Cpu } from "./cpu.ts";
import {
	correctCounter,
	DIR_KEYS,
	type Dir,
	MOVES,
	type MoveRef,
	minGrip,
	POSITIONS,
	type PositionDef,
	type Role,
} from "./graph.ts";
import { InputLog } from "./input.ts";
import { Keys } from "./keys.ts";
import {
	ACT,
	DT,
	EV,
	MatchSim,
	PHASE,
	PHASE_NAMES,
	TICK_HZ,
	TUNE,
} from "./sim.ts";
import { TUT_STEPS, Tutorial } from "./tutorial.ts";
import {
	Hud,
	keycap,
	type MenuItem,
	type PanelData,
	type Row,
} from "./ui/hud.ts";
import { Academy, BELT_COLORS, PALETTE } from "./view/academy.ts";
import type { V } from "./view/body.ts";
import { Cam } from "./view/camera.ts";
import { Dust } from "./view/dust.ts";
import { Gallery } from "./view/gallery.ts";
import { Mannequin } from "./view/mannequin.ts";
import { Rig } from "./view/rig.ts";

export interface AppParams {
	demo: boolean;
	title: boolean;
	belt: Belt;
	belt2: Belt;
	versus: boolean;
	tutorial: boolean;
	roundSec: number;
	seed: number;
	pose: string | null;
	view: string;
	hud: boolean;
	dof: boolean;
	mute: boolean;
	fixed: boolean;
}

type Scr =
	| "title"
	| "tutorial"
	| "play"
	| "over"
	| "replay"
	| "results"
	| "gallery";

const COLORS = ["#f2efe8", "#6f95ff"] as const;
const BELT_LABEL: Record<Belt, string> = {
	white: "White belt",
	blue: "Blue belt",
	black: "Black belt",
};
/** Colours per position for the results timeline. */
const POS_COLORS: Record<string, string> = {
	standing: "#9a9488",
	closedGuard: "#7fb3d5",
	halfGuard: "#8fd1b8",
	sideControl: "#e7c26a",
	kneeOnBelly: "#f0a35a",
	mount: "#ec7b5a",
	back: "#d65a7a",
	armbar: "#c04848",
	triangle: "#c04848",
	kimura: "#c04848",
	rnc: "#c04848",
};
/** What the defender sees during a telegraph, before the move's name is revealed. */
const TELL_TEXT: Record<string, string> = {
	levelChange: "drops their level",
	reapLeg: "steps to the outside",
	sitBack: "sits their weight back",
	standUp: "stands up in posture",
	stack: "drives forward",
	scissor: "slides a knee across",
	hipUp: "lifts the hips",
	legShoot: "shoots a leg high",
	kneeSlide: "angles the knee",
	figureFour: "reaches for the arm",
	underhook: "digs an underhook",
	kneeIn: "pulls a knee in",
	duckUnder: "ducks the head",
	stepOver: "lifts a leg",
	kneeUp: "pops the hips up",
	shrimp: "frames and shrimps",
	legPummel: "pummels a leg",
	spinArm: "isolates an arm",
	turnIn: "turns their shoulders",
	sitHigh: "sits up high",
	bridge: "bridges hard",
	armUnder: "snakes an arm under",
	shoulderWalk: "walks the shoulders",
};

const _v = new Vector3();
const _c: V = [0, 0, 0];
const _h: V = [0, 0, 0];

export class App {
	private readonly game: Game;
	private readonly p: AppParams;
	private readonly hud: Hud | null;
	private readonly sfx: Sfx;
	private readonly keys = new Keys();
	private readonly cam: Cam;
	private readonly rig = new Rig();
	private readonly bodies: [Mannequin, Mannequin];
	private readonly academy: Academy;
	private readonly dust: Dust;
	private gallery: Gallery | null = null;
	private scr: Scr = "title";
	private paused = false;
	private sim: MatchSim;
	private cpus: (Cpu | null)[] = [null, null];
	private readonly log = new InputLog();
	private tut: Tutorial | null = null;
	private acc = 0;
	private freeze = 0;
	private overT = 0;
	private resultsT = 0;
	private matchSeed: number;
	private matchCount = 0;
	private menuSel = 0;
	private beltSel: number;
	private versus: boolean;
	private flash = [0, 0];
	private replay: {
		sim: MatchSim;
		log: InputLog;
		from: number;
		acc: number;
		verified: boolean | null;
		live: string;
	} | null = null;
	private finished: MatchSim | null = null;
	private stats = {
		launches: [0, 0],
		landed: [0, 0],
		subs: [0, 0],
		counters: [0, 0],
	};
	private readonly cpuMs = { sim: 0, present: 0 };
	private dof = false;
	private readonly gripBefore = [0, 0];
	private readonly panelSigs = [-1, -1];

	/** A number that changes whenever a player's panel rows would. */
	private panelSig(s: MatchSim, p: number): number {
		const role: Role = s.pos === 0 ? "top" : s.roleOf(p);
		let avail = 0;
		const moves = s.position.roles[role].moves;
		for (let i = 0; i < moves.length; i++)
			if ((s.grip[p] as number) >= (moves[i] as { grip: number }).grip)
				avail |= 1 << i;
		let k = s.pos;
		k = k * 2 + s.top;
		k = k * 3 + s.phase;
		k = k * 3 + s.act;
		k = k * 3 + (s.actor + 1);
		k = k * 8 + (s.counter + 1);
		k = k * 64 + (s.move + 1);
		k = k * 2 + (s.settle > 0 ? 1 : 0);
		k = k * 2 + ((s.recover[p] as number) > 0 ? 1 : 0);
		k = k * 16 + avail;
		k = k * 2 + (this.scr === "replay" ? 1 : 0);
		return k + this.matchCount * 1e12;
	}
	private replayLock = 0;

	constructor(game: Game, p: AppParams, hudRoot: HTMLElement) {
		this.game = game;
		this.p = p;
		this.matchSeed = p.seed;
		this.versus = p.versus;
		this.beltSel = BELTS.indexOf(p.belt);
		const r = game.renderer;
		r.controller?.dispose();
		r.controller = null;
		const scene = r.three.scene;
		scene.add(r.three.camera);
		r.three.camera.near = 0.05;
		r.three.camera.far = 60;
		r.three.camera.updateProjectionMatrix();
		(
			scene as unknown as { environmentIntensity: number }
		).environmentIntensity = 0.22;
		this.academy = new Academy(scene);
		this.dust = new Dust(scene);
		this.cam = new Cam(r.three.camera);
		this.bodies = [
			new Mannequin({
				gi: PALETTE.giWhite,
				belt: BELT_COLORS[p.belt] as string,
			}),
			new Mannequin({
				gi: PALETTE.giBlue,
				belt: BELT_COLORS[p.belt] as string,
				bar: "#c22a22",
			}),
		];
		scene.add(this.bodies[0].root, this.bodies[1].root);
		this.sfx = new Sfx(!p.mute);
		this.hud = p.hud ? new Hud(hudRoot) : null;
		if (this.hud) this.hud.onMenu = (i) => this.pick(i);
		this.sim = this.attract();
		if (p.pose) {
			this.scr = "gallery";
			this.bodies[0].root.visible = false;
			this.bodies[1].root.visible = false;
			this.gallery = new Gallery(scene, p.pose, r.three.camera, p.view);
			this.hud?.show("play");
			this.hud?.setPanel(0, null);
			this.hud?.setPanel(1, null);
			return;
		}
		// pause when the tab is hidden so time does not pile up (not in fixed-mode captures)
		document.addEventListener("visibilitychange", () => {
			if (
				document.hidden &&
				!p.fixed &&
				(this.scr === "play" || this.scr === "over") &&
				!this.paused
			) {
				this.paused = true;
				this.hud?.show("pause");
			}
		});
		if (p.tutorial) this.startTutorial();
		else if ((p.demo || p.versus) && !p.title) this.startMatch();
		else this.toTitle();
	}

	// ---------- seats ----------

	/** True when a seat is driven by the CPU (or the tutorial partner), not a player. */
	private isCpu(p: number): boolean {
		return !!this.cpus[p] || (!!this.tut && (p === 1 || this.p.demo));
	}

	/** CPU seats only: "Partner · Blue belt" and the belt colour; null on human seats. */
	private cpuBelt(p: number): { label: string; color: string } | null {
		if (!this.isCpu(p)) return null;
		const belt: Belt = this.p.demo
			? p === 0
				? this.p.belt2
				: this.p.belt
			: (BELTS[this.beltSel] as Belt);
		const who = this.p.demo ? "CPU" : "Partner";
		return {
			label: `${who} · ${BELT_LABEL[belt]}`,
			color: BELT_COLORS[belt] as string,
		};
	}

	/** The grip / beat / squeeze key a human seat presses; "" for CPU seats. */
	private gripKey(p: number): string {
		if (this.isCpu(p)) return "";
		return p === 0 ? "J" : "1 / ,";
	}

	// ---------- screens ----------

	private attract(): MatchSim {
		const s = new MatchSim({ seed: this.matchSeed ^ 0x51ed, introTicks: 30 });
		this.cpus = [new Cpu(0, "blue", s.seed), new Cpu(1, "blue", s.seed)];
		return s;
	}

	private menuItems(): MenuItem[] {
		const b = BELTS[this.beltSel] as Belt;
		return [
			{
				label: "Roll with a partner",
				note: `◂ ${BELT_LABEL[b]} ▸`,
				chip: BELT_COLORS[b],
			},
			{ label: "Two players", note: "one keyboard" },
			{ label: "Tutorial", note: "a short guided roll" },
		];
	}

	private toTitle(): void {
		this.scr = "title";
		this.paused = false;
		this.sim = this.attract();
		this.log.clear();
		this.hud?.show("title");
		this.hud?.setMenu(this.menuItems(), this.menuSel);
		this.cam.mode = "title";
		this.setBelts();
	}

	private pick(i: number): void {
		this.menuSel = i;
		this.sfx.ui();
		if (i === 0) {
			this.versus = false;
			this.startMatch();
		} else if (i === 1) {
			this.versus = true;
			this.startMatch();
		} else this.startTutorial();
	}

	private setBelts(): void {
		const b = BELT_COLORS[(BELTS[this.beltSel] as Belt) ?? "blue"] as string;
		this.bodies[0].setBelt(b);
		this.bodies[1].setBelt(
			this.p.demo ? (BELT_COLORS[this.p.belt2] as string) : b,
		);
		if (this.p.demo)
			this.bodies[0].setBelt(BELT_COLORS[this.p.belt2] as string);
		if (this.p.demo) this.bodies[1].setBelt(BELT_COLORS[this.p.belt] as string);
	}

	private startMatch(): void {
		this.matchSeed = (this.p.seed + this.matchCount++) >>> 0;
		this.sim = new MatchSim({
			seed: this.matchSeed,
			roundTicks: Math.round(this.p.roundSec * TICK_HZ),
		});
		const belt = BELTS[this.beltSel] as Belt;
		if (this.p.demo)
			this.cpus = [
				new Cpu(0, this.p.belt2, this.matchSeed),
				new Cpu(1, this.p.belt, this.matchSeed),
			];
		else
			this.cpus = [null, this.versus ? null : new Cpu(1, belt, this.matchSeed)];
		this.tut = null;
		this.begin();
	}

	private startTutorial(): void {
		this.matchSeed = this.p.seed;
		this.sim = new MatchSim({
			seed: this.matchSeed,
			roundTicks: 0,
			introTicks: 60,
		});
		this.cpus = [this.p.demo ? new Cpu(0, "black", 1) : null, null];
		this.tut = new Tutorial();
		this.tut.begin(this.sim);
		this.begin();
	}

	private begin(): void {
		this.log.clear();
		this.acc = 0;
		this.freeze = 0;
		this.overT = 0;
		this.replay = null;
		this.finished = null;
		this.stats = {
			launches: [0, 0],
			landed: [0, 0],
			subs: [0, 0],
			counters: [0, 0],
		};
		this.scr = "play";
		this.paused = false;
		this.hud?.show("play");
		this.hud?.clearToasts();
		this.cam.mode = "intro";
		this.setBelts();
	}

	private showResults(): void {
		const s = this.finished ?? this.sim;
		this.scr = "results";
		this.resultsT = 0;
		this.cam.mode = "results";
		this.hud?.show("results");
		this.hud?.setResults(this.resultsData(s));
	}

	// ---------- input ----------

	private handleKeys(): void {
		const K = this.keys;
		if (this.scr === "gallery") return;
		if (this.scr === "title") {
			if (K.took("KeyW") || K.took("ArrowUp"))
				this.menuSel = (this.menuSel + 2) % 3;
			else if (K.took("KeyS") || K.took("ArrowDown"))
				this.menuSel = (this.menuSel + 1) % 3;
			else if (K.took("KeyA") || K.took("ArrowLeft"))
				this.beltSel = (this.beltSel + 2) % 3;
			else if (K.took("KeyD") || K.took("ArrowRight"))
				this.beltSel = (this.beltSel + 1) % 3;
			else if (K.took("Enter") || K.took("Space")) {
				this.pick(this.menuSel);
				return;
			} else return;
			this.sfx.ui();
			this.setBelts();
			this.hud?.setMenu(this.menuItems(), this.menuSel);
			return;
		}
		if (this.scr === "results") {
			if (this.resultsT < 0.6) return;
			if (K.took("Enter") || K.took("Space")) {
				// a rematch keeps the mode; after the tutorial, Enter starts a roll with a partner
				if (this.tut) this.versus = false;
				this.startMatch();
			} else if (K.took("Escape")) this.toTitle();
			return;
		}
		if (this.scr === "replay") {
			// swallow the keys for a moment so a still-mashing player does not skip it
			const skip = K.took("Enter") || K.took("Space") || K.took("Escape");
			if (skip && this.replayLock <= 0) this.showResults();
			return;
		}
		if (K.took("Escape")) {
			if (this.paused) {
				// paused: Esc only resumes
				this.paused = false;
				this.hud?.show("play");
			} else if (this.tut) {
				// skip the tutorial: straight into a roll with the chosen partner
				this.versus = false;
				this.startMatch();
				return;
			} else {
				this.paused = true;
				this.hud?.show("pause");
			}
		}
		if (this.paused && K.took("KeyQ")) this.toTitle();
	}

	// ---------- ticking ----------

	private tick(): void {
		const s = this.sim;
		const live =
			this.scr === "play" || this.scr === "tutorial" || this.scr === "over";
		let i0 = 0;
		let i1 = 0;
		if (this.scr === "title") {
			i0 = (this.cpus[0] as Cpu).next(s);
			i1 = (this.cpus[1] as Cpu).next(s);
		} else if (live) {
			const c0 = this.cpus[0];
			const c1 = this.cpus[1];
			i0 = c0 ? c0.next(s) : this.keys.sample(1);
			if (this.tut) {
				i0 = this.tut.mask(s, this.p.demo ? this.tut.bot(s) : i0);
				i1 = this.tut.partner(s);
			} else i1 = c1 ? c1.next(s) : this.keys.sample(2);
		}
		if (this.scr !== "title") this.log.push(i0, i1);
		// grip/breathe/posture answers (the sim records them; this is the sound of them)
		if (this.scr !== "title" && s.phase === PHASE.LIVE) {
			for (let p = 0; p < 2; p++) {
				const now = p === 0 ? i0 : i1;
				const was = s.held[p] as number;
				if (now & 16 && !(was & 16) && !s.isSub() && s.act === ACT.IDLE)
					this.sfx.grip();
				if (now & 32 && !(was & 32)) this.sfx.breathe();
				if (now & 64 && !(was & 64)) this.sfx.posture();
				this.gripBefore[p] = s.grip[p] as number;
			}
		}
		s.step(i0, i1);
		// a ping when grip crosses what a move asks for: the move is now available
		if (this.scr !== "title" && s.phase === PHASE.LIVE && !s.isSub())
			for (let p = 0; p < 2; p++) {
				const role: Role = s.pos === 0 ? "top" : s.roleOf(p);
				for (const mv of s.position.roles[role].moves)
					if (
						(this.gripBefore[p] as number) < mv.grip &&
						(s.grip[p] as number) >= mv.grip
					) {
						this.sfx.ready();
						break;
					}
			}
		this.tut?.afterStep(s);
		this.events(s, this.scr === "title");
	}

	frame(dt: number): void {
		const t0 = performance.now();
		this.handleKeys();
		if (this.scr === "gallery") {
			this.gallery?.frame();
			this.keys.endFrame();
			return;
		}
		if (!this.paused) this.advance(dt);
		this.keys.rollOn =
			this.scr === "play" || this.scr === "over" || this.scr === "replay";
		this.keys.endFrame();
		const t1 = performance.now();
		this.present(dt);
		const t2 = performance.now();
		this.cpuMs.sim += (t1 - t0 - this.cpuMs.sim) * 0.05;
		this.cpuMs.present += (t2 - t1 - this.cpuMs.present) * 0.05;
	}

	private advance(dt: number): void {
		if (this.scr === "results") {
			this.resultsT += dt;
			if (this.p.demo && this.resultsT > 9) this.startMatch();
			// the attract roll keeps going behind the card, quietly
			return;
		}
		if (this.scr === "replay") {
			this.advanceReplay(dt);
			return;
		}
		if (this.freeze > 0) {
			this.freeze -= dt;
			return;
		}
		this.acc += dt;
		let n = 0;
		while (this.acc >= DT - 1e-9 && n < 4) {
			this.acc -= DT;
			if (this.sim.phase !== PHASE.OVER) this.tick();
			n++;
			if (this.freeze > 0) {
				this.acc = 0;
				break;
			}
		}
		if (n === 4) this.acc = 0;
		if (this.scr === "title" && this.sim.phase === PHASE.OVER)
			this.sim = this.attract();
		if (this.tut && this.scr === "play") {
			if (this.tut.update(this.sim, dt) && this.sim.phase === PHASE.OVER)
				this.scr = "over";
		}
		if (
			(this.scr === "play" || this.scr === "over") &&
			this.sim.phase === PHASE.OVER
		) {
			this.scr = "over";
			this.overT += dt;
			if (this.overT > 2.6) {
				this.finished = this.sim;
				if (!this.tut) this.startReplay();
				else this.showResults();
			}
		}
	}

	// ---------- finish replay (re-simulated from the input log) ----------

	private startReplay(): void {
		const live = this.sim;
		const cfg = {
			seed: live.seed,
			roundTicks: live.roundTicks,
			introTicks: live.introTicks,
		};
		const log = this.log.clone();
		const sim = new MatchSim(cfg);
		const from = Math.max(0, log.length - 5 * TICK_HZ);
		for (let t = 0; t < from; t++) sim.step(log.get(t, 0), log.get(t, 1));
		this.replay = { sim, log, from, acc: 0, verified: null, live: live.hash() };
		this.scr = "replay";
		this.replayLock = 0.75;
		this.cam.mode = "sub";
		this.rig.tapping = false;
	}

	private advanceReplay(dt: number): void {
		this.replayLock -= dt;
		const r = this.replay;
		if (!r) {
			this.showResults();
			return;
		}
		const s = r.sim;
		if (s.tick >= r.log.length) {
			if (r.verified === null) r.verified = s.hash() === r.live;
			r.acc += dt;
			if (r.acc > 1.6) this.showResults();
			return;
		}
		r.acc += dt * 0.5;
		while (r.acc >= DT && s.tick < r.log.length) {
			r.acc -= DT;
			s.step(r.log.get(s.tick, 0), r.log.get(s.tick, 1));
			this.events(s, true);
		}
		if (s.tick >= r.log.length) r.acc = 0;
	}

	// ---------- events → feel ----------

	private events(s: MatchSim, quiet: boolean): void {
		const tension = s.isSub() ? s.tension : 0;
		for (let k = 0; k < s.evN; k++) {
			const ty = s.evType[k];
			const a = s.evA[k] as number;
			const b = s.evB[k] as number;
			const v = s.evV[k] as number;
			const name = (i: number): string => this.name(i);
			if (ty === EV.START) {
				if (!quiet) {
					this.sfx.whistle();
					this.hud?.showBanner(
						"Combate!",
						s.roundTicks ? "Roll" : "Tutorial",
						1,
					);
					this.cam.mode = "play";
				}
			} else if (ty === EV.LAUNCH) {
				this.stats.launches[a] = (this.stats.launches[a] as number) + 1;
				if (!quiet) this.sfx.launch();
			} else if (ty === EV.REVEAL) {
				if (!quiet) this.sfx.reveal();
			} else if (ty === EV.BEAT) {
				if (!quiet) this.sfx.beat(v);
			} else if (ty === EV.COUNTER_PICK) {
				if (!quiet) this.sfx.counter();
			} else if (ty === EV.SUCCESS) {
				const mv = (MOVES[b] as MoveRef).def;
				this.stats.landed[a] = (this.stats.landed[a] as number) + 1;
				this.freeze = quiet ? 0 : 0.09;
				this.flash[a] = 1;
				const big =
					mv.points >= 3 ||
					mv.kind === "sweep" ||
					mv.kind === "takedown" ||
					mv.kind === "reversal";
				if (!quiet) {
					this.cam.punch(big ? 0.7 : 0.35);
					this.cam.shake(big ? 0.8 : 0.3);
					this.sfx.thud(big ? 1 : 0.6);
					if (mv.points) {
						this.sfx.score(mv.points);
						this.hud?.toast(`+${mv.points}  ${mv.name}`, COLORS[a]);
					} else if (mv.kind !== "sub") this.hud?.toast(mv.name, COLORS[a]);
				}
				this.rig.centre(_c);
				this.dust.puff(_c[0], _c[2], big ? 10 : 5, big ? 1 : 0.6);
			} else if (ty === EV.STUFFED) {
				const mv = (MOVES[b] as MoveRef).def;
				this.stats.counters[1 - a] = (this.stats.counters[1 - a] as number) + 1;
				this.rig.punch(a, 0, -0.04, 0);
				if (!quiet) {
					this.sfx.stuffed();
					this.cam.shake(0.25);
					this.hud?.toast(
						`${name(1 - a)} stops the ${mv.name.toLowerCase()}`,
						COLORS[1 - a],
					);
				}
			} else if (ty === EV.WRONG) {
				if (!quiet) {
					this.sfx.wrong();
					this.hud?.toast(`${name(a)} guessed wrong`, "#ff7a66");
				}
			} else if (ty === EV.NEAR || ty === EV.STALL) {
				if (!quiet) {
					this.sfx.advantage();
					this.hud?.toast(
						ty === EV.STALL
							? `Stalling: advantage ${name(b)}`
							: `Advantage ${name(a)}`,
						"#e2b85a",
					);
				}
			} else if (ty === EV.SUB_START) {
				this.stats.subs[a] = (this.stats.subs[a] as number) + 1;
				if (!quiet) {
					this.sfx.thud(0.5);
					this.hud?.toast(`${(MOVES[b] as MoveRef).def.name}!`, COLORS[a]);
				}
			} else if (ty === EV.SUB_BEAT) {
				this.rig.punch(a, 0, 0.03, 0);
				if (!quiet) this.sfx.escapeBeat(v);
			} else if (ty === EV.SUB_PANIC) {
				this.rig.punch(a, 0, -0.02, 0);
			} else if (ty === EV.ESCAPE || ty === EV.RELEASE) {
				if (!quiet) {
					this.sfx.thud(0.6);
					this.hud?.toast(
						ty === EV.ESCAPE ? `${name(a)} escapes` : "Released",
						COLORS[a],
					);
					this.cam.shake(0.4);
				}
			} else if (ty === EV.TAP) {
				this.freeze = quiet ? 0 : 0.16;
				this.rig.tapping = true;
				this.flash[1 - a] = 1.5;
				if (!quiet) {
					this.sfx.tap();
					this.sfx.whistle(true);
					this.cam.punch(1);
					this.cam.shake(0.5);
				}
			} else if (ty === EV.TIME) {
				if (!quiet) this.sfx.whistle(true);
			}
		}
		if (!quiet && tension > 0) this.sfx.heart(DT, tension);
	}

	// ---------- presentation ----------

	private name(p: number): string {
		if (this.p.demo) return p === 0 ? "White" : "Blue";
		if (this.versus) return p === 0 ? "Player 1" : "Player 2";
		return p === 0 ? "You" : "Partner";
	}

	private present(dt: number): void {
		const s = this.replay && this.scr === "replay" ? this.replay.sim : this.sim;
		this.rig.tension +=
			((s.isSub() ? s.tension : 0) - this.rig.tension) * Math.min(1, dt * 8);
		if (!s.isSub() && s.phase !== PHASE.OVER) this.rig.tapping = false;
		if (s.phase === PHASE.OVER && s.method === "Submission")
			this.rig.tapping = true;
		this.rig.update(s, dt);
		this.bodies[0].apply(this.rig.sol[0]);
		this.bodies[1].apply(this.rig.sol[1]);
		for (let p = 0; p < 2; p++) {
			this.flash[p] = Math.max(0, (this.flash[p] as number) - dt * 3);
			this.bodies[p as 0 | 1].flash(
				(this.flash[p] as number) * 0.035,
				"#ffd9a0",
			);
		}
		this.dust.update(dt, this.game.renderer.three.camera);
		this.rig.centre(_c);
		if (this.scr === "play" || this.scr === "over" || this.scr === "tutorial")
			this.cam.mode =
				s.phase === PHASE.INTRO
					? "intro"
					: s.isSub() || (s.phase === PHASE.OVER && s.method === "Submission")
						? "sub"
						: "play";
		// side-on to the line between the two pelvises
		const a0 = this.rig.sol[0].j;
		const a1 = this.rig.sol[1].j;
		this.cam.prefer = Math.atan2(
			(a1[0] as number) - (a0[0] as number),
			-((a1[2] as number) - (a0[2] as number)),
		);
		this.cam.update(dt, _c[0], Math.max(0.35, _c[1] * 0.8), _c[2]);
		this.academy.setClock(s.clock());
		// depth of field leans in on submissions
		const dofOn = this.p.dof && this.cam.mode === "sub";
		const dof = this.game.renderer.dof;
		if (dofOn !== this.dof) {
			this.dof = dofOn;
			dof.enabled = dofOn;
		}
		if (dofOn) {
			dof.focus.value = this.cam.focus();
			dof.range.value = 3.2;
			dof.bokeh.value = 0.4;
		}
		this.presentHud(s, dt);
	}

	private presentHud(s: MatchSim, dt: number): void {
		const hud = this.hud;
		if (!hud) return;
		if (this.scr === "title" || this.scr === "results") return;
		for (let p = 0; p < 2; p++)
			hud.setBoard(
				p,
				this.name(p),
				COLORS[p] as string,
				this.cpuBelt(p),
				s.points[p] as number,
				s.adv[p] as number,
			);
		hud.setClock(s.clock(), s.roundTicks === 0);
		const pd = s.position;
		const roleLine =
			pd.id === "standing" || pd.kind === "sub"
				? pd.kind === "sub"
					? `${this.name(s.top)} finishing · ${this.name(1 - s.top)} defending`
					: "Grip fight"
				: `${this.name(s.top)}: ${pd.roles.top.label} · ${this.name(1 - s.top)}: ${pd.roles.bottom.label}`;
		if (this.scr === "replay") {
			const ok = this.replay?.verified;
			hud.setPosition(
				`Replay · ${pd.name}`,
				ok === null || ok === undefined
					? "the finish, re-simulated from the input log at half speed"
					: ok
						? "re-simulated state hash matches the live roll ✓"
						: "replay diverged",
			);
		} else
			hud.setPosition(
				s.phase === PHASE.INTRO ? "Bow in" : pd.name,
				s.phase === PHASE.INTRO ? "" : roleLine,
			);
		for (let p = 0; p < 2; p++) {
			// rebuild the move rows only when something they show changed (no per-frame garbage)
			const sig = this.panelSig(s, p);
			if (sig !== this.panelSigs[p]) {
				this.panelSigs[p] = sig;
				hud.setPanel(p, this.panel(s, p));
			} else hud.setMeters(p, s.grip[p] as number, s.gas[p] as number);
		}
		// exchange widget above the attacker's head
		const cam = this.game.renderer.three.camera;
		const W = window.innerWidth;
		const H = window.innerHeight;
		const project = (p: number): [number, number, boolean] => {
			this.rig.head(p, _h);
			_v.set(_h[0], _h[1] + 0.28, _h[2]);
			_v.project(cam);
			return [(_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H, _v.z < 1];
		};
		if (s.act !== ACT.IDLE && s.phase === PHASE.LIVE) {
			const mr = s.moveRef() as MoveRef;
			const a = s.actor;
			const [x, y] = project(a);
			const human = (q: number): boolean =>
				!this.cpus[q] && !(this.tut && q === 1);
			const reveal = s.act === ACT.WINDOW;
			let hint = "";
			if (reveal && human(1 - a) && s.counter < 0) {
				const role: Role = s.pos === 0 ? "top" : s.roleOf(1 - a);
				const c = pd.roles[role].counters[correctCounter(s.move)];
				if (c) hint = `Counter: ${c.name} ${keycap(DIR_KEYS[c.dir])}`;
			} else if (reveal && human(a) && s.grade < 0)
				hint = `${keycap(this.gripKey(a))} when the rings meet`;
			else if (s.counter >= 0) {
				const role: Role = s.pos === 0 ? "top" : s.roleOf(1 - a);
				const c = pd.roles[role].counters[s.counter];
				const ok = s.counter === correctCounter(s.move);
				hint = `${this.name(1 - a)}: ${c?.name ?? "?"} <span style="color:${ok ? "#8fe38a" : "#ff7a66"}">${ok ? "✓" : "✗"}</span>`;
			} else if (s.grade >= 0)
				hint =
					s.grade > 0.8
						? "Perfect timing"
						: s.grade > 0.4
							? "Good timing"
							: "Off the beat";
			hud.setExchange(
				true,
				Math.min(W - 260, Math.max(260, x)),
				Math.max(320, y),
				reveal
					? `${this.name(a)}`
					: `${this.name(a)} ${TELL_TEXT[mr.def.tell] ?? ""}…`,
				reveal ? mr.def.name : "Reading",
				!reveal,
				reveal ? s.ringT() : 1,
				reveal,
				hint,
				COLORS[a] as string,
				this.gripKey(a),
			);
		} else hud.setExchange(false, 0, 0, "", "", false, 0, false, "", "");
		// submission tension
		if (s.isSub() && s.phase !== PHASE.INTRO) {
			const a = s.top;
			const esc = pd.escape as { name: string; dir: Dir };
			const k = s.subT % TUNE.subBeatEvery;
			const near = Math.min(k, TUNE.subBeatEvery - k) <= TUNE.subBeatHalf;
			const beatScale = near ? 1.25 : 1;
			hud.setSub(
				true,
				pd.name,
				s.tension,
				s.escape,
				this.isCpu(a)
					? `<span style="color:${COLORS[a]}">${this.name(a)}</span> squeezes`
					: `<span style="color:${COLORS[a]}">${this.name(a)}</span>: hold ${keycap(this.gripKey(a))} to squeeze`,
				this.isCpu(1 - a)
					? `<span style="color:${COLORS[1 - a]}">${this.name(1 - a)}</span>: ${esc.name} on the beat`
					: `<span style="color:${COLORS[1 - a]}">${this.name(1 - a)}</span>: ${esc.name} <span class="beat" style="transform:scale(${beatScale})">${keycap(1 - a === 0 ? DIR_KEYS[esc.dir] : arrow(esc.dir))}</span> on the beat`,
			);
			hud.setVignette(0.25 + s.tension * 0.7);
		} else {
			hud.setSub(false, "", 0, 0, "", "");
			hud.setVignette(
				s.phase === PHASE.OVER && s.method === "Submission" ? 0.8 : 0,
			);
		}
		// banners
		if (s.phase === PHASE.INTRO)
			hud.showBanner(
				this.tut ? "Tutorial" : "Bow in",
				this.tut
					? "A guided roll"
					: `${this.p.roundSec / 60 >= 1 ? `${(this.p.roundSec / 60).toFixed(this.p.roundSec % 60 ? 1 : 0)} minute` : `${this.p.roundSec} s`} round`,
				1,
			);
		else if (s.phase === PHASE.OVER) {
			const win = s.winner;
			const head =
				s.method === "Submission"
					? "Tap!"
					: s.method === "Draw"
						? "Draw"
						: "Time";
			if (this.scr === "replay") hud.hideBanner();
			else
				hud.showBanner(
					head,
					win >= 0
						? `${this.name(win)} wins by ${s.method.toLowerCase()}`
						: "Even roll",
					1,
				);
		} else if (this.scr === "replay") hud.hideBanner();
		else if (s.liveTick < 70)
			hud.showBanner("Combate!", "", 1 + s.liveTick / 400);
		else hud.hideBanner();
		// tutorial card
		if (this.tut && this.scr !== "replay") {
			const st = TUT_STEPS[this.tut.step];
			if (st)
				hud.setTutorial(
					true,
					`Step ${this.tut.step + 1} of ${TUT_STEPS.length}`,
					st.title,
					st.text,
				);
			else
				hud.setTutorial(
					true,
					"Done",
					"You finished your first roll",
					`Next: roll with a partner. ${keycap("Enter")} to continue.`,
				);
		} else hud.setTutorial(false);
		// name tags
		for (let p = 0; p < 2; p++) {
			const [x, y, vis] = project(p);
			hud.setLabel(
				p,
				vis && s.phase === PHASE.INTRO,
				x,
				y + 10,
				this.name(p),
				COLORS[p] as string,
			);
		}
		void dt;
	}

	/** Reused panel objects and row pools: the panel never allocates while it updates. */
	private readonly panelData: PanelData[] = [0, 1].map(() => ({
		title: "",
		sub: "",
		mode: "",
		defending: false,
		grip: 0,
		gas: 0,
		need: 0,
		rows: [],
		foot: "",
	}));
	private readonly rowPool: Row[][] = [0, 1].map(() =>
		[0, 1, 2, 3].map(() => ({
			key: "",
			label: "",
			note: "",
			off: false,
			hot: false,
			right: false,
		})),
	);

	private row(
		p: number,
		i: number,
		key: string,
		label: string,
		note: string,
		off: boolean,
		hot: boolean,
		right: boolean,
	): void {
		const r = (this.rowPool[p] as Row[])[i] as Row;
		r.key = key;
		r.label = label;
		r.note = note;
		r.off = off;
		r.hot = hot;
		r.right = right;
		const rows = (this.panelData[p] as PanelData).rows;
		rows[i] = r;
	}

	private panel(s: MatchSim, p: number): PanelData {
		const d = this.panelData[p] as PanelData;
		const isCpu = this.isCpu(p);
		const cpu = this.cpuBelt(p);
		d.title = this.name(p);
		d.sub = cpu
			? cpu.label
			: p === 0
				? "W A S D · J K L"
				: "Arrows · Numpad 1 2 3";
		const arrows = p !== 0;
		const pd = s.position as PositionDef;
		const role: Role = pd.id === "standing" ? "top" : s.roleOf(p);
		const grip = s.grip[p] as number;
		d.grip = grip;
		d.gas = s.gas[p] as number;
		d.defending = false;
		d.need = 0;
		let n = 0;
		if (s.phase !== PHASE.LIVE)
			d.mode = s.phase === PHASE.INTRO ? "Bow in" : "Match over";
		else if (s.isSub()) {
			if (p === s.top) d.mode = "Finish: hold the squeeze";
			else {
				d.mode = "Escape on the beat";
				d.defending = true;
				const esc = pd.escape as { name: string; dir: Dir };
				this.row(
					p,
					n++,
					dirKey(esc.dir, arrows),
					esc.name,
					"on the beat",
					false,
					true,
					true,
				);
			}
		} else if (s.act !== ACT.IDLE && s.actor !== p) {
			d.mode = "Defend: read the posture";
			d.defending = true;
			const right = correctCounter(s.move);
			const reveal = s.act === ACT.WINDOW;
			const list = pd.roles[role].counters;
			for (let i = 0; i < list.length; i++) {
				const c = list[i] as (typeof list)[number];
				this.row(
					p,
					n++,
					dirKey(c.dir, arrows),
					c.name,
					c.hint,
					s.counter >= 0 && s.counter !== i,
					s.counter === i,
					reveal && i === right && !isCpu,
				);
			}
		} else if (s.act !== ACT.IDLE && s.actor === p) {
			d.mode = `Attacking: ${(s.moveRef() as MoveRef).def.name}`;
		} else {
			d.mode =
				s.settle > 0
					? "Settling…"
					: (s.recover[p] as number) > 0
						? "Recovering"
						: "Attack";
			const list = pd.roles[role].moves;
			for (let i = 0; i < list.length; i++) {
				const mv = list[i] as (typeof list)[number];
				const note = mv.points
					? (POINT_NOTES[mv.points] ?? "")
					: mv.kind === "sub"
						? "sub"
						: mv.kind;
				this.row(
					p,
					n++,
					dirKey(mv.dir, arrows),
					mv.name,
					note,
					grip < mv.grip,
					false,
					false,
				);
			}
			d.need = minGrip(s.pos, role);
		}
		d.rows.length = n;
		// key reminders only on human seats; player 2 sees the laptop alternates too
		d.foot = isCpu ? "" : p === 0 ? FOOT_P1 : FOOT_P2;
		return d;
	}

	private resultsData(s: MatchSim): import("./ui/hud.ts").ResultsData {
		const total = Math.max(1, s.liveTick);
		const segs = [];
		const tl = s.timeline;
		for (let i = 0; i < tl.length; i++) {
			const seg = tl[i] as (typeof tl)[number];
			if (seg.pos < 0) break;
			const to = (tl[i + 1]?.tick ?? total) as number;
			const pd = POSITIONS[seg.pos] as PositionDef;
			segs.push({
				from: seg.tick,
				to: Math.max(seg.tick + 1, to),
				label: pd.name,
				color: POS_COLORS[pd.id] ?? "#888",
				lane: pd.id === "standing" ? 0 : seg.top,
			});
		}
		const marks = s.marks.map((m) => ({
			at: m.tick,
			text: m.points ? `+${m.points}` : "A",
			color: COLORS[m.player] as string,
		}));
		const win = s.winner;
		const subName =
			s.method === "Submission" && s.subMove >= 0
				? (MOVES[s.subMove] as MoveRef).def.name
				: "";
		const ctrl = (p: number): string =>
			`${Math.round((s.control[p] as number) / TICK_HZ)} s`;
		return {
			headline: this.tut
				? "Tutorial complete"
				: win < 0
					? "Draw"
					: `${this.name(win)} ${this.name(win) === "You" ? "win" : "wins"}`,
			method:
				s.method === "Submission"
					? `by submission: ${subName.toLowerCase()} at ${fmt(s.liveTick / TICK_HZ)}`
					: `${s.method.toLowerCase()} after ${fmt(s.liveTick / TICK_HZ)}`,
			names: [this.name(0), this.name(1)],
			colors: [COLORS[0], COLORS[1]],
			cpuBelts: [this.cpuBelt(0), this.cpuBelt(1)],
			points: [s.points[0] as number, s.points[1] as number],
			adv: [s.adv[0] as number, s.adv[1] as number],
			segments: segs,
			marks,
			total,
			legend: Object.entries(POS_COLORS)
				.filter(([k]) => !["triangle", "kimura", "rnc"].includes(k))
				.map(([k, c]) => ({
					label:
						k === "armbar"
							? "Submission"
							: (POSITIONS.find((p) => p.id === k) as PositionDef).name,
					color: c,
				})),
			stats: [
				{
					label: `${this.name(0)}: moves landed / tried`,
					value: `${this.stats.landed[0]} / ${this.stats.launches[0]}`,
				},
				{
					label: `${this.name(1)}: moves landed / tried`,
					value: `${this.stats.landed[1]} / ${this.stats.launches[1]}`,
				},
				{
					label: "Counters (white / blue)",
					value: `${this.stats.counters[0]} / ${this.stats.counters[1]}`,
				},
				{
					label: "Time on top (white / blue)",
					value: `${ctrl(0)} / ${ctrl(1)}`,
				},
			],
		};
	}

	hash(): string {
		return this.sim.hash();
	}

	probe(): Record<string, unknown> {
		const s = this.sim;
		return {
			screen: this.scr,
			paused: this.paused,
			phase: PHASE_NAMES[s.phase],
			tick: s.tick,
			liveTick: s.liveTick,
			position: s.position.id,
			top: s.top,
			points: Array.from(s.points),
			adv: Array.from(s.adv),
			grip: Array.from(s.grip).map((x) => +x.toFixed(2)),
			gas: Array.from(s.gas).map((x) => +x.toFixed(2)),
			act: s.act,
			move: s.move >= 0 ? (MOVES[s.move] as MoveRef).def.id : null,
			tension: +s.tension.toFixed(2),
			winner: s.winner,
			method: s.method,
			matchCount: this.matchCount,
			tutorialStep: this.tut ? this.tut.step : null,
			replay: this.replay
				? { verified: this.replay.verified, tick: this.replay.sim.tick }
				: null,
			inputs: this.log.length,
			hash: s.hash(),
			cpu: {
				simMs: +this.cpuMs.sim.toFixed(3),
				presentMs: +this.cpuMs.present.toFixed(3),
			},
		};
	}
}

const FOOT_P1 = `${keycap("J")} grip &nbsp;${keycap("K")} breathe &nbsp;${keycap("L")} posture`;
const FOOT_P2 = `${keycap("1 / ,")} grip &nbsp;${keycap("2 / .")} breathe &nbsp;${keycap("3 / /")} posture`;
const POINT_NOTES: Record<number, string> = { 2: "+2", 3: "+3", 4: "+4" };
function dirKey(d: Dir, arrows: boolean): string {
	return arrows ? ARROWS[d] : DIR_KEYS[d];
}
const ARROWS: Record<Dir, string> = {
	up: "↑",
	left: "←",
	down: "↓",
	right: "→",
};
function arrow(d: Dir): string {
	return ARROWS[d];
}
function fmt(sec: number): string {
	const s = Math.round(sec);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
