import type { SimHandle, StateViews } from "@pebble3d/sdk/sim";
import {
	BUILD_TICKS,
	CELLS,
	CORE_HP,
	CORE_X,
	CORE_Z,
	FIRST_BUILD_TICKS,
	GRID_CELL,
	GRID_HALF,
	GRID_N,
	LANE_SPREAD,
	MAX_AGENTS,
	MAX_DEBRIS,
	MAX_SHELLS,
	MAX_TOWERS,
	START_GOLD,
	WAVES,
} from "./constants.ts";
import {
	hpScale,
	KIND,
	KIND_DEFS,
	MAX_LEVEL,
	SHELL_TICKS,
	SLOW_TICKS,
	sellValue,
	TOWER,
	TOWERS,
} from "./defs.ts";
import { EV, EventQueue } from "./events.ts";
import { CMD, type TickInput } from "./input.ts";
import {
	buildMask,
	buildPaths,
	cellAt,
	cellCenter,
	type PathSamples,
	ROCKS,
	STEP,
} from "./path.ts";
import { Rng } from "./rng.ts";
import { type Group, wavePlan } from "./waves.ts";

export const PHASE = { TITLE: 0, BUILD: 1, WAVE: 2, WON: 3, LOST: 4 } as const;
export const PHASE_NAMES = ["title", "build", "wave", "won", "lost"] as const;

/** Pick result kinds. */
export const PICK = { NONE: 0, CELL: 1, TOWER: 2, BLOCKED: 3 } as const;

export interface PickResult {
	kind: number;
	/** Build cell under the hit (CELL / BLOCKED), else -1. */
	cell: number;
	/** Tower index (TOWER), else -1. */
	tower: number;
	x: number;
	z: number;
	/** CELL only: a tower may be placed here now (mask + raycast clear). */
	buildable: boolean;
}

export function emptyPick(): PickResult {
	return { kind: PICK.NONE, cell: -1, tower: -1, x: 0, z: 0, buildable: false };
}

export interface SimConfig {
	seed: number;
	/** Perf stress: an endless stream at `stressRate`/s, agents loop back to the rifts, the core cannot fall. */
	stress: boolean;
	stressRate: number;
	/** Stress mode stops spawning at this many live agents. */
	stressCap: number;
	/** Skip the title (tests, benches). */
	autoStart: boolean;
	/** Start at this wave (tests, captures). */
	startWave: number;
	/** Extra starting gold (captures that begin mid-game). */
	bonusGold: number;
}

export function defaultConfig(o: Partial<SimConfig> = {}): SimConfig {
	return {
		seed: 7,
		stress: false,
		stressRate: 400,
		stressCap: MAX_AGENTS,
		autoStart: false,
		startWave: 1,
		bonusGold: 0,
		...o,
	};
}

const RAY_ALL = 0;
const DEBRIS_LIFE = 170;

interface ActiveGroup extends Group {
	acc: number;
	done: number;
	flip: number;
}

interface Burst {
	id: number;
	x: number;
	z: number;
	power: number;
	end: number;
}

/**
 * Swarm Siege rules. Enemies are pooled kinematic agents (structure of arrays) that follow
 * pre-sampled paths; towers query them through a uniform grid rebuilt each tick. The Rapier
 * world holds the static map (ground, outcrops, core, tower colliders) for raycast picking and
 * placement checks, plus debris shards from engine spawners. `step` runs rules, then
 * `world.step(1)`. No DOM, no Math.random, no Date.
 */
export class SiegeSim {
	readonly world: SimHandle["world"];
	readonly views: StateViews;
	readonly cfg: SimConfig;
	readonly paths: [PathSamples, PathSamples];
	readonly mask: Uint8Array;
	readonly events = new EventQueue();
	readonly groundId: number;
	readonly coreId: number;
	readonly rockIds: number[] = [];

	tick = 0;
	phase: number = PHASE.TITLE;
	wave = 0;
	gold = START_GOLD;
	private goldFrac = 0;
	coreHp = CORE_HP;
	kills = 0;
	leaks = 0;
	score = 0;
	/** Build-phase countdown, ticks. */
	timer = 0;
	totalSpawned = 0;
	/** Enemies of the current wave not yet spawned. */
	pending = 0;
	alive = 0;
	/** Agent slot high-water mark. */
	hw = 0;

