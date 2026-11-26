import {
	allBlocks,
	blockDesc,
	type Course,
	islandDesc,
	moverDesc,
	moverPose,
} from "./course.ts";
import { BTN, type TickInput } from "./input.ts";
import type { PhysWorld } from "./physics.ts";

export const DT = 1 / 60;
export const GRAVITY = -18;
/** Capsule: half height + radius = centre height above the feet. */
export const HALF_HEIGHT = 0.5;
export const RADIUS = 0.3;
export const CENTER_Y = HALF_HEIGHT + RADIUS;
export const RUN = {
	speed: 5,
	sprintSpeed: 8.5,
	jumpSpeed: 8,
	accel: 32,
	maxSlopeDeg: 46,
	stepHeight: 0.4,
	snap: 0.35,
} as const;
/** Ticks a jump press stays queued (pressed just before landing still jumps). */
export const JUMP_BUFFER = 8;
/** Countdown before the clock starts. */
export const COUNTDOWN = 180;
/** Ticks between falling out and the respawn. */
export const RESPAWN_DELAY = 40;
export const CHECKPOINT_RADIUS = 1.6;
export const SHARD_RADIUS = 1.0;
export const GOAL_RADIUS = 1.8;

export const PHASE = { READY: 0, RUN: 1, DONE: 2 } as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];

export const EV = {
	BEEP: 1,
	GO: 2,
	JUMP: 3,
	LAND: 4,
	SHARD: 5,
	CHECKPOINT: 6,
	FALL: 7,
	RESPAWN: 8,
	FINISH: 9,
} as const;

/** Fixed-size ring of this tick's events (no allocation per tick). */
export class Events {
	readonly type = new Int32Array(32);
	readonly a = new Float64Array(32);
	readonly x = new Float64Array(32);
	readonly y = new Float64Array(32);
	readonly z = new Float64Array(32);
	n = 0;
	push(t: number, a = 0, x = 0, y = 0, z = 0): void {
		if (this.n >= 32) return;
		const i = this.n++;
		this.type[i] = t;
		this.a[i] = a;
		this.x[i] = x;
		this.y[i] = y;
		this.z[i] = z;
	}
}

/** Scratch slots written by `characterState`: [grounded, vx, vz, vy] at [8..12). */
const CS = 8;

/** The world-plus-views pair a sim runs on (see `physics.ts`). */
export interface SimWorldHost {
	create(seed: number, gravity: number): PhysWorld;
	views(world: PhysWorld): {
		curr: Float32Array;
		prev: Float32Array;
		scratch: Float32Array;
		refresh(): void;
	};
}

/**
 * One run of a course: its own engine world (islands, blocks, kinematic movers and the
 * runner's kinematic character with `ridePlatforms`), advanced one 60 Hz tick per `step`
 * from one `TickInput`, and nothing else (no DOM, no clock, no Math.random). The same
 * course and input log give the same `hash()` in Node and in the browser, which is what
 * the best-run ghost relies on: it is a second `SkyrunSim` re-fed the logged inputs.
 */
export class SkyrunSim {
	readonly course: Course;
	readonly world: PhysWorld;
	readonly views: ReturnType<SimWorldHost["views"]>;
	readonly events = new Events();
	readonly playerId: number;
	readonly playerSlot: number;
	readonly moverIds: Int32Array;
	readonly moverSlots: Int32Array;
	readonly moverIndex = new Map<string, number>();

	tick = 0;
	phase: Phase = PHASE.READY;
	/** Ticks since GO (frozen at the finish). */
	runTicks = 0;
	px = 0;
	py = 0;
	pz = 0;
	vx = 0;
	vz = 0;
	vy = 0;
	grounded = false;
	/** Move intent this tick (world XZ, length <= 1), for presentation. */
	moveX = 0;
	moveZ = 0;
	nextCheckpoint = 0;
	respawnX: number;
	respawnY: number;
	respawnZ: number;
	respawnYaw: number;
	/** 1 per shard taken. */
	readonly shardTaken: Uint8Array;
	shards = 0;
	falls = 0;
	jumps = 0;
	/** > 0 while falling out, counting down to the respawn. */
	respawnIn = 0;
	private jumpBuffer = 0;
	private prevButtons = 0;
	private prevVy = 0;
	private airTicks = 0;
	private readonly mp = new Float64Array(3);
	private readonly mq = new Float64Array(4);

