import { type SimHandle, StateViews } from "@pebble3d/sdk/sim";
import {
	ARENA_HALF,
	BREATHER_TICKS,
	COUNTDOWN_TICKS,
	CRUMBLE_PER_TICK,
	DT,
	INVULN_TICKS,
	KNOCK_TICKS,
	MAX_HP,
	MAX_PICKUPS,
	MAX_ROCKS,
	MULT_MAX,
	MULT_STEP,
	NEAR_MISS_POINTS,
	NEAR_MISS_RANGE,
	PICKUP_RADIUS,
	PILLAR_HALF,
	PILLAR_HEIGHT,
	PILLARS,
	PLAYER_CENTER_Y,
	PLAYER_HALF_HEIGHT,
	PLAYER_JUMP,
	PLAYER_MASS,
	PLAYER_RADIUS,
	PLAYER_SPEED,
	PLAYER_SPRINT,
	POINTS_PER_SECOND,
	ROCK_CAPACITY,
	SPAWN_INSET,
	STAMINA_MAX,
	STAMINA_REGEN,
	WALL_HEIGHT,
	WALL_THICK,
	WAVE_TICKS,
} from "./constants.ts";
import { EV, EventQueue } from "./events.ts";
import { BTN, quantize, type TickInput } from "./input.ts";
import { PHASE, type Phase } from "./phase.ts";
import { Rng } from "./rng.ts";
import {
	KIND,
	type Kind,
	ROCK_KINDS,
	rockBody,
	variantRadius,
} from "./rocks.ts";
import { ARENA_BOX, PATTERN, planWave, type WaveOrder } from "./waves.ts";

/** Makes a fresh engine world (one per run, so every run starts from identical state). */
export type WorldFactory = (seed: number) => SimHandle;

export interface SimConfig {
	seed: number;
	/** First wave of a run (captures start late for big body counts). */
	startWave: number;
	/** Rubble rocks dropped during the countdown (captures: a lived-in arena at once). */
	rubble: number;
	/** No damage (perf runs and long captures). */
	god: boolean;
	/** Skip the title: the first tick starts the countdown. */
	autoStart: boolean;
	/** Live rock cap; past it the oldest rocks crumble away. */
	maxRocks: number;
}

export function defaultConfig(over: Partial<SimConfig> = {}): SimConfig {
	return {
		seed: 7,
		startWave: 1,
		rubble: 0,
		god: false,
		autoStart: false,
		maxRocks: MAX_ROCKS,
		...over,
	};
}

export const PICKUP = { CRYSTAL: 0, HEART: 1, SHIELD: 2 } as const;
const PICKUP_LIFE = [12 * 60, 15 * 60, 15 * 60];
const CRYSTAL_POINTS = 250;
const HEART_HEAL = 30;

/** Rock flag bits. */
const F_FALLING = 1;
const F_LANDED = 2;
const F_HIT = 4;
const F_NEAR = 8;

/** Speed (m/s) toward the player at which a sideways slab or boulder hurts. */
const ROLL_LETHAL = 4.5;
const BLAST_RADIUS = 4;
const BLAST_PLAYER_RADIUS = 2.6;
const BLAST_DAMAGE = 16;
/** The attract (title) loop rains this wave's mix. */
const ATTRACT_WAVE = 5;
const ATTRACT_RUBBLE = 600;
/** Game over -> restart allowed after this many ticks. */
const OVER_LOCK = 90;
/** wasm raycast filter: exclude one id. */
const RAY_EXCLUDE = 2;

interface ActiveSpawner {
	id: number;
	end: number;
}

/**
 * Rockfall's deterministic game sim. It owns the engine world: the arena statics, the KCC
 * player and every rock. All rocks come from the engine's Rust-side seeded spawners, which
 * the wave director creates on schedule; the sim tracks each spawned body (by slot) to
 * judge hits, near misses, landings and meteor blasts. One `step` = one 60 Hz tick.
 */
export class RockfallSim {
	readonly cfg: SimConfig;
	readonly events = new EventQueue();
	private readonly makeWorld: WorldFactory;
	handle!: SimHandle;
	views!: StateViews;

	phase: Phase = PHASE.TITLE;
	/** Ticks since the sim was created. */
	tick = 0;
	/** Ticks in the current phase. */
	phaseTick = 0;
	/** Ticks survived in the current run (waves and breathers). */
	survived = 0;
	runs = 0;
	wave = 0;
	score = 0;
	mult = 1;
	hp = MAX_HP;
	shield = false;
	stamina = STAMINA_MAX;
	nearMisses = 0;
	crystals = 0;
	hitsTaken = 0;
	invuln = 0;
	private knock = 0;
	private knockX = 0;
	private knockZ = 0;
	private prevButtons = 0;
	private scoreFrac = 0;