	// --- agents (SoA) ---
	readonly ax = new Float32Array(MAX_AGENTS);
	readonly az = new Float32Array(MAX_AGENTS);
	readonly ayaw = new Float32Array(MAX_AGENTS);
	readonly as = new Float32Array(MAX_AGENTS);
	readonly al = new Float32Array(MAX_AGENTS);
	readonly aph = new Float32Array(MAX_AGENTS);
	readonly ahp = new Float32Array(MAX_AGENTS);
	readonly aspd = new Float32Array(MAX_AGENTS);
	readonly aslowF = new Float32Array(MAX_AGENTS);
	readonly aslow = new Uint16Array(MAX_AGENTS);
	readonly aflash = new Uint8Array(MAX_AGENTS);
	readonly agen = new Uint8Array(MAX_AGENTS);
	readonly apath = new Uint8Array(MAX_AGENTS);
	/** -1 = free slot. */
	readonly akind = new Int8Array(MAX_AGENTS).fill(-1);
	private readonly free = new Int32Array(MAX_AGENTS);
	private nFree = 0;

	// --- spatial grid ---
	private readonly cellStart = new Int32Array(GRID_N * GRID_N + 1);
	private readonly cellFill = new Int32Array(GRID_N * GRID_N);
	private readonly cellItems = new Int32Array(MAX_AGENTS);
	private readonly agentCell = new Int32Array(MAX_AGENTS);
	/** Query result scratch. */
	private readonly q = new Int32Array(MAX_AGENTS);

	// --- towers ---
	nTowers = 0;
	readonly ttype = new Int8Array(MAX_TOWERS).fill(-1);
	readonly tlevel = new Uint8Array(MAX_TOWERS);
	readonly tcell = new Int32Array(MAX_TOWERS);
	readonly tx = new Float32Array(MAX_TOWERS);
	readonly tz = new Float32Array(MAX_TOWERS);
	readonly tcool = new Int32Array(MAX_TOWERS);
	readonly taim = new Float32Array(MAX_TOWERS);
	readonly tfired = new Int32Array(MAX_TOWERS);
	readonly tbody = new Int32Array(MAX_TOWERS);
	readonly tinvest = new Int32Array(MAX_TOWERS);
	readonly tkills = new Int32Array(MAX_TOWERS);
	readonly occupied: Int16Array;

	// --- mortar shells ---
	nShells = 0;
	readonly sx0 = new Float32Array(MAX_SHELLS);
	readonly sz0 = new Float32Array(MAX_SHELLS);
	readonly sx1 = new Float32Array(MAX_SHELLS);
	readonly sz1 = new Float32Array(MAX_SHELLS);
	readonly sborn = new Int32Array(MAX_SHELLS);
	readonly sdmg = new Float32Array(MAX_SHELLS);
	readonly srad = new Float32Array(MAX_SHELLS);
	readonly stower = new Int16Array(MAX_SHELLS);

	// --- debris (engine-spawned rigid bodies) ---
	nDebris = 0;
	readonly did = new Int32Array(MAX_DEBRIS);
	readonly dslot = new Int32Array(MAX_DEBRIS);
	readonly dborn = new Int32Array(MAX_DEBRIS);
	private readonly bursts: Burst[] = [];
	private readonly debrisJson: string;

	private rng: Rng;
	private groups: ActiveGroup[] = [];

	constructor(handle: SimHandle, views: StateViews, cfg: SimConfig) {
		this.world = handle.world;
		this.views = views;
		this.cfg = cfg;
		this.rng = new Rng(cfg.seed);
		this.paths = buildPaths();
		this.mask = buildMask(this.paths);
		this.occupied = new Int16Array(CELLS * CELLS).fill(-1);
		const w = this.world;
		this.groundId = w.spawn(
			JSON.stringify({
				name: "ground",
				position: [0, -0.5, 0],
				rotation: [0, 0, 0, 1],
				body: {
					type: "static",
					collider: { shape: "box", halfExtents: [70, 0.5, 70] },
				},
			}),
		);
		this.coreId = w.spawn(
			JSON.stringify({
				name: "core",
				position: [CORE_X, 2.5, CORE_Z],
				rotation: [0, 0, 0, 1],
				body: {
					type: "static",
					collider: { shape: "box", halfExtents: [1.6, 2.5, 1.6] },
				},
			}),
		);
		for (const r of ROCKS)
			this.rockIds.push(
				w.spawn(
					JSON.stringify({
						position: [r[0], r[2] * 0.6, r[1]],
						rotation: [0, 0, 0, 1],
						body: {
							type: "static",
							collider: {
								shape: "box",
								halfExtents: [r[2], r[2] * 0.6, r[2]],
							},
						},
					}),
				),
			);
		this.debrisJson = JSON.stringify({
			position: [0, 0, 0],
			rotation: [0, 0, 0, 1],
			body: {
				type: "dynamic",
				friction: 0.6,
				restitution: 0.25,
				collider: { shape: "box", halfExtents: [0.16, 0.1, 0.22] },
			},
		});
		this.views.refresh();
		if (cfg.autoStart || cfg.stress) this.reset();
	}

	// ------------------------------------------------------------------ lifecycle

