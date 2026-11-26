import type { Game } from "@pebble3d/sdk/game";
import { Color, Vector3 } from "three/webgpu";
import { arenaRadius, ringDropTick } from "./arena.ts";
import { Sfx } from "./audio/sfx.ts";
import { Bot } from "./bot.ts";
import {
	COLLAPSE,
	COUNTDOWN_TICKS,
	DT,
	MAX_PLAYERS,
	ORB,
	TICK_HZ,
} from "./constants.ts";
import { EV } from "./events.ts";
import { MenuGate } from "./gate.ts";
import {
	emptyFrame,
	type FrameInput,
	InputLog,
	type PlayerInput,
} from "./input.ts";
import { Keys } from "./keys.ts";
import {
	activeSlots,
	Match,
	type MatchConfig,
	type RoundRecord,
	recordOf,
	type SlotKind,
} from "./match.ts";
import { hostFromHandle, type PhysicsHost } from "./physics.ts";
import { DRAW, PHASE, PHASE_NAMES, RoundSim } from "./sim.ts";
import { Hud, type Screen } from "./ui/hud.ts";
import { ArenaView } from "./view/arena-view.ts";
import { ArenaCamera } from "./view/camera.ts";
import { Fx } from "./view/fx.ts";
import { LOOKS, OrbView } from "./view/orbs.ts";
import { Sparks } from "./view/sparks.ts";

export interface AppParams {
	demo: boolean;
	/** Stay on the title screen (captures). */
	title: boolean;
	slots: SlotKind[];
	toWin: number;
	seed: number;
	hud: boolean;
	mute: boolean;
	/** Demo: skip replays (faster smoke runs). */
	replay: boolean;
}

const _v = new Vector3();
const WHITE = new Color("#fff4ea");
const EMBER = new Color("#ff6a2a");
const TEAM = LOOKS.map((l) => new Color(l.color));
const DIGITS = ["Digit1", "Digit2", "Digit3", "Digit4"];
/** Ticks re-simulated per frame while a replay skip catches up. */
const SKIP_BUDGET = 240;

/** Replay pacing: slow around each ring-out, quick elsewhere. */
function replaySpeed(rec: RoundRecord, t: number): number {
	for (const o of rec.outTicks) if (t >= o - 50 && t <= o + 30) return 0.4;
	if (t > rec.ticks - 40) return 1;
	return 4;
}

/** Ringout: screens, the fixed-tick lockstep loop, instant replays, and presentation. */
export class App {
	private readonly game: Game;
	private readonly p: AppParams;
	private readonly host: PhysicsHost;
	private readonly hud: Hud | null;
	private readonly sfx: Sfx;
	private readonly keys = new Keys();
	private readonly cam: ArenaCamera;
	private readonly orbs = new OrbView();
	private readonly fx = new Fx();
	private readonly sparks: Sparks;
	private arena: ArenaView;
	private screen: Screen = "title";
	private slots: SlotKind[];
	private toWin: number;
	private matchSeed: number;
	private match: Match;
	/** The sim on screen: the live round, the replay, or the attract round behind the title. */
	private sim: RoundSim;
	private bots: (Bot | null)[] = [];
	private readonly frame: FrameInput = emptyFrame();
	private readonly log = new InputLog();
	private acc = 0;
	// replay state
	private rec: RoundRecord | null = null;
	private replayAcc = 0;
	private replayHash: string | null = null;
	private replayHold = 0;
	/** Replay skip in progress: re-simulate a budget of ticks per frame, silently. */
	private skipping = false;
	private readonly gate = new MenuGate();
	private readonly verified: (boolean | null)[] = [];
	private resultsT = 0;
	private bannerT = 0;
	private matchCount = 0;
	private readonly cpu = { sim: 0, present: 0 };

