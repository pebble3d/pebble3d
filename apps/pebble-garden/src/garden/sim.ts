import { expandScene } from "@pebble3d/sdk/expand";
import type { Scene } from "@pebble3d/sdk/schema";
import { type SimHandle, StateViews } from "@pebble3d/sdk/sim";
import type { World } from "../../../../packages/sdk/wasm/det/engine_core_det.js";
import { type ResolvedEntity, resolveScene } from "./resolve.ts";

/**
 * The garden simulation, shared verbatim by the browser and the Node tests: a fresh
 * deterministic engine World per Play, spawned from the parsed garden scene, stepped at a
 * fixed 60 Hz. The sandbox adds two rules on top of plain physics:
 *
 * - kinematic bodies are motors: each turns about its own local up axis at SPIN rad/s
 *   (a flat arm sweeps, a lying drum rolls), posed from the tick count alone;
 * - goal mode, when the garden has a `pebble` and a `goal*` entity: the pebble must stay
 *   inside the bowl's zone for GOAL_HOLD ticks; it fails if it leaves the garden, if
 *   everything comes to rest elsewhere, or at TIME_LIMIT.
 *
 * No Math.random, no Date, no DOM: the same scene gives the same state hash every run.
 */

export const DT = 1 / 60;
/** Kinematic motor speed, rad/s. */
export const SPIN = 1.4;
export const GOAL_HOLD = 45;
export const TIME_LIMIT = 60 * 30;
/** All dynamic bodies slower than this (m/s) for STILL_TICKS ends a goal run. */
const STILL_SPEED = 0.03;
const STILL_TICKS = 150;
/** The pebble beyond this |x| or |z| (m) has left the garden. */
export const GARDEN_EXTENT = 14;
/** Velocity change in one tick (m/s) that counts as an impact (sound cue). */
const IMPACT_DV = 1.2;
const VEL = 12;
/** Bodies watched for impacts (sound) and stillness. */
const TRACK_CAP = 160;
const EVENT_CAP = 32;

export interface Engine {
	newWorld(seed: number, gravity: number): World;
	memory: WebAssembly.Memory;
}

export function engineFrom(h: SimHandle): Engine {
	const Ctor = h.world.constructor as new (seed: number, g: number) => World;
	return { newWorld: (s, g) => new Ctor(s, g), memory: h.memory };
}

/** The engine refused an entity (a schema-valid value it cannot simulate). */
export class GardenSimError extends Error {
	constructor(
		readonly entityId: string,
		readonly reason: string,
	) {
		super(`"${entityId}" cannot be simulated: ${reason}`);
		this.name = "GardenSimError";
	}
}

/**
 * Builds and frees a sim to check that the engine accepts a scene. Returns null when it
 * does, else a readable message naming the entity.
 */