	/** Starts a fresh run (from the title or after a result). Map statics stay. */
	private reset(): void {
		const w = this.world;
		for (let t = 0; t < MAX_TOWERS; t++) {
			if ((this.ttype[t] as number) >= 0) w.despawn(this.tbody[t] as number);
			this.ttype[t] = -1;
		}
		this.nTowers = 0;
		this.occupied.fill(-1);
		for (let d = 0; d < this.nDebris; d++) w.despawn(this.did[d] as number);
		this.nDebris = 0;
		for (const b of this.bursts) w.despawn(b.id);
		this.bursts.length = 0;
		this.akind.fill(-1);
		this.hw = 0;
		this.nFree = 0;
		this.alive = 0;
		this.nShells = 0;
		this.rng = new Rng(this.cfg.seed);
		this.gold = START_GOLD + this.cfg.bonusGold;
		this.goldFrac = 0;
		this.coreHp = CORE_HP;
		this.kills = 0;
		this.leaks = 0;
		this.score = 0;
		this.totalSpawned = 0;
		this.pending = 0;
		this.groups = [];
		this.wave = this.cfg.startWave - 1;
		this.events.push(EV.RESET, 0, 0, 0);
		if (this.cfg.stress) {
			this.phase = PHASE.WAVE;
			this.wave = 1;
			this.groups.push({
				kind: KIND.MITE,
				count: 1e9,
				rate: this.cfg.stressRate,
				rift: 2,
				delay: 0,
				acc: 0,
				done: 0,
				flip: 0,
			});
			return;
		}
		this.phase = PHASE.BUILD;
		this.timer = this.wave === 0 ? FIRST_BUILD_TICKS : BUILD_TICKS;
	}

	private startWave(): void {
		this.wave++;
		this.phase = PHASE.WAVE;
		this.groups = wavePlan(this.wave).map((g) => ({
			...g,
			acc: 0,
			done: 0,
			flip: 0,
		}));
		let n = 0;
		for (const g of this.groups) n += g.count;
		this.pending = n;
		this.events.push(EV.WAVE_START, this.wave, 0, 0);
	}

	// ------------------------------------------------------------------ tick

	step(input: TickInput): void {
		this.tick++;
		this.command(input);
		const ph = this.phase;
		if (ph === PHASE.BUILD) {
			if (--this.timer <= 0) this.startWave();
		}
		if (this.phase === PHASE.WAVE) this.spawnGroups();
		if (ph !== PHASE.TITLE) {
			this.moveAgents();
			this.buildGrid();
			if (this.phase === PHASE.WAVE || this.phase === PHASE.BUILD) {
				this.updateTowers();
				this.updateShells();
			}
			if (this.phase === PHASE.WAVE && this.pending === 0 && this.alive === 0)
				this.waveCleared();
		}
		this.updateDebris();
		this.world.step(1);
	}

	private command(input: TickInput): void {
		const c = input.cmd;
		if (c === CMD.NONE) return;
		const ph = this.phase;
		if (c === CMD.START && ph === PHASE.TITLE) this.reset();
		else if (c === CMD.RESTART && (ph === PHASE.WON || ph === PHASE.LOST))
			this.reset();
		else if (c === CMD.CALL_WAVE && ph === PHASE.BUILD) this.timer = 1;
		else if (ph === PHASE.BUILD || ph === PHASE.WAVE) {
			if (c === CMD.PLACE) this.place(input.a, input.b);
			else if (c === CMD.UPGRADE) this.upgrade(input.a);
			else if (c === CMD.SELL) this.sell(input.a);
		}
	}

	/** Raycast straight down at the cell centre: only the ground may be under a new tower. */
	cellClear(cell: number): boolean {
		const [x, z] = cellCenter(cell);
		if (!this.world.raycast(x, 30, z, 0, -1, 0, 40, RAY_ALL, 0)) return false;
		this.views.refresh(); // wasm memory may have grown since the last spawn
		return (this.views.scratch[4] as number) === this.groundId;
	}

	canPlace(type: number, cell: number): boolean {
		if (type < 0 || type >= TOWERS.length) return false;
		if (cell < 0 || cell >= this.mask.length || this.mask[cell] !== 1)
			return false;
		if ((this.occupied[cell] as number) >= 0) return false;
		return this.gold >= (TOWERS[type]?.cost ?? 1e9);
	}

