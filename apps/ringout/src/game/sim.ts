import { buildArena, type TileDef, tileHullPoints } from "./arena.ts";
import {
	COLLAPSE,
	COUNTDOWN_TICKS,
	DT,
	GRAVITY,
	KO_WINDOW,
	LINGER_TICKS,
	MAX_FIGHT_TICKS,
	MAX_PLAYERS,
	ORB,
	RINGS,
	SPIN,
	TICK_HZ,
	TILE,
} from "./constants.ts";
import { EV, Events } from "./events.ts";
import { Fnv32 } from "./hash.ts";
import { BTN, type FrameInput } from "./input.ts";
import type { PhysicsHost, PhysWorld } from "./physics.ts";
import { WorldViews } from "./physics.ts";

export const PHASE = { COUNTDOWN: 0, FIGHT: 1, OVER: 2 } as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];
export const PHASE_NAMES = ["countdown", "fight", "over"] as const;

/** Tile states (0 = standing). */
const FALL = 1;
const GONE = 2;

/** Winner value for a round nobody survived (or the clock ran out). */
export const DRAW = -1;

const SCR_VEL = 12;
const SCR_ANG = 16;

/** Where each slot starts: P1 front-left, P2 front-right, P3 back-right, P4 back-left. */
export function spawnPoint(slot: number): [number, number] {
	const a = (Math.PI * 3) / 4 - (slot * Math.PI) / 2;
	const r = 3.7;
	return [r * Math.cos(a), r * Math.sin(a)];
}

/**
 * One round of Ringout: a Rapier world owned by this object, stepped only by `step()`
 * (rules first, then physics), so a live round, its instant replay and a Node test run the
 * exact same code path. Input is one lockstep frame per tick; nothing else is read.
 */
export class RoundSim {
	readonly seed: number;
	readonly world: PhysWorld;
	readonly views: WorldViews;
	readonly tiles: TileDef[];
	readonly tileIds: Int32Array;
	readonly tileSlots: Int32Array;
	readonly tileState: Uint8Array;
	readonly events = new Events();

	/** Which slots play this round. */
	readonly active: boolean[];
	readonly orbIds = new Int32Array(MAX_PLAYERS).fill(-1);
	readonly orbSlots = new Int32Array(MAX_PLAYERS).fill(-1);
	readonly alive = new Uint8Array(MAX_PLAYERS);
	readonly cooldown = new Int32Array(MAX_PLAYERS);
	/** Stagger ticks left after a hard hit. */
	readonly stun = new Int32Array(MAX_PLAYERS);
	readonly outTick = new Int32Array(MAX_PLAYERS).fill(-1);
	readonly lastHitBy = new Int8Array(MAX_PLAYERS).fill(-1);
	readonly lastHitTick = new Int32Array(MAX_PLAYERS).fill(-100000);
	readonly kos = new Int32Array(MAX_PLAYERS);
	readonly dashes = new Int32Array(MAX_PLAYERS);
	/** Hardest hit landed (closing speed, m/s). */
	readonly bestHit = new Float32Array(MAX_PLAYERS);
	/** Order of elimination (slot indices, first out first). */
	readonly outOrder: number[] = [];
	/** Latest pose and velocities per slot (read after each step). */
	readonly pos = new Float64Array(MAX_PLAYERS * 3);
	readonly vel = new Float64Array(MAX_PLAYERS * 3);
	readonly ang = new Float64Array(MAX_PLAYERS * 3);
	private readonly prevVel = new Float64Array(MAX_PLAYERS * 3);
	private readonly touching = new Uint8Array(MAX_PLAYERS * MAX_PLAYERS);

	phase: Phase = PHASE.COUNTDOWN;
	tick = 0;
	fightTick = 0;
	/** Arena yaw (rad) and spin rate (rad/s). */
	theta = 0;
	omega = 0;
	/** Rings already dropped (0..RINGS). */
	collapsed = 0;
	/** Slot that won, DRAW, or -2 while undecided. */
	winner = -2;
	decidedTick = -1;
	private readonly hasher = new Fnv32();
	/** Running hash of every orb pose and velocity, every tick: the whole history, not just the end. */
	private readonly trail = new Fnv32();