	constructor(host: SimWorldHost, course: Course, seed = 1) {
		this.course = course;
		const w = host.create(seed, GRAVITY);
		this.world = w;
		try {
			for (const i of course.islands) w.spawn(JSON.stringify(islandDesc(i)));
			for (const b of allBlocks(course)) w.spawn(JSON.stringify(blockDesc(b)));
			this.moverIds = new Int32Array(course.movers.length);
			this.moverSlots = new Int32Array(course.movers.length);
			course.movers.forEach((m, k) => {
				moverPose(m, 0, this.mp, this.mq);
				const desc = moverDesc(m);
				desc.position = [this.mp[0], this.mp[1], this.mp[2]];
				desc.rotation = [this.mq[0], this.mq[1], this.mq[2], this.mq[3]];
				const id = w.spawn(JSON.stringify(desc));
				this.moverIds[k] = id;
				this.moverSlots[k] = w.slotOf(id);
				this.moverIndex.set(m.id, k);
			});
			const s = course.start.pos;
			this.playerId = w.spawn(
				JSON.stringify({
					name: "runner",
					position: [s[0], s[1] + CENTER_Y + 0.02, s[2]],
					body: {
						type: "kinematic",
						mass: 70,
						collider: {
							shape: "capsule",
							halfHeight: HALF_HEIGHT,
							radius: RADIUS,
						},
					},
					character: { ...RUN, ridePlatforms: true },
				}),
			);
			this.playerSlot = w.slotOf(this.playerId);
		} catch (e) {
			w.free();
			throw e;
		}
		this.views = host.views(w);
		this.respawnX = s0(course)[0];
		this.respawnY = s0(course)[1];
		this.respawnZ = s0(course)[2];
		this.respawnYaw = course.start.yaw;
		this.shardTaken = new Uint8Array(course.shards.length);
		this.readPlayer();
	}

	/** Seconds on the clock. */
	get time(): number {
		return this.runTicks * DT;
	}

	/** Ticks of countdown left (0 once running). */
	get countdown(): number {
		return Math.max(0, COUNTDOWN - this.tick);
	}

	step(input: TickInput): void {
		this.events.n = 0;
		const pressed = input.buttons & ~this.prevButtons;
		this.prevButtons = input.buttons;

		// Movers: the pose each kinematic body reaches in this step.
		const s = (this.tick + 1) * DT;
		const movers = this.course.movers;
		for (let k = 0; k < movers.length; k++) {
			moverPose(movers[k] as Course["movers"][number], s, this.mp, this.mq);
			this.world.setKinematicPose(
				this.moverIds[k] as number,
				this.mp[0] as number,
				this.mp[1] as number,
				this.mp[2] as number,
				this.mq[0] as number,
				this.mq[1] as number,
				this.mq[2] as number,
				this.mq[3] as number,
			);
		}

		// Runner input.
		const control = this.phase === PHASE.RUN && this.respawnIn === 0;
		let mx = 0;
		let mz = 0;
		if (control) {
			mx = input.x / 127;
			mz = input.z / 127;
			if ((pressed & BTN.JUMP) !== 0) this.jumpBuffer = JUMP_BUFFER;
		} else this.jumpBuffer = 0;
		this.moveX = mx;
		this.moveZ = mz;
		const jump = this.jumpBuffer > 0;
		if (this.jumpBuffer > 0) this.jumpBuffer--;
		this.world.setCharacterInput(
			this.playerId,
			mx,
			mz,
			jump,
			control && (input.buttons & BTN.SPRINT) !== 0,
		);

		this.world.step(1);
		this.tick++;
		this.views.refresh();
		const wasGrounded = this.grounded;
		this.readPlayer();

		// Jump started: vertical speed jumped up this tick.
		if (this.vy > RUN.jumpSpeed * 0.6 && this.prevVy < RUN.jumpSpeed * 0.3) {
			this.jumpBuffer = 0;
			this.jumps++;
			this.events.push(EV.JUMP, 0, this.px, this.py, this.pz);
		}
		if (this.grounded && !wasGrounded && this.airTicks > 8)
			this.events.push(EV.LAND, this.airTicks, this.px, this.py, this.pz);
		this.airTicks = this.grounded ? 0 : this.airTicks + 1;
		this.prevVy = this.vy;

		this.rules();
	}

