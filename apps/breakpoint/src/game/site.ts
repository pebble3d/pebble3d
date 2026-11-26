import type { SimHandle } from "@pebble3d/sdk/sim";
import { type BlockSpec, KINDS, kindMass } from "./blocks.ts";
import { BALL, SETTLE_MAX_TICKS } from "./constants.ts";
import type { LevelDef } from "./levels.ts";

type World = SimHandle["world"];

/** What a Site needs: a fresh World and the wasm memory its state buffers live in. */
export interface WorldSource {
	make(): World;
	memory: WebAssembly.Memory;
}

/** A shot: the launch velocity of one ball, fired at a world tick. */
export interface Shot {
	tick: number;
	vx: number;
	vy: number;
	vz: number;
}

const STRIDE = 8;
const SLEEPING = 2;

/** Rounds to the nearest f32, so a shot stored in JS replays bit-identically. */
export const f32 = Math.fround;

/**
 * One demolition site in its own deterministic Rapier world: the level's blocks, the balls
 * fired so far, and flat views over the world's interpolation state. Two Sites built from the
 * same level and seed and fed the same shots at the same ticks are bit-identical.
 */
export class Site {
	readonly world: World;
	readonly level: LevelDef;
	readonly blocks: BlockSpec[];
	readonly n: number;
	/** Per block: world slot, mass, starts-above-line flag. */
	readonly slots: Int32Array;
	readonly mass: Float32Array;
	readonly above: Uint8Array;
	/** Total mass that starts above the line (the 100% mark). */
	readonly aboveMass: number;
	readonly totalMass: number;
	/** Ball entity ids and slots, in firing order. */
	readonly ballIds: number[] = [];
	readonly ballSlots: number[] = [];
	prev: Float32Array;
	curr: Float32Array;
	private readonly src: WorldSource;
	private ptrPrev = -1;
	private ptrCurr = -1;
	private cap = -1;
	private buf: ArrayBufferLike | null = null;
	private freed = false;

	constructor(src: WorldSource, level: LevelDef, seed: number) {
		this.src = src;
		this.level = level;
		this.world = src.make();
		this.world.spawn(
			JSON.stringify({
				name: "ground",
				position: [0, 0, 0],
				body: { type: "static", friction: 0.9, collider: { shape: "plane" } },
			}),
		);
		this.blocks = level.build(seed);
		this.n = this.blocks.length;
		this.slots = new Int32Array(this.n);
		this.mass = new Float32Array(this.n);
		this.above = new Uint8Array(this.n);
		let above = 0;
		let total = 0;
		for (let i = 0; i < this.n; i++) {
			const b = this.blocks[i] as BlockSpec;
			const k = KINDS[b.kind] as (typeof KINDS)[number];
			const m = kindMass(b.kind);
			const s = Math.sin(b.yaw / 2);
			const c = Math.cos(b.yaw / 2);
			const id = this.world.spawn(
				JSON.stringify({
					position: [b.x, b.y, b.z],
					rotation: [0, s, 0, c],
					body: {
						type: "dynamic",
						mass: m,
						friction: k.friction,
						restitution: 0.02,
						linearDamping: 0.02,
						angularDamping: 0.08,
						collider: { shape: "box", halfExtents: k.half },
					},
				}),
			);
			this.slots[i] = this.world.slotOf(id);
			this.mass[i] = m;
			total += m;
			if (b.y > level.line) {
				this.above[i] = 1;
				above += m;
			}
		}
		this.aboveMass = above;
		this.totalMass = total;
		this.prev = new Float32Array(0);
		this.curr = new Float32Array(0);
		this.refresh();
	}

	get tick(): number {
		return this.world.tick();
	}

	/** Rebuilds the state views if the wasm memory grew or the buffers moved. */
	refresh(): void {
		const w = this.world;
		const pp = w.statePtrPrev();
		const pc = w.statePtrCurr();
		const cap = w.slotCapacity();
		const buf = this.src.memory.buffer;
		if (
			pp === this.ptrPrev &&
			pc === this.ptrCurr &&
			cap === this.cap &&
			buf === this.buf
		)
			return;
		this.ptrPrev = pp;
		this.ptrCurr = pc;
		this.cap = cap;
		this.buf = buf;
		this.prev = new Float32Array(buf, pp, cap * STRIDE);
		this.curr = new Float32Array(buf, pc, cap * STRIDE);
	}

	step(): void {
		this.world.step(1);
		this.refresh();
	}

	/** Spawns a ball at the launcher muzzle with the shot's velocity. Returns its slot. */
	fire(shot: Shot): number {
		const [x, y, z] = this.level.launcher;
		const id = this.world.spawn(
			JSON.stringify({
				name: `ball-${this.ballIds.length}`,
				position: [x, y, z],
				body: {
					type: "dynamic",
					mass: BALL.mass,
					friction: 0.5,
					restitution: 0.05,
					linearDamping: 0.01,
					angularDamping: 0.6,
					ccd: true,
					collider: { shape: "sphere", radius: BALL.radius },
				},
			}),
		);
		this.world.setVelocity(id, shot.vx, shot.vy, shot.vz, 0, 0, 0);
		const slot = this.world.slotOf(id);
		this.ballIds.push(id);
		this.ballSlots.push(slot);
		this.refresh();
		return slot;
	}

	/** Blocks not asleep (allocation-free scan of the slot flags). */
	awakeBlocks(): number {
		this.refresh();
		const c = this.curr;
		let n = 0;
		for (let i = 0; i < this.n; i++)
			if (
				((c[(this.slots[i] as number) * STRIDE + 7] as number) & SLEEPING) ===
				0
			)
				n++;
		return n;
	}

	/** Mass (kg) that started above the line and is now below it. */
	knockedMass(): number {
		this.refresh();
		const c = this.curr;
		const line = this.level.line;
		let m = 0;
		for (let i = 0; i < this.n; i++)
			if (
				this.above[i] &&
				(c[(this.slots[i] as number) * STRIDE + 1] as number) < line
			)
				m += this.mass[i] as number;
		return m;
	}

	/** Steps until every block sleeps (or the cap). Returns the ticks taken. */
	settle(maxTicks = SETTLE_MAX_TICKS): number {
		let t = 0;
		while (t < maxTicks) {
			this.step();
			t++;
			if (t % 10 === 0 && this.awakeBlocks() === 0) break;
		}
		return t;
	}

	/** Ray distance to the first collider hit (blocks, balls, ground), or -1. */
	raycast(
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
		max: number,
	): number {
		if (!this.world.raycast(ox, oy, oz, dx, dy, dz, max, 0, 0)) return -1;
		const buf = this.src.memory.buffer;
		if (this.scratchBuf !== buf || !this.scratch) {
			this.scratchBuf = buf;
			this.scratch = new Float32Array(buf, this.world.scratchPtr(), 16);
		}
		return this.scratch[0] as number;
	}
	private scratch: Float32Array | null = null;
	private scratchBuf: ArrayBufferLike | null = null;

	hash(): string {
		return this.world.stateHash();
	}

	free(): void {
		if (this.freed) return;
		this.freed = true;
		this.world.free();
	}
}