	constructor(host: PhysicsHost, seed: number, active: readonly boolean[]) {
		this.seed = seed >>> 0;
		this.active = active.slice(0, MAX_PLAYERS);
		const w = host.create(this.seed, GRAVITY);
		this.world = w;
		this.tiles = buildArena(this.seed);
		const n = this.tiles.length;
		this.tileIds = new Int32Array(n);
		this.tileSlots = new Int32Array(n);
		this.tileState = new Uint8Array(n);
		const hull = tileHullPoints();
		for (let i = 0; i < n; i++) {
			const t = this.tiles[i] as TileDef;
			const id = w.spawn(
				JSON.stringify({
					position: [t.x, -TILE.height / 2, t.z],
					rotation: [0, 0, 0, 1],
					body: {
						type: "kinematic",
						friction: TILE.friction,
						restitution: TILE.restitution,
						linearDamping: 0,
						angularDamping: 0,
						ccd: false,
						collider: { shape: "convexHull", points: hull },
					},
				}),
			);
			this.tileIds[i] = id;
			this.tileSlots[i] = w.slotOf(id);
		}
		for (let s = 0; s < MAX_PLAYERS; s++) {
			if (!this.active[s]) continue;
			const [x, z] = spawnPoint(s);
			const id = w.spawn(
				JSON.stringify({
					position: [x, ORB.radius + 0.02, z],
					rotation: [0, 0, 0, 1],
					body: {
						type: "dynamic",
						mass: ORB.mass,
						friction: ORB.friction,
						restitution: ORB.restitution,
						linearDamping: ORB.linearDamping,
						angularDamping: ORB.angularDamping,
						ccd: true,
						collider: { shape: "sphere", radius: ORB.radius },
					},
				}),
			);
			this.orbIds[s] = id;
			this.orbSlots[s] = w.slotOf(id);
			this.alive[s] = 1;
		}
		this.views = new WorldViews(w, host.memory);
		this.readState();
	}

	free(): void {
		this.world.free();
	}

	aliveCount(): number {
		let c = 0;
		for (let s = 0; s < MAX_PLAYERS; s++) c += this.alive[s] as number;
		return c;
	}

	/** Seconds of fight elapsed (the HUD clock). */
	clock(): number {
		return this.fightTick / TICK_HZ;
	}

	/** One tick: apply the frame, move the kinematic arena, step physics, then judge. */
	step(frame: FrameInput): void {
		this.events.clear();
		if (this.phase === PHASE.OVER) return;
		// live orbs keep control through the post-decision linger (inputs are logged either way)
		if (this.phase === PHASE.FIGHT) this.drive(frame);
		if (this.phase === PHASE.FIGHT) this.moveArena();
		this.prevVel.set(this.vel);
		this.world.step(1);
		this.tick++;
		if (this.phase === PHASE.FIGHT) this.fightTick++;
		this.readState();
		this.judge();
	}

