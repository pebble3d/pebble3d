import type { Archetype } from "./ai/archetypes.ts";
import {
	chooseTarget,
	shouldAttack,
	strikeConnects,
	TARGET_OBJECTIVE,
	TARGET_PLAYER,
	turnToward,
} from "./ai/brain.ts";
import { type ArenaDef, collideArena, type Pos2 } from "./arena.ts";
import { type ComboContext, ComboMachine } from "./combat/combo.ts";
import { arcHits, circleHits, lineHits } from "./combat/hitbox.ts";
import {
	type HitDef,
	type MoveDef,
	type MoveSet,
	rangeValue,
} from "./combat/moves.ts";
import {
	ASSIST_HALF_ANGLE,
	ASSIST_RANGE,
	COMBO_TIMEOUT,
	DT,
	FOCUS_MAX,
	GRAVITY,
	HURT_IFRAMES,
	JUMP_SPEED,
	MAX_ZOMBIES,
	PLAYER_ACCEL,
	PLAYER_RADIUS,
	PLAYER_TURN_RATE,
	SPRINT_SPEED,
	WALK_SPEED,
} from "./constants.ts";
import { EV, EventQueue } from "./events.ts";
import { BTN, quantize, type TickInput } from "./input.ts";
import { nextPhase, PHASE, type Phase } from "./phase.ts";
import { Rng } from "./rng.ts";
import {
	applyUpgrade,
	defaultMods,
	type Mods,
	UPGRADES,
	type UpgradeSideEffects,
} from "./upgrades.ts";
import { WaveDirector, type WaveFile } from "./waves/director.ts";

/** Zombie states. */
export const ZS = {
	SPAWNING: 0,
	CHASE: 1,
	WINDUP: 2,
	STRIKE: 3,
	RECOVER: 4,
	STAGGER: 5,
	AIRBORNE: 6,
	DOWN: 7,
} as const;

/** Frames a zombie takes to climb out of the ground. */
export const SPAWN_FRAMES = 45;
/** Frames a launched zombie lies down after landing. */
const DOWN_FRAMES = 40;
const KNOCK_DECAY = 7;
const SHOCKWAVE: HitDef = {
	at: 0,
	len: 1,
	every: 0,
	shape: "circle",
	radius: 4.2,
	arc: Math.PI * 2,
	length: 0,
	width: 0,
	damage: 12,
	stagger: 24,
	knockback: 6,
	launch: 0,
	hitstop: 0,
	shake: 0.3,
	focus: 2,
	poise: 2,
	pull: 0,
};
/** Zombies closer than this to the gate keep attacking it even when the player is near. */
const OBJECTIVE_COMMIT = 2.2;

export class Zombie {
	alive = false;
	/** Serial id (stable across the zombie's life; presentation keys on it). */
	serial = 0;
	type = 0;
	x = 0;
	z = 0;
	y = 0;
	vy = 0;
	px = 0;
	pz = 0;
	py = 0;
	/** Steering velocity. */
	sx = 0;
	sz = 0;
	/** Knockback velocity. */
	kx = 0;
	kz = 0;
	heading = 0;
	hp = 0;
	maxHp = 0;
	state: number = ZS.SPAWNING;
	stateT = 0;
	target = TARGET_OBJECTIVE;
	cooldown = 0;
	hitKey = -1;
	/** Frames of white hit flash left. */
	flash = 0;
	/** Walk-cycle phase, radians (advanced by distance walked). */
	gait = 0;
	/** Per-zombie variation in [0, 1). */
	vary = 0;
}

export class Player {
	x = 0;
	z = 0;
	y = 0;
	vy = 0;
	px = 0;
	pz = 0;
	py = 0;
	vx = 0;
	vz = 0;
	kx = 0;
	kz = 0;
	facing = 0;
	hp = 100;
	focus = 0;
	hurtT = 0;
	dodgeCd = 0;
	dodgeX = 0;
	dodgeZ = 1;
	grounded = true;
	alive = true;
	/** Visual spin angle for Spin Storm, radians. */
	spin = 0;
	/** Distance walked (animation phase). */
	stride = 0;
}

export interface SimConfig {
	seed: number;
	arena: ArenaDef;
	moves: MoveSet;
	archetypes: Archetype[];
	waves: WaveFile;
	/** Skip the title and start the run immediately. */
	autoStart?: boolean;
	/** Start at this wave (1-based) — debugging and captures. */
	startWave?: number;
	/** Override the pre-wave countdown, frames. */
	preWaveFrames?: number;
}

const _pos: Pos2 = { x: 0, z: 0 };
/** Reused combo context (step() is allocation-free). */
const _ctx: ComboContext = {
	grounded: true,
	focusFull: false,
	dodgeReady: true,
};
const _side: UpgradeSideEffects = { healPlayer: false, repairGate: 0 };

/**
 * The whole game state, advanced one fixed 60 Hz tick at a time by `step(input)`.
 * Deterministic for a given config (seed) and input sequence; allocation-free per tick.
 * Rendering, audio and VFX read the state and drain `events`; they never write it.
 */