	private place(type: number, cell: number): void {
		const def = TOWERS[type];
		if (!def || cell < 0 || cell >= this.mask.length) return;
		const [x, z] = cellCenter(cell);
		if (this.mask[cell] !== 1 || (this.occupied[cell] as number) >= 0) {
			this.events.push(EV.DENY, 2, x, z);
			return;
		}
		if (this.gold < def.cost) {
			this.events.push(EV.DENY, 1, x, z);
			return;
		}
		if (!this.cellClear(cell)) {
			this.events.push(EV.DENY, 2, x, z);
			return;
		}
		let t = -1;
		for (let i = 0; i < MAX_TOWERS; i++)
			if ((this.ttype[i] as number) < 0) {
				t = i;
				break;
			}
		if (t < 0) return;
		this.gold -= def.cost;
		this.ttype[t] = type;
		this.tlevel[t] = 1;
		this.tcell[t] = cell;
		this.tx[t] = x;
		this.tz[t] = z;
		this.tcool[t] = 20;
		this.taim[t] = Math.atan2(CORE_X - x, CORE_Z - z);
		this.tfired[t] = -1000;
		this.tinvest[t] = def.cost;
		this.tkills[t] = 0;
		this.tbody[t] = this.world.spawn(
			`{"name":"tower","position":[${x},1.2,${z}],"rotation":[0,0,0,1],"body":{"type":"static","collider":{"shape":"box","halfExtents":[0.9,1.2,0.9]}}}`,
		);
		this.occupied[cell] = t;
		this.nTowers++;
		this.events.push(EV.PLACE, type, x, z);
	}

	upgradeCost(t: number): number {
		const ty = this.ttype[t] as number;
		const lv = this.tlevel[t] as number;
		if (ty < 0 || lv >= MAX_LEVEL) return -1;
		return TOWERS[ty]?.upgrade[lv - 1] ?? -1;
	}

	private upgrade(t: number): void {
		if (t < 0 || t >= MAX_TOWERS) return;
		const cost = this.upgradeCost(t);
		if (cost < 0) return;
		if (this.gold < cost) {
			this.events.push(EV.DENY, 1, this.tx[t] as number, this.tz[t] as number);
			return;
		}
		this.gold -= cost;
		this.tinvest[t] = (this.tinvest[t] as number) + cost;
		this.tlevel[t] = (this.tlevel[t] as number) + 1;
		this.events.push(
			EV.UPGRADE,
			this.tlevel[t] as number,
			this.tx[t] as number,
			this.tz[t] as number,
		);
	}

	private sell(t: number): void {
		if (t < 0 || t >= MAX_TOWERS || (this.ttype[t] as number) < 0) return;
		this.gold += sellValue(this.tinvest[t] as number);
		this.world.despawn(this.tbody[t] as number);
		this.occupied[this.tcell[t] as number] = -1;
		this.ttype[t] = -1;
		this.nTowers--;
		// Shells still in the air no longer credit the sold tower's slot.
		for (let s = 0; s < this.nShells; s++)
			if (this.stower[s] === t) this.stower[s] = -1;
		this.events.push(EV.SELL, 0, this.tx[t] as number, this.tz[t] as number);
	}

	private waveCleared(): void {
		this.score += 250 * this.wave;
		if (this.wave >= WAVES) {
			this.phase = PHASE.WON;
			this.score += this.coreHp * 20;
			this.events.push(EV.WON, this.wave, CORE_X, CORE_Z);
			return;
		}
		const bonus = 40 + 12 * this.wave;
		this.gold += bonus;
		this.phase = PHASE.BUILD;
		this.timer = BUILD_TICKS;
		this.events.push(EV.WAVE_CLEAR, this.wave, bonus, 0);
	}

	// ------------------------------------------------------------------ agents

	private spawnGroups(): void {
		for (const g of this.groups) {
			if (g.delay > 0) {
				g.delay--;
				continue;
			}
			if (g.done >= g.count) continue;
			if (this.cfg.stress && this.alive >= this.cfg.stressCap) continue;
			g.acc += g.rate / 60;
			while (g.acc >= 1 && g.done < g.count) {
				g.acc -= 1;
				let p = g.rift;
				if (p === 2) {
					p = g.flip;
					g.flip ^= 1;
				}
				if (!this.spawnAgent(g.kind, p)) {
					g.acc = 0;
					break;
				}
				g.done++;
				if (!this.cfg.stress) this.pending--;
			}
		}
	}

	private spawnAgent(kind: number, path: number): boolean {
		let i: number;
		if (this.nFree > 0) i = this.free[--this.nFree] as number;
		else if (this.hw < MAX_AGENTS) i = this.hw++;
		else return false;
		const def = KIND_DEFS[kind] as (typeof KIND_DEFS)[number];
		const r = this.rng;
		const spread = kind === KIND.BRUTE ? LANE_SPREAD * 0.5 : LANE_SPREAD;
		this.akind[i] = kind;
		this.apath[i] = path;
		this.as[i] = r.next() * 1.5;
		this.al[i] = r.range(-spread, spread);
		this.aph[i] = r.next() * 6.2832;
		this.aspd[i] = def.speed * (0.88 + 0.24 * r.next());
		this.ahp[i] = def.hp * hpScale(this.wave);
		this.aslow[i] = 0;
		this.aslowF[i] = 1;
		this.aflash[i] = 0;
		this.agen[i] = ((this.agen[i] as number) + 1) & 15;
		this.alive++;
		this.totalSpawned++;
		this.place2d(i);
		return true;
	}