	constructor(game: Game, p: AppParams, hudRoot: HTMLElement) {
		this.game = game;
		this.p = p;
		this.host = hostFromHandle(game.sim);
		this.slots = p.slots.slice();
		this.toWin = p.toWin;
		this.matchSeed = p.seed;
		this.match = new Match(this.config());
		const r = game.renderer;
		r.controller?.dispose();
		r.controller = null;
		const scene = r.three.scene;
		scene.add(r.three.camera);
		r.three.camera.far = 400;
		r.three.camera.updateProjectionMatrix();
		this.cam = new ArenaCamera(r.three.camera);
		this.sim = this.attractSim();
		this.arena = new ArenaView(this.sim.tiles);
		scene.add(this.arena.root, this.orbs.root, this.fx.root);
		this.sparks = new Sparks(scene);
		this.sfx = new Sfx(!p.mute);
		this.hud = p.hud
			? new Hud(hudRoot, {
					onSeat: (s) => this.cycleSeat(s),
					onRounds: () => this.cycleRounds(),
					onStart: () => this.startMatch(),
					onRematch: () => this.startMatch(),
					onMenu: () => this.toTitle(),
					onSkip: () => this.skipReplay(),
				})
			: null;
		this.hud?.setSetup(this.slots, this.toWin);
		if (p.demo && !p.title) this.startMatch();
		else this.toTitle();
	}

	private config(): MatchConfig {
		return {
			slots: this.slots.slice(),
			toWin: this.toWin,
			seed: this.matchSeed,
		};
	}

	/** The round behind the title screen: four bots, never logged. */
	private attractSim(): RoundSim {
		const s = new RoundSim(
			this.host,
			this.matchSeed ^ 0x7e57,
			activeSlots(["bot", "bot", "bot", "bot"]),
		);
		this.bots = [0, 1, 2, 3].map((k) => new Bot(k, s.seed));
		return s;
	}

	private swapSim(next: RoundSim): void {
		if (next === this.sim) return;
		this.sim.free();
		this.sim = next;
		this.fx.clear();
	}

	// ---------- title ----------

	private cycleSeat(s: number): void {
		const order: SlotKind[] = ["p1", "p2", "bot", "off"];
		let k = order.indexOf(this.slots[s] ?? "off");
		for (let n = 0; n < 4; n++) {
			k = (k + 1) % 4;
			const kind = order[k] as SlotKind;
			const taken =
				(kind === "p1" || kind === "p2") &&
				this.slots.some((o, i) => i !== s && o === kind);
			if (!taken) break;
		}
		this.slots[s] = order[k] as SlotKind;
		this.hud?.setSetup(this.slots, this.toWin);
		this.sfx.ui();
	}

	private cycleRounds(): void {
		this.toWin = (this.toWin % 4) + 1;
		if (this.toWin < 2) this.toWin = 2;
		this.hud?.setSetup(this.slots, this.toWin);
		this.sfx.ui();
	}

	private toTitle(): void {
		this.screen = "title";
		this.hud?.show("title");
		this.hud?.setSetup(this.slots, this.toWin);
		this.swapSim(this.attractSim());
		this.cam.setMode("title", true);
		this.keys.clearPressed();
	}

	// ---------- match flow ----------

	private startMatch(): void {
		if (this.slots.filter((s) => s !== "off").length < 2) return;
		this.sfx.ui();
		// a fresh seed per match, derived from the boot seed (reproducible for captures)
		this.matchSeed = (this.p.seed + this.matchCount++) >>> 0;
		this.match = new Match(this.config());
		this.verified.length = 0;
		this.hud?.setSetup(this.slots, this.toWin);
		this.startRound();
	}

	private startRound(): void {
		const seed = this.match.nextSeed();
		const sim = new RoundSim(this.host, seed, activeSlots(this.slots));
		this.bots = this.slots.map((k, s) =>
			k === "bot" ? new Bot(s, seed) : null,
		);
		this.swapSim(sim);
		this.log.clear();
		this.acc = 0;
		this.screen = "play";
		this.hud?.show("play");
		this.hud?.setRound(this.match.round, this.toWin);
		this.hud?.seatPips(this.match.wins, this.toWin);
		this.cam.setMode("play", this.match.round === 0);
		this.keys.clearPressed();
	}

	private endRound(): void {
		const rec = recordOf(this.match.round, this.sim, this.log);
		this.match.add(rec);
		this.hud?.seatPips(this.match.wins, this.toWin);
		if (this.p.replay) this.startReplay(rec);
		else this.afterReplay();
	}