export class GameSim {
	readonly cfg: SimConfig;
	readonly arena: ArenaDef;
	readonly moves: MoveSet;
	readonly archetypes: Archetype[];
	readonly waves: WaveFile;
	readonly rng: Rng;
	readonly events = new EventQueue();
	readonly combo: ComboMachine;
	readonly player = new Player();
	readonly zombies: Zombie[] = [];
	readonly director = new WaveDirector();
	readonly objective = { x: 0, z: 0, radius: 1, hp: 0, maxHp: 0 };
	mods: Mods = defaultMods();
	/** Upgrade ids taken, in order. */
	readonly taken: string[] = [];
	/** Current offer: indices into UPGRADES (3 entries, -1 when none). */
	readonly offer = new Int8Array([-1, -1, -1]);

	phase: Phase = PHASE.TITLE;
	phaseT = 0;
	/** 1-based current wave (0 before the first). */
	wave = 0;
	/** Ticks since construction (never pauses). */
	tick = 0;
	/** Sim frames (pauses during hit-stop). */
	frame = 0;
	hitstop = 0;
	score = 0;
	kills = 0;
	comboHits = 0;
	comboT = 0;
	maxCombo = 0;
	alive = 0;
	/** Running total of camera shake requested this tick (presentation reads, sim resets). */
	shake = 0;
	private prevButtons = 0;
	private serial = 0;
	private readonly aliveIdx = new Int32Array(MAX_ZOMBIES);
	private readonly spawnWeights: number[];

	constructor(cfg: SimConfig) {
		this.cfg = cfg;
		this.arena = cfg.arena;
		this.moves = cfg.moves;
		this.archetypes = cfg.archetypes;
		this.waves = cfg.waves;
		this.rng = new Rng(cfg.seed);
		this.combo = new ComboMachine(cfg.moves);
		for (let i = 0; i < MAX_ZOMBIES; i++) this.zombies.push(new Zombie());
		this.spawnWeights = cfg.arena.spawns.map((s) => s.weight);
		this.resetRun();
		if (cfg.autoStart) this.startRun();
	}

	get totalWaves(): number {
		return this.waves.waves.length;
	}

	/** Score multiplier from the live combo: x1 .. x3. */
	get multiplier(): number {
		return 1 + Math.min(this.comboHits, 50) / 25;
	}

	playerInvulnerable(): boolean {
		return this.player.hurtT > 0 || this.combo.invulnerable();
	}

	// --- run lifecycle ---------------------------------------------------------------

	private resetRun(): void {
		const a = this.arena;
		const p = this.player;
		this.mods = defaultMods();
		this.taken.length = 0;
		p.x = p.px = a.playerStart[0];
		p.z = p.pz = a.playerStart[1];
		p.y = p.py = 0;
		p.vy = p.vx = p.vz = p.kx = p.kz = 0;
		p.spin = p.stride = 0;
		// face the arena's centre from the start
		p.facing = Math.atan2(
			(a.bounds.min[0] + a.bounds.max[0]) / 2 - p.x,
			(a.bounds.min[1] + a.bounds.max[1]) / 2 - p.z,
		);
		p.hp = this.mods.maxHp;
		p.focus = 0;
		p.hurtT = p.dodgeCd = 0;
		p.grounded = true;
		p.alive = true;
		this.combo.interrupt();
		for (const z of this.zombies) z.alive = false;
		this.alive = 0;
		this.director.reset();
		this.hitstop = 0;
		this.frame = 0;
		const o = a.objective;
		this.objective.x = o.x;
		this.objective.z = o.z;
		this.objective.radius = o.radius;
		this.objective.hp = this.objective.maxHp = o.hp;
		this.score = this.kills = this.comboHits = this.comboT = this.maxCombo = 0;
		this.wave = 0;
		this.offer.fill(-1);
	}

	private startRun(): void {
		this.resetRun();
		this.wave = Math.max(0, (this.cfg.startWave ?? 1) - 1);
		this.enterPreWave();
		this.events.push(EV.RUN_START);
	}

	private enterPreWave(): void {
		this.phase = PHASE.PRE_WAVE;
		this.wave++;
		this.phaseT = this.cfg.preWaveFrames ?? this.waves.preWaveFrames;
		this.events.push(EV.PRE_WAVE, this.wave);
	}

	private enterWave(): void {
		this.phase = PHASE.WAVE;
		const def = this.waves.waves[this.wave - 1];
		if (!def) throw new Error(`no wave ${this.wave}`);
		this.director.begin(def, this.archetypes, this.spawnWeights, this.rng);
		this.events.push(EV.WAVE_START, this.wave, 0, 0, 0, this.director.count);
	}

	private enterWaveClear(): void {
		this.phase = PHASE.WAVE_CLEAR;
		this.phaseT = this.waves.clearFrames;
		const o = this.objective;
		const bonus = 250 * this.wave + Math.round((o.hp / o.maxHp) * 500);
		this.score += bonus;
		const p = this.player;
		p.hp = Math.min(this.mods.maxHp, p.hp + this.mods.maxHp * 0.25);
		this.events.push(EV.WAVE_CLEAR, this.wave, 0, 0, 0, bonus);
	}