	private freeAgent(i: number): void {
		this.akind[i] = -1;
		this.free[this.nFree++] = i;
		this.alive--;
	}

	/** Agent position from its path progress and lateral offset. */
	private place2d(i: number): void {
		const p = this.paths[this.apath[i] as number] as PathSamples;
		const s = this.as[i] as number;
		let k = Math.floor(s / STEP);
		if (k > p.n - 2) k = p.n - 2;
		const f = s / STEP - k;
		const x0 = p.x[k] as number;
		const z0 = p.z[k] as number;
		const cx = x0 + ((p.x[k + 1] as number) - x0) * f;
		const cz = z0 + ((p.z[k + 1] as number) - z0) * f;
		const tx = p.tx[k] as number;
		const tz = p.tz[k] as number;
		const ph = this.aph[i] as number;
		const l = (this.al[i] as number) + 0.35 * Math.sin(ph);
		this.ax[i] = cx - tz * l;
		this.az[i] = cz + tx * l;
		this.ayaw[i] = (p.yaw[k] as number) + 0.25 * Math.cos(ph);
	}

	private moveAgents(): void {
		const stress = this.cfg.stress;
		for (let i = 0; i < this.hw; i++) {
			const kind = this.akind[i] as number;
			if (kind < 0) continue;
			let v = this.aspd[i] as number;
			const sl = this.aslow[i] as number;
			if (sl > 0) {
				v *= this.aslowF[i] as number;
				this.aslow[i] = sl - 1;
				if (sl === 1) this.aslowF[i] = 1;
			}
			const fl = this.aflash[i] as number;
			if (fl > 0) this.aflash[i] = fl - 1;
			const s = (this.as[i] as number) + v / 60;
			this.aph[i] = (this.aph[i] as number) + v * 0.035;
			const p = this.paths[this.apath[i] as number] as PathSamples;
			if (s >= p.length - 0.5) {
				if (stress) {
					this.as[i] = 0;
					this.place2d(i);
					continue;
				}
				if (this.phase === PHASE.LOST || this.phase === PHASE.WON) {
					// The run is over: arrivals just vanish into the ruin.
					this.freeAgent(i);
					continue;
				}
				const def = KIND_DEFS[kind] as (typeof KIND_DEFS)[number];
				this.coreHp -= def.damage;
				this.leaks++;
				this.events.push(
					EV.LEAK,
					def.damage,
					this.ax[i] as number,
					this.az[i] as number,
				);
				this.freeAgent(i);
				if (this.coreHp <= 0 && this.phase !== PHASE.LOST) this.lose();
				continue;
			}
			this.as[i] = s;
			this.place2d(i);
		}
		while (this.hw > 0 && (this.akind[this.hw - 1] as number) < 0) {
			// Trim the high-water mark; drop trimmed slots from the free list lazily.
			this.hw--;
		}
		if (this.nFree > 0) {
			let k = 0;
			for (let j = 0; j < this.nFree; j++) {
				const s = this.free[j] as number;
				if (s < this.hw) this.free[k++] = s;
			}
			this.nFree = k;
		}
	}

	private lose(): void {
		this.coreHp = 0;
		this.phase = PHASE.LOST;
		this.events.push(EV.LOST, this.wave, CORE_X, CORE_Z);
		this.burst(CORE_X, 3, CORE_Z, 90, 1.6, 9);
	}

	private buildGrid(): void {
		const cs = this.cellStart;
		const fill = this.cellFill;
		cs.fill(0);
		const inv = 1 / GRID_CELL;
		for (let i = 0; i < this.hw; i++) {
			if ((this.akind[i] as number) < 0) {
				this.agentCell[i] = -1;
				continue;
			}
			let gx = Math.floor(((this.ax[i] as number) + GRID_HALF) * inv);
			let gz = Math.floor(((this.az[i] as number) + GRID_HALF) * inv);
			if (gx < 0) gx = 0;
			else if (gx >= GRID_N) gx = GRID_N - 1;
			if (gz < 0) gz = 0;
			else if (gz >= GRID_N) gz = GRID_N - 1;
			const c = gz * GRID_N + gx;
			this.agentCell[i] = c;
			cs[c + 1] = (cs[c + 1] as number) + 1;
		}
		for (let c = 0; c < GRID_N * GRID_N; c++)
			cs[c + 1] = (cs[c + 1] as number) + (cs[c] as number);
		fill.set(cs.subarray(0, GRID_N * GRID_N));
		for (let i = 0; i < this.hw; i++) {
			const c = this.agentCell[i] as number;
			if (c < 0) continue;
			const k = fill[c] as number;
			this.cellItems[k] = i;
			fill[c] = k + 1;
		}
	}