	private rules(): void {
		const c = this.course;
		if (this.phase === PHASE.READY) {
			const left = COUNTDOWN - this.tick;
			if (left === 0) {
				this.phase = PHASE.RUN;
				this.events.push(EV.GO);
			} else if (left % 50 === 0) this.events.push(EV.BEEP, left / 50);
			return;
		}
		if (this.phase === PHASE.RUN) this.runTicks++;

		if (this.respawnIn > 0) {
			this.respawnIn--;
			if (this.respawnIn === 0) {
				this.world.teleport(
					this.playerId,
					this.respawnX,
					this.respawnY + CENTER_Y + 0.05,
					this.respawnZ,
				);
				this.views.refresh();
				this.readPlayer();
				this.events.push(
					EV.RESPAWN,
					0,
					this.respawnX,
					this.respawnY,
					this.respawnZ,
				);
			}
			return;
		}
		if (this.py < c.killY) {
			this.falls++;
			this.respawnIn = RESPAWN_DELAY;
			this.events.push(EV.FALL, 0, this.px, this.py, this.pz);
			return;
		}
		if (this.phase !== PHASE.RUN) return;

		const fy = this.py - CENTER_Y;
		// Shards.
		for (let i = 0; i < c.shards.length; i++) {
			if (this.shardTaken[i]) continue;
			const p = c.shards[i] as [number, number, number];
			if (
				dist2(this.px, this.py, this.pz, p[0], p[1], p[2]) <
				SHARD_RADIUS * SHARD_RADIUS * 1.6
			) {
				this.shardTaken[i] = 1;
				this.shards++;
				this.events.push(EV.SHARD, i, p[0], p[1], p[2]);
			}
		}
		// Checkpoints, in order.
		const cp = c.checkpoints[this.nextCheckpoint];
		if (cp && near(this.px, fy, this.pz, cp.pos, CHECKPOINT_RADIUS)) {
			this.respawnX = cp.pos[0];
			this.respawnY = cp.pos[1];
			this.respawnZ = cp.pos[2];
			this.respawnYaw = cp.yaw;
			this.events.push(
				EV.CHECKPOINT,
				this.nextCheckpoint,
				cp.pos[0],
				cp.pos[1],
				cp.pos[2],
			);
			this.nextCheckpoint++;
		}
		// Goal, once every checkpoint is through.
		if (
			this.nextCheckpoint >= c.checkpoints.length &&
			near(this.px, fy, this.pz, c.goal.pos, GOAL_RADIUS)
		) {
			this.phase = PHASE.DONE;
			this.events.push(
				EV.FINISH,
				this.runTicks,
				c.goal.pos[0],
				c.goal.pos[1],
				c.goal.pos[2],
			);
		}
	}

	private readPlayer(): void {
		const v = this.views;
		const o = this.playerSlot * 8;
		this.px = v.curr[o] as number;
		this.py = v.curr[o + 1] as number;
		this.pz = v.curr[o + 2] as number;
		if (this.world.characterState(this.playerId)) {
			this.grounded = (v.scratch[CS] as number) > 0.5;
			this.vx = v.scratch[CS + 1] as number;
			this.vz = v.scratch[CS + 2] as number;
			this.vy = v.scratch[CS + 3] as number;
		}
	}

	/** A mover's current pose index for presentation lookups. */
	moverSlot(id: string): number {
		const k = this.moverIndex.get(id);
		return k === undefined ? -1 : (this.moverSlots[k] as number);
	}

	/** World position of a mover now, into `out` (bot use). */
	moverPos(k: number, out: Float64Array): void {
		const o = (this.moverSlots[k] as number) * 8;
		out[0] = this.views.curr[o] as number;
		out[1] = this.views.curr[o + 1] as number;
		out[2] = this.views.curr[o + 2] as number;
	}

	/** A mover's yaw now, degrees in [0, 360) (bot use). */
	moverYaw(k: number): number {
		const o = (this.moverSlots[k] as number) * 8;
		const qy = this.views.curr[o + 4] as number;
		const qw = this.views.curr[o + 6] as number;
		const d = (2 * Math.atan2(qy, qw) * 180) / Math.PI;
		return ((d % 360) + 360) % 360;
	}

	/** Engine state hash mixed with the run's own state. */
	hash(): string {
		let h = 0x811c9dc5;
		const mix = (n: number): void => {
			h ^= n | 0;
			h = Math.imul(h, 0x01000193);
		};
		mix(this.tick);
		mix(this.runTicks);
		mix(this.phase);
		mix(this.shards);
		mix(this.falls);
		mix(this.nextCheckpoint);
		return `${this.world.stateHash()}-${(h >>> 0).toString(16).padStart(8, "0")}`;
	}

	free(): void {
		this.world.free();
	}
}

function s0(c: Course): [number, number, number] {
	return c.start.pos;
}

function dist2(
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
): number {
	const dx = ax - bx;
	const dy = ay - by;
	const dz = az - bz;
	return dx * dx + dy * dy + dz * dz;
}

/** Feet within `r` horizontally and within 2 m vertically of `p`. */
function near(
	x: number,
	fy: number,
	z: number,
	p: [number, number, number],
	r: number,
): boolean {
	const dx = x - p[0];
	const dz = z - p[2];
	const dy = fy - p[1];
	return dx * dx + dz * dz < r * r && dy > -0.6 && dy < 2.2;
}