	// --- player ---
	playerId = 0;
	playerSlot = -1;
	px = 0;
	py = PLAYER_CENTER_Y;
	pz = 0;
	grounded = true;
	/** Last applied move direction (for facing when idle-pushed). */
	moveX = 0;
	moveZ = 0;
	sprinting = false;

	// --- rocks (parallel arrays, swap-removed) ---
	readonly rockId = new Uint32Array(ROCK_CAPACITY);
	readonly rockSlot = new Int32Array(ROCK_CAPACITY);
	readonly rockKind = new Uint8Array(ROCK_CAPACITY);
	readonly rockVar = new Uint8Array(ROCK_CAPACITY);
	readonly rockR = new Float32Array(ROCK_CAPACITY);
	readonly rockBorn = new Int32Array(ROCK_CAPACITY);
	readonly rockFlags = new Uint8Array(ROCK_CAPACITY);
	private readonly rockVy = new Float32Array(ROCK_CAPACITY);
	rockCount = 0;
	/** Rocks spawned this tick: slot, kind, variant (for the presentation). */
	readonly addedSlot = new Int32Array(ROCK_CAPACITY);
	readonly addedKind = new Uint8Array(ROCK_CAPACITY);
	readonly addedVar = new Uint8Array(ROCK_CAPACITY);
	addedN = 0;
	/** Slots freed this tick (despawned rocks). */
	readonly removedSlot = new Int32Array(ROCK_CAPACITY);
	removedN = 0;
	totalSpawned = 0;

	// --- pickups ---
	readonly pkType = new Int8Array(MAX_PICKUPS).fill(-1);
	readonly pkX = new Float32Array(MAX_PICKUPS);
	readonly pkY = new Float32Array(MAX_PICKUPS);
	readonly pkZ = new Float32Array(MAX_PICKUPS);
	readonly pkBorn = new Int32Array(MAX_PICKUPS);

	// --- director ---
	private orders: WaveOrder[] = [];
	private orderIdx = 0;
	private waveStart = 0;
	private readonly spawners: ActiveSpawner[] = [];
	/** spawner sim id -> kind * 16 + variant */
	private readonly spawnerKind = new Map<number, number>();
	private waveRng: Rng;
	private spinRng: Rng;
	private pickRng: Rng;
	private readonly bodyJson: string[][];

	constructor(makeWorld: WorldFactory, cfg: SimConfig) {
		this.cfg = cfg;
		this.makeWorld = makeWorld;
		this.waveRng = new Rng(cfg.seed);
		this.spinRng = new Rng(cfg.seed ^ 0x51);
		this.pickRng = new Rng(cfg.seed ^ 0x9c);
		this.bodyJson = ROCK_KINDS.map((k) =>
			Array.from({ length: k.variants }, (_, v) =>
				JSON.stringify(rockBody(k.id, v)),
			),
		);
		this.resetWorld(cfg.seed ^ 0xa77);
		this.enterTitle();
	}

	get world(): SimHandle["world"] {
		return this.handle.world;
	}

	/** Sim + engine state hash (the engine's FNV over every body, plus game state). */
	hash(): string {
		return `${this.world.stateHash()}:${this.score}:${this.hp}:${this.wave}:${this.rockCount}`;
	}

	/** Live dynamic bodies `[active, sleeping]` (allocates; stats ticks only). */
	bodyCounts(): [number, number] {
		const c = this.world.bodyCounts();
		return [c[0] ?? 0, c[1] ?? 0];
	}

	// ---------------------------------------------------------------------------------
	// world lifecycle