	private startReplay(rec: RoundRecord): void {
		this.rec = rec;
		const sim = new RoundSim(this.host, rec.seed, rec.active);
		// the countdown is uneventful: fast-forward to just before GO
		const f = this.frame;
		for (let t = 0; t < COUNTDOWN_TICKS - 30; t++) sim.step(rec.log.read(t, f));
		this.swapSim(sim);
		this.replayAcc = 0;
		this.replayHash = null;
		this.replayHold = 0;
		this.screen = "replay";
		this.hud?.show("replay");
		this.hud?.replayProof(rec.log.length, rec.log.bytes, rec.hash, null);
		this.cam.setMode("replay", true);
		this.sfx.rewind();
		this.keys.clearPressed();
		this.skipping = false;
		this.gate.arm();
	}

	private skipReplay(): void {
		const rec = this.rec;
		if (this.screen !== "replay" || !rec || this.replayHash !== null) return;
		// spread over frames (SKIP_BUDGET ticks each) so a long round never freezes a frame
		this.skipping = true;
	}

	private finishReplay(): void {
		const rec = this.rec;
		if (!rec) return;
		this.replayHash = this.sim.hash();
		const ok = this.replayHash === rec.hash;
		this.verified[rec.index] = ok;
		this.hud?.replayProof(
			rec.log.length,
			rec.log.bytes,
			rec.hash,
			this.replayHash,
		);
		this.sfx.verified(ok);
		if (!ok)
			console.info(
				`ringout: replay diverged (${this.replayHash} != ${rec.hash})`,
			);
		this.replayHold = 2.2;
		this.skipping = false;
		this.gate.arm();
	}

	private afterReplay(): void {
		if (this.match.champion() >= 0) this.showResults();
		else this.startRound();
	}

	private showResults(): void {
		const m = this.match;
		const champ = m.champion();
		this.screen = "results";
		this.resultsT = 0;
		this.hud?.show("results");
		this.hud?.showResults({
			champion: champ,
			rows: this.slots
				.map((kind, slot) => ({
					slot,
					kind,
					wins: m.wins[slot] as number,
					kos: m.kos[slot] as number,
					dashes: m.dashes[slot] as number,
					bestHit: m.bestHit[slot] as number,
				}))
				.filter((r) => r.kind !== "off"),
			rounds: m.records.map((r) => ({
				winner: r.winner,
				seconds: Math.max(0, r.ticks - COUNTDOWN_TICKS) / TICK_HZ,
				hash: r.hash,
				verified: this.verified[r.index] ?? null,
			})),
		});
		// the champion's last round stays on screen; replay it once more as a victory lap
		const last = m.records[m.records.length - 1];
		if (last) {
			const sim = new RoundSim(this.host, last.seed, last.active);
			this.swapSim(sim);
			this.rec = last;
			this.replayAcc = 0;
		}
		this.cam.setMode("results", true);
		this.sfx.win();
		this.keys.clearPressed();
		this.gate.arm();
	}

	// ---------- input ----------

	private handleKeys(): void {
		const K = this.keys;
		if (this.screen === "title") {
			for (let s = 0; s < MAX_PLAYERS; s++)
				if (K.took(DIGITS[s] as string)) this.cycleSeat(s);
			if (K.took("KeyR")) this.cycleRounds();
			if (K.took("Enter") || K.took("Space")) this.startMatch();
			return;
		}
		if (K.took("Escape")) {
			this.toTitle();
			return;
		}
		if (this.screen !== "replay" && this.screen !== "results") return;
		// take both keys every frame, so presses during the lockout are dropped, not queued
		const enter = K.took("Enter");
		const space = K.took("Space");
		if (!this.gate.accept(enter || space)) return;
		if (this.screen === "replay") {
			if (this.replayHash === null) this.skipReplay();
			else this.replayHold = 0;
		} else this.startMatch();
	}

