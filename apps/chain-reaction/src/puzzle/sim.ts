import { mergePrefab, resolveCollider, type Scene } from "@pebble3d/sdk/schema";
import { type SimHandle, StateViews } from "@pebble3d/sdk/sim";
import type { World } from "../../../../packages/sdk/wasm/det/engine_core_det.js";
import { type ComposedLevel, composeLevel, type GoalZone } from "./compose.ts";
import type { Level, Placement } from "./level.ts";
import type { Role } from "./parts.ts";

/**
 * The puzzle simulation, shared verbatim by the browser and the Node `verify` CLI: a fresh
 * deterministic engine World per run, spawned from the composed level scene, plus the
 * part behaviours (springs, fans) applied as impulses before each fixed 60 Hz tick. No
 * Math.random, no Date, no DOM: the same level and placements give the same state hash.
 */

export const DT = 1 / 60;
/** Ticks the ball must stay in the cup to count. */
export const GOAL_HOLD_TICKS = 30;
/** Every moving body slower than this (m/s) for STILL_TICKS, ball outside the goal, ends the run. */
export const STILL_SPEED = 0.04;
export const STILL_TICKS = 150;
/** Ticks a spring rests after firing. */
const SPRING_COOLDOWN = 20;
/** Velocity change (m/s) in one tick that counts as an impact event. */
const IMPACT_DV = 1.1;
/** Scratch slots: `linearVelocity` writes [12..15). */
const VEL = 12;

export type RunStatus = "running" | "solved" | "failed";
export type FailReason = "timeout" | "stopped" | "lost" | null;

export type SimEventKind =
	| "impact"
	| "domino"
	| "spring"
	| "fan"
	| "goal"
	| "solved"
	| "failed";

/** A preallocated event record (the ring is reused; read it during `drain`). */
export interface SimEvent {
	kind: SimEventKind;
	tick: number;
	x: number;
	y: number;
	/** Impact speed change or similar strength, m/s. */
	strength: number;
}

const EVENT_CAP = 64;

/** Builds a fresh `World` in an already-initialised wasm module. */
export interface Engine {
	newWorld(seed: number, gravity: number): World;
	memory: WebAssembly.Memory;
}

/** An `Engine` over a loaded sdk `SimHandle` (same module, new worlds). */
export function engineFrom(h: SimHandle): Engine {
	const Ctor = h.world.constructor as new (seed: number, g: number) => World;
	return {
		newWorld: (seed, g) => new Ctor(seed, g),
		memory: h.memory,
	};
}

interface Tracked {
	id: number;
	slot: number;
	role: Role;
	/** Last tick's linear velocity (impact detection). */
	vx: number;
	vy: number;
	cooldown: number;
	/** Domino: has it been knocked (event once). */
	knocked: boolean;
}

export interface RunResult {
	status: RunStatus;
	reason: FailReason;
	tick: number;
	hash: string;
}

export class PuzzleSim {
	readonly level: Level;
	readonly composed: ComposedLevel;
	readonly world: World;
	readonly views: StateViews;
	/** sceneId -> engine entity id. */
	readonly ids: Map<string, number>;
	readonly goal: GoalZone;
	readonly ballId: number;
	status: RunStatus = "running";
	reason: FailReason = null;
	tick = 0;
	/** Ticks the ball has been in the cup. */
	inGoal = 0;
	private still = 0;
	private readonly ball: Tracked;
	/** Downward gravity magnitude (m/s^2) and the ball's mass (kg) from the scene. */
	private readonly gravity: number;
	private readonly ballMass: number;
	private readonly springs: Tracked[] = [];
	private readonly fans: Tracked[] = [];
	private readonly bodies: Tracked[] = [];
	private readonly events: SimEvent[] = [];
	private evHead = 0;
	private evCount = 0;
	/** Per fan: is the ball in its stream (event on entry only). */
	private readonly fanHits: boolean[] = [];