	private drive(frame: FrameInput): void {
		const w = this.world;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			if (!this.alive[s]) continue;
			const p = frame[s];
			const id = this.orbIds[s] as number;
			if (this.cooldown[s] as number)
				this.cooldown[s] = (this.cooldown[s] as number) - 1;
			const stunned = (this.stun[s] as number) > 0;
			if (stunned) this.stun[s] = (this.stun[s] as number) - 1;
			if (!p) continue;
			const dx = p.x / 127;
			const dz = p.z / 127;
			const mag = Math.hypot(dx, dz);
			if (mag < 0.02) continue;
			const ux = dx / mag;
			const uz = dz / mag;
			const py = this.pos[s * 3 + 1] as number;
			const grounded = py < ORB.radius + 0.15 && py > -0.4;
			const k =
				(grounded ? 1 : ORB.airControl) * (stunned ? ORB.stunControl : 1);
			const along =
				(this.vel[s * 3] as number) * ux + (this.vel[s * 3 + 2] as number) * uz;
			if (along < ORB.vmax) {
				w.applyImpulse(id, dx * ORB.push * k, 0, dz * ORB.push * k);
				// rolling axis for travel along (dx, dz) is (dz, 0, -dx)
				w.applyTorqueImpulse(id, dz * ORB.torque * k, 0, -dx * ORB.torque * k);
			}
			if (
				p.buttons & BTN.DASH &&
				this.cooldown[s] === 0 &&
				mag > 0.25 &&
				grounded &&
				!stunned
			) {
				w.applyImpulse(id, ux * ORB.dash, 0, uz * ORB.dash);
				w.applyTorqueImpulse(
					id,
					uz * ORB.dash * 0.05,
					0,
					-ux * ORB.dash * 0.05,
				);
				this.cooldown[s] = ORB.dashCooldown;
				this.dashes[s] = (this.dashes[s] as number) + 1;
				this.events.push(EV.DASH, s, 0, 0, ux, uz);
			}
		}
	}

	/** Kinematic arena: spin, warnings, drops. Poses are targets for this tick's step. */
	private moveArena(): void {
		const ft = this.fightTick;
		// rings collapsed so far drive the spin target
		let collapsed = 0;
		for (let r = RINGS - 1; r >= 0; r--) {
			if (ft >= COLLAPSE.first + COLLAPSE.every * (RINGS - 1 - r)) collapsed++;
		}
		if (collapsed > this.collapsed) {
			this.collapsed = collapsed;
			this.events.push(EV.DROP, RINGS - collapsed);
		}
		const warnRing =
			RINGS -
			1 -
			Math.floor((ft + COLLAPSE.warn - COLLAPSE.first) / COLLAPSE.every);
		if (
			ft + COLLAPSE.warn >= COLLAPSE.first &&
			(ft + COLLAPSE.warn - COLLAPSE.first) % COLLAPSE.every === 0 &&
			warnRing >= 0
		)
			this.events.push(EV.WARN, warnRing);
		const target = SPIN.base + SPIN.perRing * this.collapsed;
		if (this.omega < target)
			this.omega = Math.min(target, this.omega + SPIN.ramp);
		this.theta += this.omega * DT;
		const cy = Math.cos(this.theta / 2);
		const sy = Math.sin(this.theta / 2);
		const ct = Math.cos(this.theta);
		const st = Math.sin(this.theta);
		const w = this.world;
		const h = TILE.height / 2;
		for (let i = 0; i < this.tiles.length; i++) {
			const state = this.tileState[i];
			if (state === GONE) continue;
			const t = this.tiles[i] as TileDef;
			let dy = -h;
			let bx = 0;
			let bz = 0;
			let bw = 1;
			if (ft >= t.dropTick) {
				const f = ft - t.dropTick;
				if (f >= COLLAPSE.fallTicks) {
					w.despawn(this.tileIds[i] as number);
					this.tileState[i] = GONE;
					this.tileSlots[i] = -1;
					continue;
				}
				this.tileState[i] = FALL;
				dy -= 0.0026 * f * f;
				const half = (t.tumble * f) / 2;
				const s = Math.sin(half);
				bx = t.ax * s;
				bz = t.az * s;
				bw = Math.cos(half);
			} else if (ft >= t.warnTick) {
				const k = (ft - t.warnTick) / COLLAPSE.warn;
				dy += COLLAPSE.shake * k * Math.sin(ft * 0.9 + t.phase);
			}
			const x = t.x * ct + t.z * st;
			const z = -t.x * st + t.z * ct;
			// q = yaw(theta) * tilt(axis, angle), both written out
			w.setKinematicPose(
				this.tileIds[i] as number,
				x,
				dy,
				z,
				cy * bx + sy * bz,
				sy * bw,
				cy * bz - sy * bx,
				cy * bw,
			);
		}
	}

	private readState(): void {
		const v = this.views;
		v.refresh();
		const w = this.world;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			if (!this.alive[s]) continue;
			const slot = this.orbSlots[s] as number;
			const o = s * 3;
			this.pos[o] = v.curr[slot * 8] as number;
			this.pos[o + 1] = v.curr[slot * 8 + 1] as number;
			this.pos[o + 2] = v.curr[slot * 8 + 2] as number;
			const id = this.orbIds[s] as number;
			if (w.linearVelocity(id)) {
				this.vel[o] = v.scratch[SCR_VEL] as number;
				this.vel[o + 1] = v.scratch[SCR_VEL + 1] as number;
				this.vel[o + 2] = v.scratch[SCR_VEL + 2] as number;
			}
			if (w.angularVelocity(id)) {
				this.ang[o] = v.scratch[SCR_ANG] as number;
				this.ang[o + 1] = v.scratch[SCR_ANG + 1] as number;
				this.ang[o + 2] = v.scratch[SCR_ANG + 2] as number;
			}
			this.trail
				.float(this.pos[o] as number)
				.float(this.pos[o + 1] as number)
				.float(this.pos[o + 2] as number)
				.float(this.vel[o] as number)
				.float(this.vel[o + 2] as number);
		}
	}

	private judge(): void {
		const R2 = 2 * ORB.radius + 0.06;
		// impacts: a pair that starts touching this tick
		for (let i = 0; i < MAX_PLAYERS; i++) {
			for (let j = i + 1; j < MAX_PLAYERS; j++) {
				const key = i * MAX_PLAYERS + j;
				if (!this.alive[i] || !this.alive[j]) {
					this.touching[key] = 0;
					continue;
				}
				const nx = (this.pos[j * 3] as number) - (this.pos[i * 3] as number);
				const ny =
					(this.pos[j * 3 + 1] as number) - (this.pos[i * 3 + 1] as number);
				const nz =
					(this.pos[j * 3 + 2] as number) - (this.pos[i * 3 + 2] as number);
				const d = Math.hypot(nx, ny, nz);
				const touch = d < R2 ? 1 : 0;
				if (touch && !this.touching[key] && d > 1e-6) {
					// closing speeds of each orb along the line of centres, before the hit
					const vi =
						((this.prevVel[i * 3] as number) * nx +
							(this.prevVel[i * 3 + 1] as number) * ny +
							(this.prevVel[i * 3 + 2] as number) * nz) /
						d;
					const vj =
						-(
							(this.prevVel[j * 3] as number) * nx +
							(this.prevVel[j * 3 + 1] as number) * ny +
							(this.prevVel[j * 3 + 2] as number) * nz
						) / d;
					const closing = vi + vj;
					if (closing > 0.4) {
						this.lastHitBy[i] = j;
						this.lastHitBy[j] = i;
						this.lastHitTick[i] = this.tick;
						this.lastHitTick[j] = this.tick;
						// the orb that brought more speed is the hitter
						const hitter = vi >= vj ? i : j;
						const victim = hitter === i ? j : i;
						const st = Math.min(
							ORB.stunMax,
							Math.round(closing * ORB.stunPerSpeed),
						);
						if (Math.abs(vi - vj) < 1.5) {
							// a head-on clash staggers both orbs a little
							const half = st >> 2;
							if (half > (this.stun[i] as number)) this.stun[i] = half;
							if (half > (this.stun[j] as number)) this.stun[j] = half;
						} else if (st > (this.stun[victim] as number))
							this.stun[victim] = st;
						if (closing > (this.bestHit[hitter] as number))
							this.bestHit[hitter] = closing;
						this.events.push(
							EV.IMPACT,
							hitter,
							victim,
							closing,
							(this.pos[i * 3] as number) + nx * 0.5,
							(this.pos[i * 3 + 2] as number) + nz * 0.5,
						);
					}
				}
				this.touching[key] = touch;
			}
		}
		// ring-outs
		for (let s = 0; s < MAX_PLAYERS; s++) {
			if (!this.alive[s]) continue;
			const x = this.pos[s * 3] as number;
			const y = this.pos[s * 3 + 1] as number;
			const z = this.pos[s * 3 + 2] as number;
			if (y > ORB.outY && Math.abs(x) < 40 && Math.abs(z) < 40) continue;
			this.alive[s] = 0;
			this.outTick[s] = this.tick;
			this.outOrder.push(s);
			const by =
				this.tick - (this.lastHitTick[s] as number) <= KO_WINDOW
					? (this.lastHitBy[s] as number)
					: -1;
			if (by >= 0) this.kos[by] = (this.kos[by] as number) + 1;
			this.world.despawn(this.orbIds[s] as number);
			this.orbSlots[s] = -1;
			this.events.push(EV.RINGOUT, s, by, 0, x, z);
		}
		// phases
		if (this.phase === PHASE.COUNTDOWN) {
			// a beep for 3 (first tick), 2 and 1
			if (
				this.tick === 1 ||
				(this.tick % TICK_HZ === 0 && this.tick < COUNTDOWN_TICKS)
			)
				this.events.push(
					EV.COUNT,
					Math.ceil((COUNTDOWN_TICKS - this.tick) / TICK_HZ),
				);
			if (this.tick >= COUNTDOWN_TICKS) {
				this.phase = PHASE.FIGHT;
				this.events.push(EV.GO);
			}
			return;
		}
		if (this.winner === -2) {
			const n = this.aliveCount();
			if (n <= 1 || this.fightTick >= MAX_FIGHT_TICKS) {
				let win = DRAW;
				if (n === 1)
					for (let s = 0; s < MAX_PLAYERS; s++) if (this.alive[s]) win = s;
				this.winner = win;
				this.decidedTick = this.tick;
				this.events.push(EV.DECIDED, win);
			}
		} else if (this.tick - this.decidedTick >= LINGER_TICKS) {
			this.phase = PHASE.OVER;
			this.events.push(EV.OVER);
		}
	}

	/** World hash plus every rule variable: equal hashes mean an identical round. */
	hash(): string {
		const h = this.hasher.reset();
		h.word(this.tick)
			.word(this.fightTick)
			.word(this.phase)
			.word(this.collapsed);
		h.float(this.theta)
			.float(this.omega)
			.word(this.winner + 8)
			.word(this.trail.h);
		for (let s = 0; s < MAX_PLAYERS; s++) {
			h.word(this.alive[s] as number)
				.word(this.cooldown[s] as number)
				.word(this.stun[s] as number)
				.word(this.kos[s] as number)
				.word(this.dashes[s] as number)
				.word(this.outTick[s] as number);
		}
		return `${this.world.stateHash()}${h.hex()}`;
	}

	/** Current flat radius of the standing arena at the drop schedule (m). */
	standingRings(): number {
		return RINGS - this.collapsed;
	}
}