	private enterUpgrade(): void {
		this.phase = PHASE.UPGRADE;
		// three distinct offers among upgrades not yet maxed
		this.offer.fill(-1);
		let n = 0;
		for (let guard = 0; n < 3 && guard < 64; guard++) {
			const i = this.rng.int(UPGRADES.length);
			const u = UPGRADES[i];
			if (!u) continue;
			let dup = false;
			for (let k = 0; k < n; k++) if (this.offer[k] === i) dup = true;
			if (dup || this.timesTaken(u.id) >= u.max) continue;
			this.offer[n++] = i;
		}
		this.events.push(EV.UPGRADE_OFFER, this.wave);
	}

	timesTaken(id: string): number {
		let c = 0;
		for (const t of this.taken) if (t === id) c++;
		return c;
	}

	private pickUpgrade(slot: number): boolean {
		const i = this.offer[slot] ?? -1;
		const u = i >= 0 ? UPGRADES[i] : undefined;
		if (!u) return false;
		applyUpgrade(this.mods, u.id, _side);
		this.taken.push(u.id);
		const p = this.player;
		if (_side.healPlayer) p.hp = this.mods.maxHp;
		if (_side.repairGate > 0) {
			const o = this.objective;
			o.hp = Math.min(o.maxHp, o.hp + o.maxHp * _side.repairGate);
		}
		this.events.push(EV.UPGRADE_PICK, i);
		return true;
	}

	// --- tick ----------------------------------------------------------------------------

	/** Advances one 60 Hz tick with this tick's held input. */
	step(input: TickInput): void {
		this.tick++;
		this.shake = 0;
		const mx = quantize(input.mx);
		const mz = quantize(input.mz);
		const held = input.buttons;
		const pressed = held & ~this.prevButtons;
		this.prevButtons = held;
		const startPressed = (pressed & BTN.START) !== 0;

		let picked = false;
		if (this.phase === PHASE.UPGRADE) {
			if (pressed & BTN.PICK1) picked = this.pickUpgrade(0);
			else if (pressed & BTN.PICK2) picked = this.pickUpgrade(1);
			else if (pressed & BTN.PICK3) picked = this.pickUpgrade(2);
		}

		const active =
			this.phase === PHASE.PRE_WAVE ||
			this.phase === PHASE.WAVE ||
			this.phase === PHASE.WAVE_CLEAR;
		if (active) this.updateWorld(mx, mz, held, pressed);
		// hit-stop pauses phase timers only while the world is running
		if (this.phaseT > 0 && (this.hitstop === 0 || !active)) this.phaseT--;

		const phase = this.phase;
		const next = nextPhase({
			phase,
			wave: this.wave,
			totalWaves: this.totalWaves,
			upgradeEvery: this.waves.upgradeEvery,
			timerDone: this.phaseT <= 0,
			startPressed:
				startPressed &&
				(phase !== PHASE.GAME_OVER && phase !== PHASE.VICTORY
					? true
					: this.phaseT <= 0),
			picked,
			playerDead: !this.player.alive,
			objectiveDead: this.objective.hp <= 0,
			waveDone:
				phase === PHASE.WAVE && this.director.exhausted && this.alive === 0,
		});
		if (next === phase) return;
		switch (next) {
			case PHASE.PRE_WAVE:
				if (phase === PHASE.TITLE || phase >= PHASE.VICTORY) this.startRun();
				else this.enterPreWave();
				break;
			case PHASE.WAVE:
				this.enterWave();
				break;
			case PHASE.WAVE_CLEAR:
				this.enterWaveClear();
				break;
			case PHASE.UPGRADE:
				this.enterUpgrade();
				break;
			case PHASE.VICTORY:
				this.phase = PHASE.VICTORY;
				this.phaseT = 90;
				this.hitstop = 0;
				this.events.push(EV.VICTORY, this.wave, 0, 0, 0, this.score);
				break;
			case PHASE.GAME_OVER:
				this.phase = PHASE.GAME_OVER;
				this.phaseT = 90;
				// hit-stop only drains in updateWorld, which stops running here: a hit that
				// connected this tick would otherwise freeze phaseT and block the restart
				this.hitstop = 0;
				this.combo.interrupt();
				this.events.push(
					EV.GAME_OVER,
					this.player.alive ? 1 : 0,
					0,
					0,
					0,
					this.score,
				);
				break;
		}
	}

	private updateWorld(
		mx: number,
		mz: number,
		held: number,
		pressed: number,
	): void {
		if (this.hitstop > 0) {
			// Frozen: the move does not advance or route; presses only buffer (timestamps use
			// the paused frame counter) and start their move once hit-stop ends.
			this.hitstop--;
			this.combo.buffer(pressed, this.frame);
			return;
		}
		this.frame++;
		this.savePrev();
		if (this.phase === PHASE.WAVE) this.spawnFromDirector();
		this.updatePlayer(mx, mz, held, pressed);
		this.updateZombies();
		this.separate();
		this.resolvePlayerAttack();
		if (this.comboT > 0 && --this.comboT === 0) this.comboHits = 0;
	}