	constructor(engine: Engine, level: Level, placements: readonly Placement[]) {
		this.level = level;
		this.composed = composeLevel(level, placements);
		const { scene, expanded } = this.composed;
		this.world = engine.newWorld(scene.sim.seed, scene.sim.gravity);
		this.ids = new Map();
		try {
			for (const e of expanded.sim)
				this.ids.set(e.sceneId, this.world.spawn(JSON.stringify(e.desc)));
		} catch (err) {
			// Never leak the wasm World of a sim that failed to build.
			this.world.free();
			throw err;
		}
		this.gravity = -scene.sim.gravity;
		this.ballMass = ballMass(scene);
		this.views = new StateViews({
			world: this.world,
			memory: engine.memory,
		} as SimHandle);
		this.goal = this.composed.goal;
		const track = (sceneId: string, role: Role): Tracked => {
			const id = this.ids.get(sceneId);
			if (id === undefined) throw new Error(`no entity ${sceneId}`);
			return {
				id,
				slot: this.world.slotOf(id),
				role,
				vx: 0,
				vy: 0,
				cooldown: 0,
				knocked: false,
			};
		};
		this.ball = track("ball", { kind: "ball" });
		this.ballId = this.ball.id;
		for (const pe of this.composed.parts) {
			if (!pe.role) continue;
			const t = track(pe.entity.id, pe.role);
			if (pe.role.kind === "spring") this.springs.push(t);
			else if (pe.role.kind === "fan") {
				this.fans.push(t);
				this.fanHits.push(false);
			} else this.bodies.push(t);
		}
		for (let i = 0; i < EVENT_CAP; i++)
			this.events.push({ kind: "impact", tick: 0, x: 0, y: 0, strength: 0 });
		const [vx, vy] = level.ball.velocity;
		if (vx !== 0 || vy !== 0)
			this.world.setVelocity(this.ballId, vx, vy, 0, 0, 0, 0);
		level.marbles.forEach((m, i) => {
			const id = this.ids.get(`marble-${i}`);
			const [mx, my] = m.velocity;
			if (id !== undefined && (mx !== 0 || my !== 0))
				this.world.setVelocity(id, mx, my, 0, 0, 0, 0);
		});
	}

	/** Ball centre from the current state buffer. */
	ballX(): number {
		return this.views.curr[this.ball.slot * 8] as number;
	}
	ballY(): number {
		return this.views.curr[this.ball.slot * 8 + 1] as number;
	}

	private emit(
		kind: SimEventKind,
		x: number,
		y: number,
		strength: number,
	): void {
		const i = (this.evHead + this.evCount) % EVENT_CAP;
		const e = this.events[i] as SimEvent;
		e.kind = kind;
		e.tick = this.tick;
		e.x = x;
		e.y = y;
		e.strength = strength;
		if (this.evCount < EVENT_CAP) this.evCount++;
		else this.evHead = (this.evHead + 1) % EVENT_CAP;
	}

	/** Calls `fn` for each event since the last drain (records are reused afterwards). */
	drain(fn: (e: SimEvent) => void): void {
		for (let k = 0; k < this.evCount; k++)
			fn(this.events[(this.evHead + k) % EVENT_CAP] as SimEvent);
		this.evHead = 0;
		this.evCount = 0;
	}