	/** Agents within `r` of (x, z) into `this.q`; returns the count. */
	gather(x: number, z: number, r: number): number {
		const inv = 1 / GRID_CELL;
		const x0 = Math.max(0, Math.floor((x - r + GRID_HALF) * inv));
		const x1 = Math.min(GRID_N - 1, Math.floor((x + r + GRID_HALF) * inv));
		const z0 = Math.max(0, Math.floor((z - r + GRID_HALF) * inv));
		const z1 = Math.min(GRID_N - 1, Math.floor((z + r + GRID_HALF) * inv));
		const r2 = r * r;
		let n = 0;
		for (let gz = z0; gz <= z1; gz++)
			for (let gx = x0; gx <= x1; gx++) {
				const c = gz * GRID_N + gx;
				const e = this.cellStart[c + 1] as number;
				for (let k = this.cellStart[c] as number; k < e; k++) {
					const i = this.cellItems[k] as number;
					if ((this.akind[i] as number) < 0) continue;
					const dx = (this.ax[i] as number) - x;
					const dz = (this.az[i] as number) - z;
					if (dx * dx + dz * dz <= r2) this.q[n++] = i;
				}
			}
		return n;
	}

	/** The agent within `r` of (x, z) closest to the core (least path left), or -1. */
	private first(x: number, z: number, r: number): number {
		const n = this.gather(x, z, r);
		let best = -1;
		let bestLeft = 1e9;
		for (let k = 0; k < n; k++) {
			const i = this.q[k] as number;
			const p = this.paths[this.apath[i] as number] as PathSamples;
			const left = p.length - (this.as[i] as number);
			if (left < bestLeft) {
				bestLeft = left;
				best = i;
			}
		}
		return best;
	}

	private hit(i: number, dmg: number, tower: number): void {
		const kind = this.akind[i] as number;
		if (kind < 0) return;
		const hp = (this.ahp[i] as number) - dmg;
		this.aflash[i] = 6;
		if (hp > 0) {
			this.ahp[i] = hp;
			return;
		}
		const def = KIND_DEFS[kind] as (typeof KIND_DEFS)[number];
		this.goldFrac += def.gold;
		const g = Math.floor(this.goldFrac);
		this.goldFrac -= g;
		this.gold += g;
		this.score += Math.round(def.gold * 10);
		this.kills++;
		if (tower >= 0) this.tkills[tower] = (this.tkills[tower] as number) + 1;
		const x = this.ax[i] as number;
		const z = this.az[i] as number;
		// Mite deaths are thousands per wave: keep a share of their effects, every big one.
		if (kind !== KIND.MITE || (this.kills & 1) === 0 || this.events.free > 300)
			this.events.push(EV.KILL, kind, x, z);
		if (kind === KIND.BRUTE) this.burst(x, 0.9, z, 12, 0.6, 5);
		this.freeAgent(i);
	}

	// ------------------------------------------------------------------ towers

	private updateTowers(): void {
		for (let t = 0; t < MAX_TOWERS; t++) {
			const ty = this.ttype[t] as number;
			if (ty < 0) continue;
			const cool = (this.tcool[t] as number) - 1;
			if (cool > 0) {
				this.tcool[t] = cool;
				continue;
			}
			const def = TOWERS[ty] as (typeof TOWERS)[number];
			const lv = (this.tlevel[t] as number) - 1;
			const range = def.range[lv] as number;
			const dmg = def.damage[lv] as number;
			const x = this.tx[t] as number;
			const z = this.tz[t] as number;
			if (ty === TOWER.FROST) {
				const n = this.gather(x, z, range);
				if (n === 0) {
					this.tcool[t] = 6;
					continue;
				}
				const f = def.extra[lv] as number;
				for (let k = 0; k < n; k++) {
					const i = this.q[k] as number;
					this.aslow[i] = SLOW_TICKS;
					if (f < (this.aslowF[i] as number)) this.aslowF[i] = f;
				}
				for (let k = 0; k < n; k++) this.hit(this.q[k] as number, dmg, t);
				this.events.push(EV.PULSE, t, x, z, range);
				this.tcool[t] = def.period[lv] as number;
				this.tfired[t] = this.tick;
				continue;
			}
			const target = this.first(x, z, range);
			if (target < 0) {
				this.tcool[t] = 4;
				continue;
			}
			const ex = this.ax[target] as number;
			const ez = this.az[target] as number;
			this.taim[t] = Math.atan2(ex - x, ez - z);
			this.tcool[t] = def.period[lv] as number;
			this.tfired[t] = this.tick;
			if (ty === TOWER.SPARK) {
				this.events.push(EV.ZAP, t, x, z, ex, ez);
				this.hit(target, dmg, t);
			} else if (ty === TOWER.MORTAR) {
				this.fireShell(t, target, dmg, def.extra[lv] as number);
			} else if (ty === TOWER.LANCE) {
				this.fireLance(t, ex, ez, range, dmg, def.extra[lv] as number);
			}
		}
	}