export function simulationProblem(engine: Engine, scene: Scene): string | null {
	try {
		new GardenSim(engine, scene).dispose();
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

export type RunStatus = "running" | "goal" | "failed";
export type FailReason = "lost" | "stopped" | "timeout" | null;

export interface SimEvent {
	kind: "impact" | "goal-enter" | "goal" | "failed";
	x: number;
	y: number;
	z: number;
	strength: number;
}

interface Spinner {
	id: number;
	px: number;
	py: number;
	pz: number;
	qx: number;
	qy: number;
	qz: number;
	qw: number;
}

interface Tracked {
	id: number;
	vx: number;
	vy: number;
	vz: number;
}

export interface GoalZone {
	x: number;
	z: number;
	radius: number;
	minY: number;
	maxY: number;
}

export class GardenSim {
	readonly world: World;
	readonly views: StateViews;
	/** sceneId -> engine id (simulated entities only, plus `__ground` / `__bounds.*`). */
	readonly ids = new Map<string, number>();
	readonly entities: ResolvedEntity[];
	/** Per resolved entity: its state slot, or -1 when it is not simulated. */
	readonly slots: Int32Array;
	readonly goal: GoalZone | null;
	readonly goalMode: boolean;
	tick = 0;
	status: RunStatus = "running";
	reason: FailReason = null;
	/** Consecutive ticks the pebble has been in the bowl. */
	inGoal = 0;
	private still = 0;
	private readonly pebbleId: number = -1;
	private readonly pebbleSlot: number = -1;
	private readonly spinners: Spinner[] = [];
	private readonly tracked: Tracked[] = [];
	private readonly events: SimEvent[] = [];
	private evCount = 0;
	private readonly gravity: number;

	constructor(engine: Engine, scene: Scene) {
		this.entities = resolveScene(scene);
		this.gravity = -scene.sim.gravity;
		const x = expandScene(scene);
		const skip = new Set(x.pendingHulls);
		for (const e of this.entities) if (e.unsupported) skip.add(e.id);
		this.world = engine.newWorld(scene.sim.seed, scene.sim.gravity);
		try {
			for (const s of x.sim) {
				if (skip.has(s.sceneId)) continue;
				let id: number;
				try {
					id = this.world.spawn(JSON.stringify(s.desc));
				} catch (err) {
					throw new GardenSimError(
						s.sceneId,
						err instanceof Error ? err.message : String(err),
					);
				}
				this.ids.set(s.sceneId, id);
			}
			this.views = new StateViews({
				world: this.world,
				memory: engine.memory,
			} as SimHandle);
			this.slots = new Int32Array(this.entities.length).fill(-1);
			let goalEnt: ResolvedEntity | null = null;
			for (const e of this.entities) {
				const id = this.ids.get(e.id);
				if (id === undefined) continue;
				this.slots[e.index] = this.world.slotOf(id);
				if (e.body === "kinematic") {
					const [px, py, pz] = e.position;
					const [qx, qy, qz, qw] = normQuat(e.rotation);
					this.spinners.push({ id, px, py, pz, qx, qy, qz, qw });
				} else if (e.body === "dynamic" && this.tracked.length < TRACK_CAP) {
					this.tracked.push({ id, vx: 0, vy: 0, vz: 0 });
				}
				if (e.role === "pebble" && e.body === "dynamic") {
					this.pebbleId = id;
					this.pebbleSlot = this.world.slotOf(id);
				}
				if (e.role === "goal" && !goalEnt) goalEnt = e;
			}
			this.goal = goalEnt ? goalZoneOf(goalEnt) : null;
			this.goalMode = this.goal !== null && this.pebbleId >= 0;
			for (let i = 0; i < EVENT_CAP; i++)
				this.events.push({ kind: "impact", x: 0, y: 0, z: 0, strength: 0 });
		} catch (err) {
			// Never leak the wasm World of a sim that failed to build.
			this.world.free();
			throw err;
		}
	}

	pebbleX(): number {
		return this.views.curr[this.pebbleSlot * 8] as number;
	}
	pebbleY(): number {
		return this.views.curr[this.pebbleSlot * 8 + 1] as number;
	}
	pebbleZ(): number {
		return this.views.curr[this.pebbleSlot * 8 + 2] as number;
	}

	private emit(
		kind: SimEvent["kind"],
		x: number,
		y: number,
		z: number,
		s: number,
	): void {
		if (this.evCount >= EVENT_CAP) return;
		const e = this.events[this.evCount++] as SimEvent;
		e.kind = kind;
		e.x = x;
		e.y = y;
		e.z = z;
		e.strength = s;
	}

	/** Calls `fn` for each event since the last drain (records are reused). */
	drain(fn: (e: SimEvent) => void): void {
		for (let i = 0; i < this.evCount; i++) fn(this.events[i] as SimEvent);
		this.evCount = 0;
	}

	/** One fixed tick. Keeps simulating after a goal or failure (the garden stays alive). */
	step(): void {
		const w = this.world;
		// Motors: the pose for the end of this tick, from the tick count alone.
		const a = (SPIN * (this.tick + 1) * DT) / 2;
		const s = Math.sin(a);
		const c = Math.cos(a);
		for (const sp of this.spinners) {
			// q0 * (rotation about local +y by SPIN * t)
			const qx = sp.qx * c - sp.qz * s;
			const qy = sp.qy * c + sp.qw * s;
			const qz = sp.qz * c + sp.qx * s;
			const qw = sp.qw * c - sp.qy * s;
			w.setKinematicPose(sp.id, sp.px, sp.py, sp.pz, qx, qy, qz, qw);
		}
		w.step(1);
		this.tick++;
		this.views.refresh();
		const sc = this.views.scratch;
		const curr = this.views.curr;
		let fastest = 0;
		const g = this.gravity * DT;
		for (const t of this.tracked) {
			if (!w.linearVelocity(t.id)) continue;
			const vx = sc[VEL] as number;
			const vy = sc[VEL + 1] as number;
			const vz = sc[VEL + 2] as number;
			const sp = Math.hypot(vx, vy, vz);
			if (sp > fastest) fastest = sp;
			const dv = Math.hypot(vx - t.vx, vy - t.vy + g, vz - t.vz);
			if (dv > IMPACT_DV) {
				const slot = w.slotOf(t.id);
				this.emit(
					"impact",
					curr[slot * 8] as number,
					curr[slot * 8 + 1] as number,
					curr[slot * 8 + 2] as number,
					dv,
				);
			}
			t.vx = vx;
			t.vy = vy;
			t.vz = vz;
		}
		if (!this.goalMode || this.status !== "running") return;
		const goal = this.goal as GoalZone;
		const px = this.pebbleX();
		const py = this.pebbleY();
		const pz = this.pebbleZ();
		const inside =
			Math.hypot(px - goal.x, pz - goal.z) <= goal.radius &&
			py >= goal.minY &&
			py <= goal.maxY;
		if (inside) {
			if (this.inGoal === 0) this.emit("goal-enter", px, py, pz, 1);
			this.inGoal++;
			if (this.inGoal >= GOAL_HOLD) {
				this.status = "goal";
				this.emit("goal", px, py, pz, 1);
				return;
			}
		} else this.inGoal = 0;
		this.still = fastest < STILL_SPEED && !inside ? this.still + 1 : 0;
		let reason: FailReason = null;
		if (Math.abs(px) > GARDEN_EXTENT || Math.abs(pz) > GARDEN_EXTENT || py < -5)
			reason = "lost";
		else if (this.still >= STILL_TICKS && this.spinners.length === 0)
			reason = "stopped";
		else if (this.tick >= TIME_LIMIT) reason = "timeout";
		if (reason) {
			this.status = "failed";
			this.reason = reason;
			this.emit("failed", px, py, pz, 0);
		}
	}

	/** Steps `n` ticks (events dropped). */
	run(n: number): void {
		for (let i = 0; i < n; i++) {
			this.step();
			this.evCount = 0;
		}
	}

	/** Steps until the goal run ends, or `max` ticks. */
	runToEnd(max = TIME_LIMIT + 1): void {
		while (this.status === "running" && this.tick < max) {
			this.step();
			this.evCount = 0;
		}
	}

	hash(): string {
		return this.world.stateHash();
	}

	dispose(): void {
		this.world.free();
	}
}

/** The bowl's goal zone: a cylinder over its top face, as tall as a pebble is wide (x2). */
export function goalZoneOf(e: ResolvedEntity): GoalZone {
	const radius = Math.max(e.scale[0], e.scale[2]) / 2;
	const top = e.position[1] + e.scale[1] / 2;
	return {
		x: e.position[0],
		z: e.position[2],
		radius,
		minY: top - 0.05,
		maxY: top + 0.6,
	};
}

function normQuat(
	q: [number, number, number, number],
): [number, number, number, number] {
	const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