	private savePrev(): void {
		const p = this.player;
		p.px = p.x;
		p.pz = p.z;
		p.py = p.y;
		for (const z of this.zombies) {
			if (!z.alive) continue;
			z.px = z.x;
			z.pz = z.z;
			z.py = z.y;
		}
	}

	// --- player --------------------------------------------------------------------------

	private updatePlayer(
		mx: number,
		mz: number,
		held: number,
		pressed: number,
	): void {
		const p = this.player;
		if (!p.alive) return;
		if (p.hurtT > 0) p.hurtT--;
		if (p.dodgeCd > 0) p.dodgeCd--;
		const c = this.combo;
		const hasStick = mx * mx + mz * mz > 0.04;

		_ctx.grounded = p.grounded;
		_ctx.focusFull = p.focus >= FOCUS_MAX;
		_ctx.dodgeReady = p.dodgeCd === 0;
		const started = c.update(pressed, held, this.frame, _ctx);
		if (started >= 0) this.onMoveStart(started, mx, mz, hasStick);

		if (pressed & BTN.JUMP && p.grounded && c.canJump()) {
			if (c.move >= 0) c.interrupt();
			p.vy = JUMP_SPEED;
			p.grounded = false;
			this.events.push(EV.JUMP, 0, p.x, p.y, p.z);
		}

		const d = c.def;
		let vx: number;
		let vz: number;
		if (d) {
			const f = c.frame;
			const fx = Math.sin(p.facing);
			const fz = Math.cos(p.facing);
			if (d.dash.length > 0) {
				const s = rangeValue(d.dash, f, 0);
				vx = p.dodgeX * s;
				vz = p.dodgeZ * s;
			} else {
				const s = rangeValue(d.root, f, 0);
				vx = fx * s;
				vz = fz * s;
			}
			if (d.steer > 0) {
				vx += mx * WALK_SPEED * d.steer;
				vz += mz * WALK_SPEED * d.steer;
			}
			const vy = rangeValue(d.vy, f, Number.NaN);
			if (!Number.isNaN(vy)) p.vy = vy;
			if (d.spin > 0) p.spin += d.spin * DT;
			if (d.charge && f === d.charge.at && c.charge === d.charge.min)
				this.events.push(EV.CHARGE_READY, 0, p.x, p.y, p.z);
			p.vx = vx;
			p.vz = vz;
		} else {
			const sp = held & BTN.SPRINT ? SPRINT_SPEED : WALK_SPEED;
			const a = 1 - Math.exp(-PLAYER_ACCEL * DT);
			p.vx += (mx * sp - p.vx) * a;
			p.vz += (mz * sp - p.vz) * a;
			if (hasStick)
				p.facing = turnToward(
					p.facing,
					Math.atan2(mx, mz),
					PLAYER_TURN_RATE * DT,
				);
			vx = p.vx;
			vz = p.vz;
		}
		p.x += (vx + p.kx) * DT;
		p.z += (vz + p.kz) * DT;
		const kd = Math.exp(-KNOCK_DECAY * DT);
		p.kx *= kd;
		p.kz *= kd;
		p.stride += Math.hypot(vx, vz) * DT;

		if (!p.grounded) {
			p.vy -= GRAVITY * DT;
			p.y += p.vy * DT;
			if (p.y <= 0) {
				p.y = 0;
				p.vy = 0;
				p.grounded = true;
				this.events.push(EV.LAND, c.move, p.x, 0, p.z);
			}
		}
		_pos.x = p.x;
		_pos.z = p.z;
		collideArena(this.arena, _pos, PLAYER_RADIUS, this.objective.radius);
		p.x = _pos.x;
		p.z = _pos.z;
	}

	private onMoveStart(i: number, mx: number, mz: number, stick: boolean): void {
		const p = this.player;
		const d = this.moves.moves[i] as MoveDef;
		if (d.focusCost > 0) p.focus = Math.max(0, p.focus - d.focusCost);
		if (i === this.moves.dodge) {
			if (stick) {
				const l = Math.hypot(mx, mz);
				p.dodgeX = mx / l;
				p.dodgeZ = mz / l;
				p.facing = Math.atan2(mx, mz);
			} else {
				p.dodgeX = -Math.sin(p.facing);
				p.dodgeZ = -Math.cos(p.facing);
			}
			p.dodgeCd = Math.round(d.cooldown * this.mods.dodgeCooldown);
			this.events.push(EV.DODGE, 0, p.x, p.y, p.z, p.dodgeX, p.dodgeZ);
			return;
		}
		let dir = stick ? Math.atan2(mx, mz) : p.facing;
		// aim assist: snap to the nearest zombie inside a cone around the intended direction
		let best = ASSIST_RANGE * ASSIST_RANGE;
		const fx = Math.sin(dir);
		const fz = Math.cos(dir);
		let target = -1;
		for (let k = 0; k < this.zombies.length; k++) {
			const z = this.zombies[k] as Zombie;
			if (!z.alive || z.state === ZS.SPAWNING) continue;
			const dx = z.x - p.x;
			const dz = z.z - p.z;
			const d2 = dx * dx + dz * dz;
			if (d2 >= best || d2 < 1e-6) continue;
			const cos = (dx * fx + dz * fz) / Math.sqrt(d2);
			if (cos < Math.cos(ASSIST_HALF_ANGLE)) continue;
			best = d2;
			target = k;
		}
		if (target >= 0) {
			const z = this.zombies[target] as Zombie;
			dir = Math.atan2(z.x - p.x, z.z - p.z);
		}
		p.facing = dir;
		if (i === this.moves.spinStorm) this.events.push(EV.SPIN, i, p.x, p.y, p.z);
		this.events.push(EV.SWING, i, p.x, p.y, p.z);
	}