	private fireShell(t: number, target: number, dmg: number, rad: number): void {
		if (this.nShells >= MAX_SHELLS) return;
		// Lead the target: where its path progress will be when the shell lands.
		const p = this.paths[this.apath[target] as number] as PathSamples;
		let v = this.aspd[target] as number;
		if ((this.aslow[target] as number) > 0) v *= this.aslowF[target] as number;
		const s = Math.min(
			p.length - 1,
			(this.as[target] as number) + (v * SHELL_TICKS) / 60,
		);
		const k = Math.min(p.n - 1, Math.floor(s / STEP));
		const l = this.al[target] as number;
		const lx = (p.x[k] as number) - (p.tz[k] as number) * l;
		const lz = (p.z[k] as number) + (p.tx[k] as number) * l;
		const n = this.nShells++;
		this.sx0[n] = this.tx[t] as number;
		this.sz0[n] = this.tz[t] as number;
		this.sx1[n] = lx;
		this.sz1[n] = lz;
		this.sborn[n] = this.tick;
		this.sdmg[n] = dmg;
		this.srad[n] = rad;
		this.stower[n] = t;
		this.events.push(
			EV.SHELL,
			t,
			this.tx[t] as number,
			this.tz[t] as number,
			lx,
			lz,
		);
	}

	private updateShells(): void {
		let n = 0;
		for (let s = 0; s < this.nShells; s++) {
			if (this.tick - (this.sborn[s] as number) >= SHELL_TICKS) {
				const x = this.sx1[s] as number;
				const z = this.sz1[s] as number;
				const r = this.srad[s] as number;
				const c = this.gather(x, z, r);
				const dmg = this.sdmg[s] as number;
				const t = this.stower[s] as number;
				for (let k = 0; k < c; k++) this.hit(this.q[k] as number, dmg, t);
				this.events.push(EV.BOOM, r * 100, x, z);
				continue;
			}
			if (n !== s) {
				this.sx0[n] = this.sx0[s] as number;
				this.sz0[n] = this.sz0[s] as number;
				this.sx1[n] = this.sx1[s] as number;
				this.sz1[n] = this.sz1[s] as number;
				this.sborn[n] = this.sborn[s] as number;
				this.sdmg[n] = this.sdmg[s] as number;
				this.srad[n] = this.srad[s] as number;
				this.stower[n] = this.stower[s] as number;
			}
			n++;
		}
		this.nShells = n;
	}

	private fireLance(
		t: number,
		ex: number,
		ez: number,
		range: number,
		dmg: number,
		half: number,
	): void {
		const x = this.tx[t] as number;
		const z = this.tz[t] as number;
		let dx = ex - x;
		let dz = ez - z;
		const l = Math.hypot(dx, dz) || 1;
		dx /= l;
		dz /= l;
		const len = range + 2;
		const n = this.gather(
			x + dx * len * 0.5,
			z + dz * len * 0.5,
			len * 0.5 + half + 1,
		);
		for (let k = 0; k < n; k++) {
			const i = this.q[k] as number;
			const px = (this.ax[i] as number) - x;
			const pz = (this.az[i] as number) - z;
			const along = px * dx + pz * dz;
			if (along < 0 || along > len) continue;
			const perp = Math.abs(px * dz - pz * dx);
			const rad = (
				KIND_DEFS[this.akind[i] as number] as (typeof KIND_DEFS)[number]
			).radius;
			if (perp <= half + rad) this.hit(i, dmg, t);
		}
		this.events.push(EV.LANCE, t, x, z, x + dx * len, z + dz * len);
	}

	// ------------------------------------------------------------------ debris

	/** A Rust-side seeded spawner burst of `count` shards at (x, y, z). */
	private burst(
		x: number,
		y: number,
		z: number,
		count: number,
		area: number,
		power: number,
	): void {
		if (this.nDebris + count > MAX_DEBRIS) count = MAX_DEBRIS - this.nDebris;
		if (count <= 0) return;
		const seed = this.rng.int(0x7fffffff);
		const rate = 3600; // all within a tick or two
		const id = this.world.spawn(
			`{"spawner":{"template":${this.debrisJson},"rate":${rate},"count":${count},"areaMin":[${x - area},${y},${z - area}],"areaMax":[${x + area},${y + area},${z + area}],"seed":${seed}}}`,
		);
		this.bursts.push({
			id,
			x,
			z,
			power,
			end: this.tick + Math.ceil((count * 60) / rate) + 3,
		});
	}