	/** Advances one fixed tick. No-op once the run has ended. */
	step(): void {
		if (this.status !== "running") return;
		const w = this.world;
		this.views.refresh();
		const sc = this.views.scratch;
		const bx = this.ballX();
		const by = this.ballY();
		w.linearVelocity(this.ballId);
		const bvx = sc[VEL] as number;
		const bvy = sc[VEL + 1] as number;

		// Springs: a ball resting on or falling onto the pad is launched.
		for (const s of this.springs) {
			if (s.cooldown > 0) {
				s.cooldown--;
				continue;
			}
			const r = s.role;
			if (r.kind !== "spring") continue;
			if (
				bx >= r.min[0] &&
				bx <= r.max[0] &&
				by >= r.min[1] &&
				by <= r.max[1] &&
				bvy <= 0.6
			) {
				const m = this.ballMass;
				w.applyImpulse(
					this.ballId,
					m * (r.launch[0] - bvx),
					m * (r.launch[1] - bvy),
					0,
				);
				s.cooldown = SPRING_COOLDOWN;
				this.emit("spring", bx, r.min[1], r.launch[1]);
			}
		}
		// Fans: a steady push while the ball is in the stream.
		for (let i = 0; i < this.fans.length; i++) {
			const r = (this.fans[i] as Tracked).role;
			if (r.kind !== "fan") continue;
			const inside =
				bx >= r.min[0] && bx <= r.max[0] && by >= r.min[1] && by <= r.max[1];
			if (inside) {
				const m = this.ballMass;
				w.applyImpulse(
					this.ballId,
					m * r.accel[0] * DT,
					m * r.accel[1] * DT,
					0,
				);
				if (!this.fanHits[i]) this.emit("fan", bx, by, 1);
			}
			this.fanHits[i] = inside;
		}

		w.step(1);
		this.tick++;
		this.views.refresh();

		// Impacts (sound cues): sudden velocity changes of the ball and moving parts.
		w.linearVelocity(this.ballId);
		const nvx = sc[VEL] as number;
		const nvy = sc[VEL + 1] as number;
		const nbx = this.ballX();
		const nby = this.ballY();
		const dvx = nvx - bvx;
		// Gravity alone changes vy by -g*dt each tick.
		const dvy = nvy - bvy + this.gravity * DT;
		const dv = Math.hypot(dvx, dvy);
		if (dv > IMPACT_DV) this.emit("impact", nbx, nby, dv);
		let fastest = Math.hypot(nvx, nvy);
		for (const b of this.bodies) {
			w.linearVelocity(b.id);
			const vx = sc[VEL] as number;
			const vy = sc[VEL + 1] as number;
			const sp = Math.hypot(vx, vy);
			if (sp > fastest) fastest = sp;
			const d = Math.hypot(vx - b.vx, vy - b.vy + this.gravity * DT);
			const px = this.views.curr[b.slot * 8] as number;
			const py = this.views.curr[b.slot * 8 + 1] as number;
			if (b.role.kind === "domino" && !b.knocked && Math.hypot(vx, vy) > 0.3) {
				b.knocked = true;
				this.emit("domino", px, py, Math.hypot(vx, vy));
			} else if (d > IMPACT_DV * 1.5) this.emit("impact", px, py, d * 0.6);
			b.vx = vx;
			b.vy = vy;
		}

		// Goal, failure.
		const g = this.goal;
		if (
			nbx >= g.min[0] &&
			nbx <= g.max[0] &&
			nby >= g.min[1] &&
			nby <= g.max[1]
		) {
			if (this.inGoal === 0) this.emit("goal", nbx, nby, 1);
			this.inGoal++;
			if (this.inGoal >= GOAL_HOLD_TICKS) {
				this.status = "solved";
				this.emit("solved", nbx, nby, 1);
				return;
			}
		} else this.inGoal = 0;
		// "stopped": the whole machine (ball, marbles, moving parts) has come to rest.
		this.still =
			fastest < STILL_SPEED && this.inGoal === 0 ? this.still + 1 : 0;
		const lo = this.level.grid.origin[1] - 2;
		let reason: FailReason = null;
		if (nby < lo) reason = "lost";
		else if (this.still >= STILL_TICKS) reason = "stopped";
		else if (this.tick >= this.level.timeLimit) reason = "timeout";
		if (reason) {
			this.status = "failed";
			this.reason = reason;
			this.emit("failed", nbx, nby, 0);
		}
	}

	/** Steps until the run ends (or `maxTicks`). */
	run(maxTicks = this.level.timeLimit + 1): RunResult {
		while (this.status === "running" && this.tick < maxTicks) {
			this.step();
			this.drain(noop);
		}
		return this.result();
	}

	result(): RunResult {
		return {
			status: this.status,
			reason: this.reason,
			tick: this.tick,
			hash: this.world.stateHash(),
		};
	}

	/** Frees the wasm World. The sim is unusable afterwards. */
	dispose(): void {
		this.world.free();
	}
}

function noop(): void {}

/** The ball's mass: its body's `mass`, else density 1 over its sphere collider (the engine default). */
export function ballMass(scene: Scene): number {
	const raw = scene.entities.find((e) => e.id === "ball");
	if (!raw) return 1;
	const e = mergePrefab(scene, raw);
	if (e.body?.mass !== undefined) return e.body.mass;
	const r = resolveCollider(e);
	if ("error" in r || r.collider.shape !== "sphere") return 1;
	return (4 / 3) * Math.PI * r.collider.radius ** 3;
}