	private hurtPlayer(
		dmg: number,
		fromX: number,
		fromZ: number,
		heavy: boolean,
	): void {
		const p = this.player;
		p.hp -= dmg;
		p.hurtT = HURT_IFRAMES;
		let dx = p.x - fromX;
		let dz = p.z - fromZ;
		const l = Math.hypot(dx, dz) || 1;
		dx /= l;
		dz /= l;
		const kb = heavy ? 9 : 4;
		p.kx = dx * kb;
		p.kz = dz * kb;
		this.comboHits = 0;
		this.comboT = 0;
		if (heavy) this.combo.interrupt();
		this.shake += heavy ? 0.6 : 0.3;
		this.events.push(EV.PLAYER_HURT, heavy ? 1 : 0, p.x, p.y + 1.1, p.z, dmg);
		if (p.hp <= 0) {
			p.hp = 0;
			p.alive = false;
			this.combo.interrupt();
			this.events.push(EV.PLAYER_DOWN, 0, p.x, p.y, p.z);
		}
	}

	// --- player attacks -------------------------------------------------------------------

	private resolvePlayerAttack(): void {
		const c = this.combo;
		const d = c.def;
		if (!d || !this.player.alive) return;
		const f = c.frame;
		for (let hi = 0; hi < d.hits.length; hi++) {
			const h = d.hits[hi] as HitDef;
			if (f < h.at || f >= h.at + h.len) continue;
			let bucket = 0;
			if (h.every > 0) {
				if ((f - h.at) % h.every !== 0) continue;
				bucket = (f - h.at) / h.every;
			}
			const key = c.swing * 4096 + hi * 256 + bucket;
			this.applyHitShape(h, d, key, 1);
			const isHeavyStrike =
				f === h.at && (d.shockwave || (this.mods.shockwave && d.charge));
			if (isHeavyStrike) {
				const p = this.player;
				const r = d.shockwave ? 1 : 0.8;
				this.events.push(
					EV.SHOCKWAVE,
					0,
					p.x + Math.sin(p.facing) * 1.6,
					0,
					p.z + Math.cos(p.facing) * 1.6,
					SHOCKWAVE.radius * r,
				);
				this.applyHitShape(SHOCKWAVE, d, key + 128, r);
			}
		}
	}

	/** Tests every zombie against one hit and applies it; returns the number struck. */
	private applyHitShape(
		h: HitDef,
		d: MoveDef,
		key: number,
		scale: number,
	): number {
		const p = this.player;
		const fx = Math.sin(p.facing);
		const fz = Math.cos(p.facing);
		const arcMul = h.shape === "arc" ? this.mods.arc : 1;
		const radius = h.radius * arcMul * scale;
		const arc = Math.min(Math.PI * 2, h.arc * arcMul);
		let ox = p.x;
		let oz = p.z;
		if (h === SHOCKWAVE) {
			ox += fx * 1.6;
			oz += fz * 1.6;
		}
		let struck = 0;
		let hitstop = 0;
		for (let k = 0; k < this.zombies.length; k++) {
			const z = this.zombies[k] as Zombie;
			if (!z.alive || z.hitKey === key) continue;
			if (z.state === ZS.SPAWNING && z.stateT > SPAWN_FRAMES / 2) continue;
			if (z.y > p.y + 2.6) continue;
			const tr = (this.archetypes[z.type] as Archetype).radius;
			let hit = false;
			if (h.shape === "arc")
				hit = arcHits(ox, oz, fx, fz, radius, arc, z.x, z.z, tr);
			else if (h.shape === "circle")
				hit = circleHits(ox, oz, radius, z.x, z.z, tr);
			else hit = lineHits(ox, oz, fx, fz, h.length, h.width, z.x, z.z, tr);
			if (!hit) continue;
			z.hitKey = key;
			this.hitZombie(z, h, d, ox, oz);
			struck++;
			if (h.hitstop > hitstop) hitstop = h.hitstop;
		}
		if (struck > 0) {
			if (hitstop > this.hitstop) this.hitstop = hitstop;
			this.shake += h.shake;
			if (d.finisher && this.mods.lifesteal > 0)
				p.hp = Math.min(this.mods.maxHp, p.hp + this.mods.lifesteal * struck);
		}
		return struck;
	}