	private updateDebris(): void {
		const w = this.world;
		if (w.spawnedPending() > 0) {
			const d = w.drainSpawned();
			for (let k = 0; k + 2 < d.length; k += 3) {
				const id = d[k] as number;
				const src = d[k + 2] as number;
				let b: Burst | undefined;
				for (const bb of this.bursts) if (bb.id === src) b = bb;
				if (!b || this.nDebris >= MAX_DEBRIS) {
					w.despawn(id);
					continue;
				}
				const n = this.nDebris++;
				this.did[n] = id;
				this.dslot[n] = d[k + 1] as number;
				this.dborn[n] = this.tick;
				const r = this.rng;
				const a = r.next() * 6.2832;
				const sp = b.power * (0.4 + 0.6 * r.next());
				w.setVelocity(
					id,
					Math.sin(a) * sp,
					b.power * (0.6 + 0.6 * r.next()),
					Math.cos(a) * sp,
					r.range(-12, 12),
					r.range(-12, 12),
					r.range(-12, 12),
				);
			}
		}
		for (let i = this.bursts.length - 1; i >= 0; i--) {
			const b = this.bursts[i] as Burst;
			if (this.tick < b.end) continue;
			w.despawn(b.id);
			this.bursts[i] = this.bursts[this.bursts.length - 1] as Burst;
			this.bursts.pop();
		}
		let n = 0;
		for (let d = 0; d < this.nDebris; d++) {
			if (this.tick - (this.dborn[d] as number) > DEBRIS_LIFE) {
				w.despawn(this.did[d] as number);
				continue;
			}
			this.did[n] = this.did[d] as number;
			this.dslot[n] = this.dslot[d] as number;
			this.dborn[n] = this.dborn[d] as number;
			n++;
		}
		this.nDebris = n;
	}

	// ------------------------------------------------------------------ queries

	/**
	 * Camera picking: an engine raycast from `o` along `d`. A tower collider selects that
	 * tower; the ground gives a build cell (buildable when the mask and a downward probe
	 * agree); outcrops and the core are blocked.
	 */
	pick(
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
		out: PickResult,
	): PickResult {
		out.kind = PICK.NONE;
		out.cell = -1;
		out.tower = -1;
		out.buildable = false;
		if (!this.world.raycast(ox, oy, oz, dx, dy, dz, 500, RAY_ALL, 0))
			return out;
		this.views.refresh();
		const sc = this.views.scratch;
		const toi = sc[0] as number;
		const id = sc[4] as number;
		const l = Math.hypot(dx, dy, dz) || 1;
		out.x = ox + (dx / l) * toi;
		out.z = oz + (dz / l) * toi;
		for (let t = 0; t < MAX_TOWERS; t++)
			if ((this.ttype[t] as number) >= 0 && this.tbody[t] === id) {
				out.kind = PICK.TOWER;
				out.tower = t;
				return out;
			}
		out.cell = cellAt(out.x, out.z);
		if (id !== this.groundId) {
			out.kind = PICK.BLOCKED;
			return out;
		}
		if (out.cell < 0) return out;
		out.kind = PICK.CELL;
		out.buildable =
			this.mask[out.cell] === 1 &&
			(this.occupied[out.cell] as number) < 0 &&
			this.cellClear(out.cell);
		return out;
	}

	/** Deterministic state hash: agents, towers, economy and the engine world. */
	hash(): string {
		let h = 0x811c9dc5;
		const mix = (v: number): void => {
			h = Math.imul(h ^ (v | 0), 0x01000193);
		};
		mix(this.tick);
		mix(this.phase);
		mix(this.wave);
		mix(this.gold);
		mix(this.coreHp);
		mix(this.kills);
		mix(this.alive);
		for (let i = 0; i < this.hw; i++) {
			mix(this.akind[i] as number);
			if ((this.akind[i] as number) < 0) continue;
			mix(Math.round((this.ax[i] as number) * 1000));
			mix(Math.round((this.az[i] as number) * 1000));
			mix(Math.round((this.ahp[i] as number) * 100));
		}
		for (let t = 0; t < MAX_TOWERS; t++) {
			mix(this.ttype[t] as number);
			mix(this.tlevel[t] as number);
		}
		return `${(h >>> 0).toString(16).padStart(8, "0")}:${this.world.stateHash()}`;
	}

	towerAt(t: number): boolean {
		return t >= 0 && t < MAX_TOWERS && (this.ttype[t] as number) >= 0;
	}
}