	private fillFrame(): void {
		const f = this.frame;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			const out = f[s] as PlayerInput;
			const k = this.screen === "title" ? "bot" : this.slots[s];
			const bot = this.bots[s];
			if (k === "p1") this.keys.sample(1, out);
			else if (k === "p2") this.keys.sample(2, out);
			else if (bot) bot.next(this.sim, out);
			else {
				out.x = 0;
				out.z = 0;
				out.buttons = 0;
			}
		}
	}

	// ---------- ticking ----------

	private liveTick(): void {
		const sim = this.sim;
		if (sim.phase === PHASE.OVER) return;
		this.fillFrame();
		if (this.screen === "play") this.log.push(this.frame);
		sim.step(this.frame);
		this.present1(sim);
		if ((sim.phase as number) === PHASE.OVER) {
			if (this.screen === "play") this.endRound();
			else if (this.screen === "title") this.swapSim(this.attractSim());
		}
	}

	private replayTick(): void {
		const rec = this.rec;
		const sim = this.sim;
		if (!rec || sim.phase === PHASE.OVER || sim.tick >= rec.log.length) return;
		sim.step(rec.log.read(sim.tick, this.frame));
		this.present1(sim);
	}

	/** Per-tick presentation of sim events: audio, VFX, HUD toasts. */
	private present1(sim: RoundSim): void {
		const ev = sim.events;
		// the title attract round, a replay skip and the results victory lap stay silent and still
		const quiet =
			this.screen === "title" || this.screen === "results" || this.skipping;
		for (let k = 0; k < ev.length; k++) {
			const ty = ev.type[k];
			const a = ev.a[k] as number;
			const b = ev.b[k] as number;
			const x = ev.x[k] as number;
			const z = ev.z[k] as number;
			if (ty === EV.COUNT && !quiet) this.sfx.count();
			else if (ty === EV.GO && !quiet) {
				this.sfx.go();
				this.bannerT = 0.6;
			} else if (ty === EV.DASH) {
				const o = a * 3;
				const px = sim.pos[o] as number;
				const pz = sim.pos[o + 2] as number;
				this.fx.ring(px, 0.03, pz, 1.8, TEAM[a] as Color, 2.5, 0.35);
				this.sparks.burst(
					10,
					px - x * 0.5,
					0.15,
					pz - z * 0.5,
					-x,
					0.4,
					-z,
					4,
					0.5,
					TEAM[a] as Color,
					3,
				);
				this.orbs.flash(a, 0.8);
				if (!quiet) this.sfx.dash();
			} else if (ty === EV.IMPACT) {
				const v = ev.v[k] as number;
				const n = Math.min(40, Math.round(6 + v * 2.2));
				this.sparks.burst(
					n,
					x,
					ORB.radius,
					z,
					0,
					0.5,
					0,
					2 + v * 0.45,
					1,
					WHITE,
					3 + v * 0.3,
				);
				this.fx.ring(
					x,
					ORB.radius,
					z,
					0.6 + v * 0.14,
					WHITE,
					1.5 + v * 0.15,
					0.3,
				);
				this.orbs.flash(a, Math.min(1.2, v * 0.1));
				this.orbs.flash(b, Math.min(1.2, v * 0.1));
				if (v > 5 && !quiet) this.cam.kick(Math.min(0.5, v * 0.025));
				if (!quiet) this.sfx.impact(v);
			} else if (ty === EV.RINGOUT) {
				const c = TEAM[a] as Color;
				this.fx.beam(x, z, c);
				this.sparks.burst(30, x, -2.5, z, 0, 1, 0, 9, 0.6, c, 4);
				if (!quiet) this.cam.kick(0.35);
				if (!quiet) {
					this.sfx.ringout();
					const who = (LOOKS[a] as (typeof LOOKS)[number]).name;
					const by =
						b >= 0 ? ` by ${(LOOKS[b] as (typeof LOOKS)[number]).name}` : "";
					this.hud?.toast(
						`${who} is out${by}`,
						(LOOKS[a] as (typeof LOOKS)[number]).color,
					);
				}
			} else if (ty === EV.WARN && !quiet) this.sfx.warn();
			else if (ty === EV.DROP) {
				this.fx.ring(0, -0.3, 0, arenaRadius(a + 1) + 1.2, EMBER, 2.2, 0.9);
				if (!quiet) this.cam.kick(0.2);
				if (!quiet) this.sfx.drop();
			} else if (ty === EV.DECIDED && !quiet) {
				this.bannerT = 0;
				if (a !== DRAW) this.sfx.win();
			}
		}
	}

	frame_(dt: number): void {
		const t0 = performance.now();
		this.gate.tick(dt);
		this.handleKeys();
		if (this.screen === "play" || this.screen === "title") {
			this.acc += dt;
			let n = 0;
			while (this.acc >= DT - 1e-9 && n < 5) {
				this.acc -= DT;
				this.liveTick();
				n++;
			}
			if (n === 5) this.acc = 0;
		} else if (this.screen === "replay") {
			if (this.replayHash === null && this.skipping) {
				const rec = this.rec as RoundRecord;
				for (let n = 0; n < SKIP_BUDGET; n++) {
					if (this.sim.phase === PHASE.OVER || this.sim.tick >= rec.log.length)
						break;
					this.replayTick();
				}
				if (this.sim.phase === PHASE.OVER || this.sim.tick >= rec.log.length)
					this.finishReplay();
			} else if (this.replayHash === null) {
				const rec = this.rec as RoundRecord;
				this.replayAcc += dt * replaySpeed(rec, this.sim.tick);
				let n = 0;
				while (this.replayAcc >= DT - 1e-9 && n < 6) {
					this.replayAcc -= DT;
					this.replayTick();
					n++;
				}
				if (n === 6) this.replayAcc = 0;
				if (this.sim.phase === PHASE.OVER || this.sim.tick >= rec.log.length)
					this.finishReplay();
				this.hud?.replaySpeed(
					replaySpeed(rec, this.sim.tick),
					this.sim.tick,
					rec.log.length,
				);
			} else {
				this.replayHold -= dt;
				if (this.replayHold <= 0) this.afterReplay();
			}
		} else if (this.screen === "results") {
			this.resultsT += dt;
			// victory lap: the last round re-simulated at half speed, looping
			const rec = this.rec;
			if (rec) {
				this.replayAcc += dt * 0.5;
				while (this.replayAcc >= DT - 1e-9) {
					this.replayAcc -= DT;
					if (
						this.sim.phase === PHASE.OVER ||
						this.sim.tick >= rec.log.length
					) {
						this.swapSim(new RoundSim(this.host, rec.seed, rec.active));
						break;
					}
					this.replayTick();
				}
			}
			if (this.p.demo && this.resultsT > 12) this.startMatch();
		}
		const t1 = performance.now();
		this.present(dt);
		const t2 = performance.now();
		this.cpu.sim += (t1 - t0 - this.cpu.sim) * 0.05;
		this.cpu.present += (t2 - t1 - this.cpu.present) * 0.05;
	}

	private present(dt: number): void {
		const sim = this.sim;
		const alpha =
			this.screen === "play" || this.screen === "title"
				? Math.min(1, this.acc / DT)
				: Math.min(1, this.replayAcc / DT);
		this.arena.update(sim, alpha, dt);
		this.orbs.update(sim, alpha, dt);
		this.fx.update(dt);
		this.sparks.update(dt);
		// camera focus: the centroid of orbs still on the island
		let cx = 0;
		let cz = 0;
		let n = 0;
		const op = this.orbs.pos;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			if (!this.orbs.visible[s] || (op[s * 3 + 1] as number) < -1) continue;
			cx += op[s * 3] as number;
			cz += op[s * 3 + 2] as number;
			n++;
		}
		if (n) {
			cx /= n;
			cz /= n;
		}
		let spread = 0;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			if (!this.orbs.visible[s] || (op[s * 3 + 1] as number) < -1) continue;
			spread = Math.max(
				spread,
				Math.hypot((op[s * 3] as number) - cx, (op[s * 3 + 2] as number) - cz),
			);
		}
		if (this.screen === "results") {
			const w = this.match.champion();
			if (w >= 0 && this.orbs.visible[w]) {
				cx = op[w * 3] as number;
				cz = op[w * 3 + 2] as number;
			}
		}
		this.cam.update(dt, cx, cz, spread, arenaRadius(sim.standingRings()));
		this.presentHud(dt);
	}

	private presentHud(dt: number): void {
		const hud = this.hud;
		if (!hud) return;
		hud.tick(dt);
		const sim = this.sim;
		if (this.screen !== "play") {
			if (this.screen !== "replay") hud.hideBanner();
			return;
		}
		hud.setClock(sim.clock());
		const standing = sim.standingRings();
		if (standing <= 0) hud.setStatus("Arena", "gone", true);
		else {
			const drop = ringDropTick(standing - 1);
			const left = (drop - sim.fightTick) / TICK_HZ;
			const hot = sim.fightTick >= drop - COLLAPSE.warn;
			hud.setStatus(
				standing === 1 ? "Last tile" : `Ring ${standing} falls in`,
				sim.phase === PHASE.COUNTDOWN
					? "—"
					: `${Math.max(0, left).toFixed(1)} s`,
				hot,
			);
		}
		const cam = this.game.renderer.three.camera;
		const w = window.innerWidth;
		const h = window.innerHeight;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			if (this.slots[s] === "off") continue;
			const out = sim.active[s] === true && !sim.alive[s];
			const cd = sim.cooldown[s] as number;
			hud.seat(
				s,
				out,
				out ? 0 : 1 - cd / ORB.dashCooldown,
				out ? "Out" : (sim.stun[s] as number) > 0 ? "Dazed" : "",
			);
			const vis = this.orbs.visible[s] === 1;
			if (vis) {
				const o = s * 3;
				_v.set(
					this.orbs.pos[o] as number,
					(this.orbs.pos[o + 1] as number) + ORB.radius + 1.0,
					this.orbs.pos[o + 2] as number,
				);
				_v.project(cam);
				hud.label(s, (_v.x * 0.5 + 0.5) * w, (-_v.y * 0.5 + 0.5) * h, _v.z < 1);
			} else hud.label(s, 0, 0, false);
		}
		// banners: countdown, GO, round winner
		if (sim.phase === PHASE.COUNTDOWN) {
			const c = COUNTDOWN_TICKS - sim.tick;
			const f = (c % TICK_HZ) / TICK_HZ;
			hud.showBanner(
				String(Math.ceil(c / TICK_HZ)),
				`Round ${this.match.round + 1}`,
				null,
				1 + f * 0.25,
			);
		} else if (sim.winner !== -2) {
			if (sim.winner === DRAW) hud.showBanner("Draw", "Everyone fell", null);
			else {
				const l = LOOKS[sim.winner] as (typeof LOOKS)[number];
				const champ = (this.match.wins[sim.winner] as number) + 1 >= this.toWin;
				hud.showBanner(
					l.name,
					champ ? "Match point taken" : "Takes the round",
					l.color,
				);
			}
		} else if (this.bannerT > 0) {
			this.bannerT -= dt;
			hud.showBanner("Shove!", "", null, 0.7 + (0.6 - this.bannerT) * 0.3);
		} else hud.hideBanner();
	}

	/** The on-screen round's world state hash (16 hex). */
	hash(): string {
		return this.sim.world.stateHash();
	}

	/** Automation hook (window.__pebble3d.game). */
	probe(): Record<string, unknown> {
		const s = this.sim;
		return {
			screen: this.screen,
			round: this.match.round,
			phase: PHASE_NAMES[s.phase],
			tick: s.tick,
			fightTick: s.fightTick,
			alive: Array.from(s.alive),
			winner: s.winner,
			wins: Array.from(this.match.wins),
			champion: this.match.champion(),
			collapsed: s.collapsed,
			hash: s.hash(),
			inputs: this.log.length,
			replay: this.rec
				? {
						round: this.rec.index,
						live: this.rec.hash,
						replay: this.replayHash,
						tick: s.tick,
					}
				: null,
			verified: this.verified.slice(),
			cpu: { simMs: this.cpu.sim, presentMs: this.cpu.present },
		};
	}
}