	private hitZombie(
		z: Zombie,
		h: HitDef,
		d: MoveDef,
		ox: number,
		oz: number,
	): void {
		const a = this.archetypes[z.type] as Archetype;
		const p = this.player;
		const airborne = z.y > 0.05;
		const dmg = h.damage * this.mods.damage * (airborne ? 1.2 : 1);
		z.hp -= dmg;
		z.flash = 6;
		let dx = z.x - ox;
		let dz = z.z - oz;
		const l = Math.hypot(dx, dz);
		if (l < 1e-4) {
			dx = Math.sin(p.facing);
			dz = Math.cos(p.facing);
		} else {
			dx /= l;
			dz /= l;
		}
		const kb = (h.knockback - h.pull) / a.mass;
		z.kx = dx * kb;
		z.kz = dz * kb;
		const wasWindup = z.state === ZS.WINDUP;
		if (h.launch > 0 && a.mass <= 1) {
			z.vy = h.launch;
			z.y = Math.max(z.y, 0.06);
			z.state = ZS.AIRBORNE;
		} else if (airborne) {
			z.vy = Math.max(z.vy, 3.4);
		} else if (h.poise >= a.poise && z.state !== ZS.SPAWNING) {
			z.state = ZS.STAGGER;
			z.stateT = h.stagger;
		}
		if (wasWindup && z.state !== ZS.WINDUP)
			this.events.push(EV.TELEGRAPH, z.serial, z.x, 0, z.z, -1);

		this.comboHits++;
		this.comboT = COMBO_TIMEOUT;
		if (this.comboHits > this.maxCombo) this.maxCombo = this.comboHits;
		const before = p.focus;
		p.focus = Math.min(FOCUS_MAX, p.focus + h.focus * this.mods.focusGain);
		if (before < FOCUS_MAX && p.focus >= FOCUS_MAX)
			this.events.push(EV.FOCUS_FULL, 0, p.x, p.y, p.z);
		this.events.push(
			EV.HIT,
			d.index,
			z.x,
			z.y + a.height * 0.6,
			z.z,
			dmg,
			h.poise >= 2 ? 1 : 0,
		);
		if (z.hp <= 0) this.killZombie(z, dx, dz, Math.abs(kb) + 2 + h.launch);
	}

	private killZombie(z: Zombie, dx: number, dz: number, force: number): void {
		const a = this.archetypes[z.type] as Archetype;
		z.alive = false;
		this.alive--;
		this.kills++;
		this.score += Math.round(a.score * this.multiplier);
		this.events.push(EV.KILL, z.serial, z.x, z.y, z.z, dx * force, dz * force);
	}

	// --- zombies ---------------------------------------------------------------------------

	private spawnFromDirector(): void {
		const q = this.director.next(this.alive, this.rng);
		if (q < 0) return;
		let z: Zombie | null = null;
		for (const c of this.zombies)
			if (!c.alive) {
				z = c;
				break;
			}
		if (!z) return;
		const type = this.director.type[q] as number;
		const sp = this.arena.spawns[this.director.spawn[q] as number];
		if (!sp) return;
		const a = this.archetypes[type] as Archetype;
		const ang = this.rng.next() * Math.PI * 2;
		const r = this.rng.next() * 1.3;
		z.alive = true;
		z.serial = ++this.serial;
		z.type = type;
		_pos.x = sp.x + Math.cos(ang) * r;
		_pos.z = sp.z + Math.sin(ang) * r;
		collideArena(this.arena, _pos, a.radius, 0);
		z.x = z.px = _pos.x;
		z.z = z.pz = _pos.z;
		z.y = z.py = 0;
		z.vy = z.sx = z.sz = z.kx = z.kz = 0;
		z.heading = Math.atan2(this.objective.x - z.x, this.objective.z - z.z);
		const hpScale = 1 + this.waves.hpScalePerWave * (this.wave - 1);
		z.hp = z.maxHp = a.hp * hpScale;
		z.state = ZS.SPAWNING;
		z.stateT = SPAWN_FRAMES;
		z.target = TARGET_OBJECTIVE;
		z.cooldown = 20 + this.rng.int(40);
		z.hitKey = -1;
		z.flash = 0;
		z.gait = this.rng.next() * Math.PI * 2;
		z.vary = this.rng.next();
		this.alive++;
		this.events.push(EV.SPAWN, z.serial, z.x, 0, z.z, type);
	}