	/** Frees the current world (if any) and builds a fresh one: arena, pillars, player. */
	private resetWorld(seed: number): void {
		const old = this.handle;
		this.handle = this.makeWorld(seed);
		old?.world.free();
		this.views = new StateViews(this.handle);
		const w = this.world;
		const stat = (p: number[], he: number[]): number =>
			w.spawn(
				JSON.stringify({
					position: p,
					body: {
						type: "static",
						friction: 0.9,
						collider: { shape: "box", halfExtents: he },
					},
				}),
			);
		w.spawn(
			JSON.stringify({
				body: { type: "static", friction: 0.9, collider: { shape: "plane" } },
			}),
		);
		const H = ARENA_HALF + WALL_THICK / 2;
		const L = ARENA_HALF + WALL_THICK;
		const hy = WALL_HEIGHT / 2;
		stat([0, hy, -H], [L, hy, WALL_THICK / 2]);
		stat([0, hy, H], [L, hy, WALL_THICK / 2]);
		stat([-H, hy, 0], [WALL_THICK / 2, hy, L]);
		stat([H, hy, 0], [WALL_THICK / 2, hy, L]);
		for (const [x, z] of PILLARS)
			stat(
				[x, PILLAR_HEIGHT / 2, z],
				[PILLAR_HALF, PILLAR_HEIGHT / 2, PILLAR_HALF],
			);
		this.playerId = w.spawn(
			JSON.stringify({
				name: "player",
				position: [0, PLAYER_CENTER_Y, 0],
				body: {
					type: "kinematic",
					mass: PLAYER_MASS,
					collider: {
						shape: "capsule",
						halfHeight: PLAYER_HALF_HEIGHT,
						radius: PLAYER_RADIUS,
					},
				},
				character: {
					speed: PLAYER_SPEED,
					sprintSpeed: PLAYER_SPRINT,
					jumpSpeed: PLAYER_JUMP,
					stepHeight: 0.4,
					maxSlopeDeg: 50,
					snap: 0.3,
				},
			}),
		);
		this.playerSlot = w.slotOf(this.playerId);
		this.views.refresh();
		this.px = 0;
		this.py = PLAYER_CENTER_Y;
		this.pz = 0;
		this.rockCount = 0;
		this.spawners.length = 0;
		this.spawnerKind.clear();
		this.pkType.fill(-1);
		this.events.push(EV.RESET);
	}

	private enterTitle(): void {
		this.phase = PHASE.TITLE;
		this.phaseTick = 0;
		this.startWave(ATTRACT_WAVE);
		// The title shows a pit already half buried (skipped when the title is skipped).
		if (!this.cfg.autoStart) this.dropRubble(ATTRACT_RUBBLE);
		if (this.cfg.autoStart) this.startRun();
	}

	private startRun(): void {
		this.runs++;
		const seed = (this.cfg.seed + this.runs * 7919) >>> 0;
		this.resetWorld(seed);
		this.waveRng = new Rng(seed);
		this.spinRng = new Rng(seed ^ 0x51);
		this.pickRng = new Rng(seed ^ 0x9c);
		this.phase = PHASE.COUNTDOWN;
		this.phaseTick = 0;
		this.survived = 0;
		this.wave = 0;
		this.score = 0;
		this.scoreFrac = 0;
		this.mult = 1;
		this.hp = MAX_HP;
		this.shield = false;
		this.stamina = STAMINA_MAX;
		this.nearMisses = 0;
		this.crystals = 0;
		this.hitsTaken = 0;
		this.invuln = 0;
		this.knock = 0;
		this.orders = [];
		this.orderIdx = 0;
		if (this.cfg.rubble > 0) this.dropRubble(this.cfg.rubble);
		this.events.push(EV.COUNTDOWN, COUNTDOWN_TICKS);
	}

	private startWave(n: number): void {
		this.wave = n;
		this.orders = planWave(n, this.waveRng);
		this.orderIdx = 0;
		this.waveStart = this.tick;
	}

	// ---------------------------------------------------------------------------------
	// tick

	step(input: TickInput): void {
		this.events.clear();
		this.addedN = 0;
		this.removedN = 0;
		const pressed = input.buttons & ~this.prevButtons;
		this.prevButtons = input.buttons;

		if (pressed & BTN.START) {
			if (this.phase === PHASE.TITLE) this.startRun();
			else if (this.phase === PHASE.OVER && this.phaseTick >= OVER_LOCK)
				this.startRun();
		}
		this.drivePlayer(input, pressed);
		this.direct();

		this.world.step(1);
		this.tick++;
		this.phaseTick++;
		this.views.refresh();
		this.drainSpawned();
		this.readPlayer();
		this.judgeRocks();
		this.crumble();
		this.pickups();
		this.advancePhase();
	}