	private updateZombies(): void {
		const p = this.player;
		const o = this.objective;
		const kd = Math.exp(-KNOCK_DECAY * DT);
		for (let k = 0; k < this.zombies.length; k++) {
			const z = this.zombies[k] as Zombie;
			if (!z.alive) continue;
			const a = this.archetypes[z.type] as Archetype;
			if (z.flash > 0) z.flash--;
			if (z.cooldown > 0) z.cooldown--;
			z.sx = 0;
			z.sz = 0;

			switch (z.state) {
				case ZS.SPAWNING:
					if (--z.stateT <= 0) z.state = ZS.CHASE;
					break;
				case ZS.AIRBORNE:
					z.vy -= GRAVITY * 0.75 * DT;
					z.y += z.vy * DT;
					if (z.y <= 0) {
						z.y = 0;
						z.vy = 0;
						z.state = ZS.DOWN;
						z.stateT = DOWN_FRAMES;
						this.events.push(EV.ZOMBIE_LAND, z.serial, z.x, 0, z.z);
					}
					break;
				case ZS.DOWN:
				case ZS.STAGGER:
					if (--z.stateT <= 0) z.state = ZS.CHASE;
					break;
				case ZS.CHASE: {
					const dpx = p.x - z.x;
					const dpz = p.z - z.z;
					const distP = Math.hypot(dpx, dpz);
					const dox = o.x - z.x;
					const doz = o.z - z.z;
					const distO = Math.hypot(dox, doz);
					z.target = chooseTarget(
						z.target,
						distP,
						a.aggro,
						p.alive,
						distO - o.radius,
						OBJECTIVE_COMMIT,
					);
					const toP = z.target === TARGET_PLAYER;
					const tx = toP ? dpx : dox;
					const tz = toP ? dpz : doz;
					const dist = toP ? distP : distO;
					const edge = dist - a.radius - (toP ? PLAYER_RADIUS : o.radius);
					const want = Math.atan2(tx, tz);
					z.heading = turnToward(z.heading, want, 5 * DT);
					if (
						shouldAttack(edge, a.slam ? a.reach * 0.55 : a.reach, z.cooldown)
					) {
						z.state = ZS.WINDUP;
						z.stateT = a.windup;
						this.events.push(EV.TELEGRAPH, z.serial, z.x, 0, z.z, a.windup);
						break;
					}
					const speed = a.speed * (0.9 + 0.2 * z.vary);
					// steer, sliding along obstacles: blend the target direction with an
					// avoidance push from nearby boxes
					let sx = tx / (dist || 1);
					let sz = tz / (dist || 1);
					this.avoid(z, a.radius, sx, sz);
					sx = _pos.x;
					sz = _pos.z;
					z.sx = sx * speed;
					z.sz = sz * speed;
					break;
				}
				case ZS.WINDUP: {
					if (a.id === "runner" && z.target === TARGET_PLAYER)
						z.heading = turnToward(
							z.heading,
							Math.atan2(p.x - z.x, p.z - z.z),
							3 * DT,
						);
					if (--z.stateT <= 0) {
						z.state = ZS.STRIKE;
						z.stateT = a.strike;
						this.zombieStrike(z, a);
					}
					break;
				}
				case ZS.STRIKE:
					if (--z.stateT <= 0) {
						z.state = ZS.RECOVER;
						z.stateT = a.recover;
					}
					break;
				case ZS.RECOVER:
					if (--z.stateT <= 0) {
						z.state = ZS.CHASE;
						z.cooldown = a.cooldown;
					}
					break;
			}

			z.x += (z.sx + z.kx) * DT;
			z.z += (z.sz + z.kz) * DT;
			z.kx *= kd;
			z.kz *= kd;
			z.gait += Math.hypot(z.sx, z.sz) * DT * 2.4;
		}
	}

	/** Steering direction `(sx, sz)` bent away from obstacles ahead; result in `_pos`. */
	private avoid(z: Zombie, r: number, sx: number, sz: number): void {
		let ax = sx;
		let az = sz;
		const obs = this.arena.obstacles;
		for (let i = 0; i < obs.length; i++) {
			const b = obs[i];
			if (!b) continue;
			const dx = z.x - b.x;
			const dz = z.z - b.z;
			const cx = dx < -b.hx ? -b.hx : Math.min(dx, b.hx);
			const cz = dz < -b.hz ? -b.hz : Math.min(dz, b.hz);
			const ox = dx - cx;
			const oz = dz - cz;
			const d = Math.hypot(ox, oz);
			const range = r + 1.2;
			if (d > range || d < 1e-5) continue;
			// heading into it? add a tangential push (pick the side the target lies on)
			const nx = ox / d;
			const nz = oz / d;
			const into = -(sx * nx + sz * nz);
			if (into <= 0) continue;
			const w = (1 - d / range) * 2.2 * into;
			const tx = -nz;
			const tz = nx;
			const side = tx * sx + tz * sz >= 0 ? 1 : -1;
			ax += (tx * side + nx * 0.5) * w;
			az += (tz * side + nz * 0.5) * w;
		}
		const l = Math.hypot(ax, az) || 1;
		_pos.x = ax / l;
		_pos.z = az / l;
	}

	private zombieStrike(z: Zombie, a: Archetype): void {
		const p = this.player;
		const o = this.objective;
		this.events.push(EV.STRIKE, z.serial, z.x, 0, z.z, a.slam ? a.reach : 0);
		if (a.slam) this.shake += 0.35;
		// the player
		if (
			p.alive &&
			strikeConnects(
				z.x,
				z.z,
				a.radius,
				z.heading,
				a.arc,
				a.reach,
				p.x,
				p.z,
				PLAYER_RADIUS,
			) &&
			p.y < 1.2
		) {
			if (this.playerInvulnerable()) {
				if (this.combo.invulnerable()) {
					p.focus = Math.min(FOCUS_MAX, p.focus + 12 * this.mods.focusGain);
					this.events.push(EV.PERFECT_DODGE, z.serial, p.x, p.y + 1.2, p.z);
				}
			} else {
				this.hurtPlayer(a.damage, z.x, z.z, a.slam);
			}
		}
		// the gate
		if (
			strikeConnects(
				z.x,
				z.z,
				a.radius,
				z.heading,
				a.arc,
				a.reach + 0.15,
				o.x,
				o.z,
				o.radius,
			)
		) {
			o.hp = Math.max(0, o.hp - a.objDamage);
			this.events.push(EV.OBJ_HIT, z.serial, o.x, 1, o.z, a.objDamage);
		}
	}

	/** Pairwise separation, player body blocking and arena collision. O(n^2), n <= 48. */
	private separate(): void {
		let n = 0;
		for (let k = 0; k < this.zombies.length; k++)
			if ((this.zombies[k] as Zombie).alive) this.aliveIdx[n++] = k;
		const arch = this.archetypes;
		for (let i = 0; i < n; i++) {
			const zi = this.zombies[this.aliveIdx[i] as number] as Zombie;
			if (zi.y > 0.5) continue;
			const ai = arch[zi.type] as Archetype;
			for (let j = i + 1; j < n; j++) {
				const zj = this.zombies[this.aliveIdx[j] as number] as Zombie;
				if (zj.y > 0.5) continue;
				const aj = arch[zj.type] as Archetype;
				const dx = zj.x - zi.x;
				const dz = zj.z - zi.z;
				const rr = (ai.radius + aj.radius) * 0.95;
				const d2 = dx * dx + dz * dz;
				if (d2 >= rr * rr) continue;
				const d = Math.sqrt(d2) || 1e-4;
				const push = (rr - d) / d;
				const wi = aj.mass / (ai.mass + aj.mass);
				const wj = 1 - wi;
				zi.x -= dx * push * wi;
				zi.z -= dz * push * wi;
				zj.x += dx * push * wj;
				zj.z += dz * push * wj;
			}
		}
		const p = this.player;
		const phasing = this.combo.invulnerable();
		for (let i = 0; i < n; i++) {
			const z = this.zombies[this.aliveIdx[i] as number] as Zombie;
			const a = arch[z.type] as Archetype;
			if (!phasing && p.alive && z.y < 0.5 && p.y < 0.8) {
				const dx = z.x - p.x;
				const dz = z.z - p.z;
				const rr = a.radius + PLAYER_RADIUS;
				const d2 = dx * dx + dz * dz;
				if (d2 < rr * rr) {
					const d = Math.sqrt(d2) || 1e-4;
					const push = (rr - d) / d;
					const wp = Math.min(0.6, a.mass / (a.mass + 2));
					p.x -= dx * push * wp;
					p.z -= dz * push * wp;
					z.x += dx * push * (1 - wp);
					z.z += dz * push * (1 - wp);
				}
			}
			_pos.x = z.x;
			_pos.z = z.z;
			collideArena(this.arena, _pos, a.radius, this.objective.radius);
			z.x = _pos.x;
			z.z = _pos.z;
		}
		_pos.x = p.x;
		_pos.z = p.z;
		collideArena(this.arena, _pos, PLAYER_RADIUS, this.objective.radius);
		p.x = _pos.x;
		p.z = _pos.z;
	}

	// --- inspection --------------------------------------------------------------------------

	/** FNV-1a over the quantised game state, as 8 hex chars. Allocates only the string. */
	hash(): string {
		let h = 0x811c9dc5;
		const mix = (v: number): void => {
			let q = Math.round(v * 1000) | 0;
			for (let i = 0; i < 4; i++) {
				h ^= q & 0xff;
				h = Math.imul(h, 0x01000193);
				q >>>= 8;
			}
		};
		mix(this.tick);
		mix(this.frame);
		mix(this.phase);
		mix(this.wave);
		mix(this.score);
		mix(this.kills);
		mix(this.objective.hp);
		mix(this.rng.state);
		const p = this.player;
		mix(p.x);
		mix(p.z);
		mix(p.y);
		mix(p.hp);
		mix(p.focus);
		mix(p.facing);
		mix(this.combo.move);
		mix(this.combo.frame);
		for (const z of this.zombies) {
			if (!z.alive) continue;
			mix(z.serial);
			mix(z.x);
			mix(z.z);
			mix(z.y);
			mix(z.hp);
			mix(z.state);
		}
		return (h >>> 0).toString(16).padStart(8, "0");
	}
}