	private drivePlayer(input: TickInput, pressed: number): void {
		let mx = quantize(input.mx);
		let mz = quantize(input.mz);
		const alive = this.phase !== PHASE.OVER;
		if (!alive || this.phase === PHASE.TITLE) {
			mx = 0;
			mz = 0;
		}
		let sprint = alive && (input.buttons & BTN.SPRINT) !== 0;
		const moving = mx * mx + mz * mz > 0.01;
		if (sprint && moving && this.stamina > 0) {
			this.stamina = Math.max(0, this.stamina - DT);
		} else {
			sprint = false;
			this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * DT);
		}
		this.sprinting = sprint;
		let jump =
			alive && this.phase !== PHASE.TITLE && (input.buttons & BTN.JUMP) !== 0;
		if (this.knock > 0) {
			this.knock--;
			mx = this.knockX;
			mz = this.knockZ;
			sprint = true;
			jump = false;
		}
		if ((pressed & BTN.JUMP) !== 0 && jump && this.grounded)
			this.events.push(EV.JUMP, 0, this.px, this.py, this.pz);
		this.moveX = mx;
		this.moveZ = mz;
		this.world.setCharacterInput(this.playerId, mx, mz, jump, sprint);
		if (this.invuln > 0) this.invuln--;
	}

	private readPlayer(): void {
		const c = this.views.curr;
		const o = this.playerSlot * 8;
		this.px = c[o] as number;
		this.py = c[o + 1] as number;
		this.pz = c[o + 2] as number;
		if (this.world.characterState(this.playerId))
			this.grounded = (this.views.scratch[8] as number) > 0.5;
	}

	// ---------------------------------------------------------------------------------
	// director: wave orders -> engine spawners

	private direct(): void {
		const t = this.tick - this.waveStart;
		while (this.orderIdx < this.orders.length) {
			const o = this.orders[this.orderIdx] as WaveOrder;
			if (o.at > t) break;
			this.orderIdx++;
			this.fire(o);
		}
		// Retire finished spawners (their entities are plain bookkeeping in the engine).
		for (let i = this.spawners.length - 1; i >= 0; i--) {
			const s = this.spawners[i] as ActiveSpawner;
			if (this.tick < s.end) continue;
			this.world.despawn(s.id);
			this.spawnerKind.delete(s.id);
			this.spawners[i] = this.spawners[
				this.spawners.length - 1
			] as ActiveSpawner;
			this.spawners.pop();
		}
	}

	/** Creates one engine spawner. Rotation is a seeded random template orientation. */
	private spawner(
		kind: Kind,
		rate: number,
		count: number,
		min: readonly number[],
		max: readonly number[],
	): void {
		if (count <= 0) return;
		const k = ROCK_KINDS[kind];
		if (!k) return;
		const r = this.waveRng;
		const variant = r.int(k.variants);
		// Uniform random unit quaternion (Shoemake).
		const u1 = r.next();
		const u2 = r.next() * Math.PI * 2;
		const u3 = r.next() * Math.PI * 2;
		const a = Math.sqrt(1 - u1);
		const b = Math.sqrt(u1);
		const q = [
			a * Math.sin(u2),
			a * Math.cos(u2),
			b * Math.sin(u3),
			b * Math.cos(u3),
		]
			.map((v) => Math.round(v * 1e5) / 1e5)
			.join(",");
		const seed = r.int(0x7fffffff);
		const json = `{"spawner":{"template":{"rotation":[${q}],"body":${this.bodyJson[kind]?.[variant]}},"rate":${rate},"count":${count},"areaMin":[${min.join(",")}],"areaMax":[${max.join(",")}],"seed":${seed}}}`;
		const id = this.world.spawn(json);
		this.spawnerKind.set(id, kind * 16 + variant);
		this.spawners.push({
			id,
			end: this.tick + Math.ceil((count * 60) / rate) + 2,
		});
	}

	private fire(o: WaveOrder): void {
		const lo = -ARENA_HALF + SPAWN_INSET;
		const hi = ARENA_HALF - SPAWN_INSET;
		const clamp = (v: number): number => (v < lo ? lo : Math.min(v, hi));
		switch (o.pattern) {
			case PATTERN.RAIN:
				this.spawner(o.kind, o.rate, o.count, ARENA_BOX.min, ARENA_BOX.max);
				return;
			case PATTERN.VOLLEY: {
				const x = clamp(this.px);
				const z = clamp(this.pz);
				const s = 1.6;
				this.spawner(
					o.kind,
					o.rate,
					o.count,
					[clamp(x - s), 25, clamp(z - s)],
					[clamp(x + s), 27, clamp(z + s)],
				);
				// Hunter volleys (param 1) are routine pressure: no callout.
				if (o.param === 0) this.events.push(EV.PATTERN, o.pattern, x, 0, z);
				return;
			}
			case PATTERN.RING: {
				const R = 2.3;
				for (let i = 0; i < o.count; i++) {
					const a = (i / o.count) * Math.PI * 2;
					const x = clamp(this.px + Math.cos(a) * R);
					const z = clamp(this.pz + Math.sin(a) * R);
					this.spawner(
						o.kind,
						o.rate,
						1,
						[x - 0.15, 25, z - 0.15],
						[x + 0.15, 25.2, z + 0.15],
					);
				}
				this.events.push(EV.PATTERN, o.pattern, this.px, 0, this.pz);
				return;
			}
			case PATTERN.SLIDE: {
				// Bands stacked in height: the lowest lands first, so the wall sweeps across.
				const bands = 9;
				const per = Math.max(1, Math.round(o.count / bands));
				const alongX = o.param < 2;
				const dir = o.param % 2 === 0 ? 1 : -1;
				const w = (hi - lo) / bands;
				for (let i = 0; i < bands; i++) {
					const c = dir > 0 ? lo + w * (i + 0.5) : hi - w * (i + 0.5);
					const y = 14 + i * 2.6;
					const a0 = c - w * 0.45;
					const a1 = c + w * 0.45;
					this.spawner(
						o.kind,
						o.rate * 3,
						per,
						alongX ? [a0, y, lo] : [lo, y, a0],
						alongX ? [a1, y + 0.6, hi] : [hi, y + 0.6, a1],
					);
				}
				const fx = alongX ? (dir > 0 ? lo : hi) : 0;
				const fz = alongX ? 0 : dir > 0 ? lo : hi;
				this.events.push(EV.PATTERN, o.pattern, fx, 0, fz, alongX ? 0 : 1, dir);
				return;
			}
			case PATTERN.HALF: {
				const alongX = o.param < 2;
				const pos = o.param % 2 === 0;
				const min = [lo, 24, lo];
				const max = [hi, 29, hi];
				const ax = alongX ? 0 : 2;
				if (pos) min[ax] = 0;
				else max[ax] = 0;
				this.spawner(o.kind, o.rate, o.count, min, max);
				this.spawner(KIND.ROCK, o.rate / 5, Math.round(o.count / 5), min, max);
				const cx = ((min[0] as number) + (max[0] as number)) / 2;
				const cz = ((min[2] as number) + (max[2] as number)) / 2;
				this.events.push(EV.PATTERN, o.pattern, cx, 0, cz);
				return;
			}
			default: {
				const inset = 3;
				this.spawner(
					o.kind,
					o.rate,
					o.count,
					[lo + inset, 26, lo + inset],
					[hi - inset, 30, hi - inset],
				);
				this.events.push(EV.PATTERN, PATTERN.METEORS, 0, 0, 0);
			}
		}
	}

	/** Countdown rubble: a fast low spawner mix that settles before wave 1. */
	private dropRubble(n: number): void {
		const lo = -ARENA_HALF + SPAWN_INSET;
		const hi = ARENA_HALF - SPAWN_INSET;
		const mix: [Kind, number][] = [
			[KIND.PEBBLE, 0.55],
			[KIND.ROCK, 0.33],
			[KIND.SLAB, 0.06],
			[KIND.BOULDER, 0.06],
		];
		for (const [kind, f] of mix) {
			// Several spawners per kind so the variants (and orientations) mix.
			for (let i = 0; i < 3; i++)
				this.spawner(
					kind,
					160,
					Math.round((n * f) / 3),
					[lo, 3, lo],
					[hi, 12, hi],
				);
		}
	}

	private drainSpawned(): void {
		const w = this.world;
		if (w.spawnedPending() === 0) return;
		const d = w.drainSpawned();
		const r = this.spinRng;
		for (let i = 0; i + 2 < d.length; i += 3) {
			const id = d[i] as number;
			const slot = d[i + 1] as number;
			const kv = this.spawnerKind.get(d[i + 2] as number);
			if (kv === undefined || this.rockCount >= ROCK_CAPACITY) {
				w.despawn(id);
				continue;
			}
			const kind = (kv >> 4) as Kind;
			const variant = kv & 15;
			const n = this.rockCount++;
			this.rockId[n] = id;
			this.rockSlot[n] = slot;
			this.rockKind[n] = kind;
			this.rockVar[n] = variant;
			this.rockR[n] = variantRadius(kind, variant);
			this.rockBorn[n] = this.tick;
			this.rockFlags[n] = 0;
			this.rockVy[n] = 0;
			this.totalSpawned++;
			// Tumble while falling; meteors come in fast and slanted.
			const s = kind === KIND.METEOR ? 4 : 2.5;
			const wx = r.range(-s, s);
			const wy = r.range(-s, s);
			const wz = r.range(-s, s);
			if (kind === KIND.METEOR)
				w.setVelocity(
					id,
					r.range(-2.5, 2.5),
					-15,
					r.range(-2.5, 2.5),
					wx,
					wy,
					wz,
				);
			else w.setVelocity(id, 0, 0, 0, wx, wy, wz);
			const a = this.addedN++;
			this.addedSlot[a] = slot;
			this.addedKind[a] = kind;
			this.addedVar[a] = variant;
		}
	}

	// ---------------------------------------------------------------------------------
	// rocks vs player

	private judgeRocks(): void {
		const c = this.views.curr;
		const p = this.views.prev;
		const live = this.phase === PHASE.WAVE || this.phase === PHASE.BREATHER;
		const px = this.px;
		const py = this.py;
		const pz = this.pz;
		const yLo = py - PLAYER_HALF_HEIGHT;
		const yHi = py + PLAYER_HALF_HEIGHT;
		for (let i = 0; i < this.rockCount; i++) {
			const o = (this.rockSlot[i] as number) * 8;
			const x = c[o] as number;
			const y = c[o + 1] as number;
			const z = c[o + 2] as number;
			const vy = (y - (p[o + 1] as number)) * 60;
			const kind = this.rockKind[i] as Kind;
			const r = this.rockR[i] as number;
			let f = this.rockFlags[i] as number;
			const prevVy = this.rockVy[i] as number;
			this.rockVy[i] = vy;
			if (vy < -6) f |= F_FALLING;
			// Landing: a falling rock decelerated hard this tick.
			if ((f & (F_FALLING | F_LANDED)) === F_FALLING && vy - prevVy > 4) {
				f |= F_LANDED;
				this.rockFlags[i] = f;
				this.events.push(EV.LAND, kind, x, y - r * 0.7, z, -prevVy, r);
				if (kind === KIND.METEOR) {
					this.blast(i, x, y, z);
					i--; // the meteor was swap-removed: re-check this index
					continue;
				}
			}
			if (
				y < -4 ||
				((f & F_LANDED) !== 0 &&
					(Math.abs(x) > ARENA_HALF + 0.6 || Math.abs(z) > ARENA_HALF + 0.6))
			) {
				this.removeRock(i);
				i--;
				continue;
			}
			if (!live) {
				this.rockFlags[i] = f;
				continue;
			}
			const k = ROCK_KINDS[kind];
			if (!k) continue;
			const dx = x - px;
			const dz = z - pz;
			const d2 = dx * dx + dz * dz;
			// Hit: a lethal-speed rock overlapping the player's capsule.
			if ((f & F_HIT) === 0) {
				const vx = (x - (p[o] as number)) * 60;
				const vz = (z - (p[o + 2] as number)) * 60;
				// Sideways (rolling or bounced) slabs and boulders only hurt when the rock itself
				// is moving at the player: its own horizontal velocity along the rock->player
				// direction. A rock the player shoves moves away (negative); a resting rock the
				// player runs into has none.
				let closing = 0;
				if (kind >= KIND.SLAB && y < yHi + r && d2 > 1e-6)
					closing = -(vx * dx + vz * dz) / Math.sqrt(d2);
				const lethal = vy < -k.lethalSpeed || closing > ROLL_LETHAL;
				if (lethal) {
					const cy = y < yLo ? yLo : Math.min(y, yHi);
					const dy = y - cy;
					const rr = r * 0.82 + PLAYER_RADIUS;
					if (d2 + dy * dy < rr * rr) {
						f |= F_HIT;
						this.rockFlags[i] = f;
						this.hurt(kind, k.damage, x, y, z);
						continue;
					}
				}
			}
			// Near miss: a falling rock (not a pebble) whose underside dropped past the player's
			// waist close by, without touching.
			if (
				(f & (F_NEAR | F_HIT)) === 0 &&
				kind !== KIND.PEBBLE &&
				vy < -5 &&
				y - r < py - 0.4 &&
				y - r - vy * DT >= py - 0.4
			) {
				const reach = r + PLAYER_RADIUS + NEAR_MISS_RANGE;
				if (d2 < reach * reach && this.invuln === 0) {
					f |= F_NEAR;
					this.nearMisses++;
					this.mult = Math.min(
						MULT_MAX,
						Math.round((this.mult + MULT_STEP) * 10) / 10,
					);
					const pts = Math.round(NEAR_MISS_POINTS * this.mult);
					this.score += pts;
					this.events.push(EV.NEAR_MISS, pts, x, y, z, this.mult, r);
				}
			}
			this.rockFlags[i] = f;
		}
	}

	private hurt(kind: Kind, dmg: number, x: number, y: number, z: number): void {
		if (this.cfg.god) return;
		const heavy = kind !== KIND.PEBBLE;
		if (this.invuln > 0) return;
		let dx = this.px - x;
		let dz = this.pz - z;
		const l = Math.hypot(dx, dz);
		if (l > 1e-4) {
			dx /= l;
			dz /= l;
		} else {
			dx = 1;
			dz = 0;
		}
		if (this.shield && heavy) {
			this.shield = false;
			this.invuln = INVULN_TICKS;
			this.events.push(EV.HIT, kind, x, y, z, 0, 1);
			return;
		}
		this.hp = Math.max(0, this.hp - dmg);
		this.hitsTaken++;
		if (heavy) {
			this.mult = 1;
			this.invuln = INVULN_TICKS;
			this.knock = KNOCK_TICKS;
			this.knockX = dx;
			this.knockZ = dz;
		} else this.invuln = 6;
		this.events.push(EV.HIT, kind, x, y, z, dmg, 0);
	}

	/** Meteor detonation: shoves every nearby rock outward (engine setVelocity) and hurts. */
	private blast(i: number, x: number, y: number, z: number): void {
		const c = this.views.curr;
		const R2 = BLAST_RADIUS * BLAST_RADIUS;
		for (let j = 0; j < this.rockCount; j++) {
			if (j === i) continue;
			const o = (this.rockSlot[j] as number) * 8;
			const dx = (c[o] as number) - x;
			const dy = (c[o + 1] as number) - y;
			const dz = (c[o + 2] as number) - z;
			const d2 = dx * dx + dz * dz + dy * dy;
			if (d2 > R2 || d2 < 1e-6) continue;
			const d = Math.sqrt(d2);
			const s = (1 - d / BLAST_RADIUS) * 9;
			this.world.setVelocity(
				this.rockId[j] as number,
				(dx / d) * s,
				4 + s * 0.6,
				(dz / d) * s,
				dz * 2,
				0,
				-dx * 2,
			);
		}
		this.events.push(EV.BLAST, 0, x, y, z, BLAST_RADIUS);
		this.removeRock(i, false);
		const live = this.phase === PHASE.WAVE || this.phase === PHASE.BREATHER;
		const pd = Math.hypot(this.px - x, this.pz - z);
		if (live && pd < BLAST_PLAYER_RADIUS && Math.abs(this.py - y) < 2.5)
			this.hurt(KIND.METEOR, BLAST_DAMAGE, x, y, z);
	}

	private removeRock(i: number, crumble = false): void {
		const n = --this.rockCount;
		const slot = this.rockSlot[i] as number;
		if (crumble) {
			const o = slot * 8;
			const c = this.views.curr;
			this.events.push(
				EV.CRUMBLE,
				this.rockKind[i] as number,
				c[o] as number,
				c[o + 1] as number,
				c[o + 2] as number,
				0,
				this.rockR[i] as number,
			);
		}
		this.world.despawn(this.rockId[i] as number);
		this.removedSlot[this.removedN++] = slot;
		if (i !== n) {
			this.rockId[i] = this.rockId[n] as number;
			this.rockSlot[i] = this.rockSlot[n] as number;
			this.rockKind[i] = this.rockKind[n] as number;
			this.rockVar[i] = this.rockVar[n] as number;
			this.rockR[i] = this.rockR[n] as number;
			this.rockBorn[i] = this.rockBorn[n] as number;
			this.rockFlags[i] = this.rockFlags[n] as number;
			this.rockVy[i] = this.rockVy[n] as number;
		}
	}

	/** Past the cap, the oldest rocks crumble away (a few per tick: spreads cost and dust). */
	private crumble(): void {
		let budget = CRUMBLE_PER_TICK;
		while (this.rockCount > this.cfg.maxRocks && budget-- > 0) {
			let oldest = 0;
			let born = 0x7fffffff;
			for (let i = 0; i < this.rockCount; i++) {
				const b = this.rockBorn[i] as number;
				if (b < born) {
					born = b;
					oldest = i;
				}
			}
			this.removeRock(oldest, true);
		}
	}

	// ---------------------------------------------------------------------------------
	// pickups

	private pickups(): void {
		const live = this.phase === PHASE.WAVE || this.phase === PHASE.BREATHER;
		for (let i = 0; i < MAX_PICKUPS; i++) {
			const t = this.pkType[i] as number;
			if (t < 0) continue;
			const age = this.tick - (this.pkBorn[i] as number);
			if (age > (PICKUP_LIFE[t] as number) || !live) {
				this.pkType[i] = -1;
				this.events.push(
					EV.PICKUP_LOST,
					t,
					this.pkX[i],
					this.pkY[i],
					this.pkZ[i],
				);
				continue;
			}
			// Rubble keeps landing: float above whatever is under the pickup now.
			if (age % 20 === 0) this.restPickup(i);
			const dx = (this.pkX[i] as number) - this.px;
			const dz = (this.pkZ[i] as number) - this.pz;
			const dy = (this.pkY[i] as number) - this.py;
			if (
				dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS &&
				Math.abs(dy) < 1.6
			)
				this.collect(i, t);
		}
		if (!live) return;
		const t = this.survived;
		if (t % 240 === 120 && this.countPickups(PICKUP.CRYSTAL) < 3)
			this.spawnPickup(PICKUP.CRYSTAL);
		if (t % 1500 === 900 && this.hp < MAX_HP) this.spawnPickup(PICKUP.HEART);
		if (
			t % 2400 === 1800 &&
			!this.shield &&
			this.countPickups(PICKUP.SHIELD) === 0
		)
			this.spawnPickup(PICKUP.SHIELD);
	}

	private countPickups(type: number): number {
		let n = 0;
		for (let i = 0; i < MAX_PICKUPS; i++) if (this.pkType[i] === type) n++;
		return n;
	}

	private spawnPickup(type: number): void {
		const i = this.pkType.indexOf(-1);
		if (i < 0) return;
		const r = this.pickRng;
		const lim = ARENA_HALF - 2;
		let x = 0;
		let z = 0;
		for (let tries = 0; tries < 10; tries++) {
			x = r.range(-lim, lim);
			z = r.range(-lim, lim);
			let ok = Math.hypot(x - this.px, z - this.pz) > 4;
			for (const [qx, qz] of PILLARS)
				if (
					Math.abs(x - qx) < PILLAR_HALF + 1.2 &&
					Math.abs(z - qz) < PILLAR_HALF + 1.2
				)
					ok = false;
			if (ok) break;
		}
		this.pkType[i] = type;
		this.pkX[i] = x;
		this.pkZ[i] = z;
		this.pkBorn[i] = this.tick;
		this.restPickup(i);
		this.events.push(EV.PICKUP_SPAWN, type, x, this.pkY[i], z);
	}

	private restPickup(i: number): void {
		const x = this.pkX[i] as number;
		const z = this.pkZ[i] as number;
		const top = 12;
		const hit = this.world.raycast(
			x,
			top,
			z,
			0,
			-1,
			0,
			20,
			RAY_EXCLUDE,
			this.playerId,
		);
		const ground = hit ? top - (this.views.scratch[0] as number) : 0;
		this.pkY[i] = Math.max(0, ground) + 0.65;
	}

	private collect(i: number, t: number): void {
		this.pkType[i] = -1;
		let amount = 0;
		if (t === PICKUP.CRYSTAL) {
			amount = Math.round(CRYSTAL_POINTS * this.mult);
			this.score += amount;
			this.crystals++;
		} else if (t === PICKUP.HEART) {
			amount = Math.min(HEART_HEAL, MAX_HP - this.hp);
			this.hp += amount;
		} else this.shield = true;
		this.events.push(
			EV.PICKUP,
			t,
			this.pkX[i],
			this.pkY[i],
			this.pkZ[i],
			amount,
		);
	}

	// ---------------------------------------------------------------------------------
	// phases

	private advancePhase(): void {
		switch (this.phase) {
			case PHASE.TITLE:
				if (this.tick - this.waveStart >= WAVE_TICKS)
					this.startWave(ATTRACT_WAVE);
				return;
			case PHASE.COUNTDOWN:
				if (this.phaseTick >= COUNTDOWN_TICKS) {
					this.phase = PHASE.WAVE;
					this.phaseTick = 0;
					this.startWave(Math.max(1, this.cfg.startWave));
					this.events.push(EV.WAVE_START, this.wave);
				}
				return;
			case PHASE.WAVE:
			case PHASE.BREATHER:
				this.survived++;
				this.scoreFrac += (POINTS_PER_SECOND * this.mult) / 60;
				if (this.scoreFrac >= 1) {
					const whole = Math.floor(this.scoreFrac);
					this.score += whole;
					this.scoreFrac -= whole;
				}
				if (this.hp <= 0) {
					this.phase = PHASE.OVER;
					this.phaseTick = 0;
					this.knock = 0;
					this.events.push(
						EV.GAME_OVER,
						this.wave,
						this.px,
						this.py,
						this.pz,
						this.score,
					);
					return;
				}
				if (this.phase === PHASE.WAVE && this.phaseTick >= WAVE_TICKS) {
					this.phase = PHASE.BREATHER;
					this.phaseTick = 0;
					const bonus = 500 * this.wave;
					this.score += bonus;
					this.events.push(EV.WAVE_CLEAR, this.wave, 0, 0, 0, bonus);
				} else if (
					this.phase === PHASE.BREATHER &&
					this.phaseTick >= BREATHER_TICKS
				) {
					this.phase = PHASE.WAVE;
					this.phaseTick = 0;
					this.startWave(this.wave + 1);
					this.events.push(EV.WAVE_START, this.wave);
				}
				return;
			default:
				// OVER: the current wave keeps raining (no damage) behind the results.
				if (this.tick - this.waveStart >= WAVE_TICKS) this.startWave(this.wave);
		}
	}
}
