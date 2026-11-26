import {
	COUNTDOWN_TICKS,
	DT,
	FINISH_COAST_TICKS,
	MARBLE_MASS,
	MARBLE_RADIUS,
	MAX_RUN_TICKS,
	RESPAWN_FREEZE,
	TICK_HZ,
} from "./constants.ts";
import type { CourseFile } from "./course.ts";
import { EV, EventQueue } from "./events.ts";
import { Fnv32 } from "./hash.ts";
import { BTN, type TickInput } from "./input.ts";
import { type PhysicsHost, type PhysWorld, WorldViews } from "./physics.ts";
import { Rng } from "./rng.ts";
import type { Track } from "./track.ts";

export const PHASE = { COUNTDOWN: 0, RUN: 1, FINISHED: 2, DONE: 3 } as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];
export const PHASE_NAMES = ["countdown", "run", "finished", "done"] as const;

/** Tunables (m, s, m/s^2). */
export const TUNE = {
	gravity: -16,
	/** Max tilt of the board: the steering force is g * sin(tilt). */
	tiltDeg: 17,
	/** Air control as a fraction of ground tilt force. */
	airControl: 0.45,
	/** Spin torque per unit of tilt (keeps the roll consistent with steering). */
	spin: 0.35,
	/** Quadratic drag coefficient (1/m). */
	drag: 0.0022,
	jumpSpeed: 6.2,
	jumpCooldown: 24,
	brake: 2.4,
	boostKick: 9,
	boostMin: 30,
	deckFriction: 0.9,
	marbleFriction: 0.9,
	restitution: 0.12,
	/** Sweeper bar half-thickness (m). */
	sweeperThick: 0.28,
} as const;

const RAY_EXCLUDE = 2;
const GROUND_PROBE = MARBLE_RADIUS + 0.22;
/** Below the deck by this much (along its up) = fallen. */
const FALL_DEPTH = 5;

interface Sweeper {
	id: number;
	/** Pivot. */
	cx: number;
	cy: number;
	cz: number;
	/** Track frame at the pivot (for the rotation about local up). */
	sample: number;
	speed: number;
	phase: number;
}

/** Quaternion helpers (xyzw), allocation-free into `out`. */
function quatFromBasis(
	rx: number,
	ry: number,
	rz: number,
	ux: number,
	uy: number,
	uz: number,
	fx: number,
	fy: number,
	fz: number,
	out: Float64Array,
): void {
	// columns: X = r, Y = u, Z = f (right-handed: r x u = -f? we pass f = r x u)
	const m00 = rx,
		m01 = ux,
		m02 = fx;
	const m10 = ry,
		m11 = uy,
		m12 = fy;
	const m20 = rz,
		m21 = uz,
		m22 = fz;
	const tr = m00 + m11 + m22;
	if (tr > 0) {
		const s = Math.sqrt(tr + 1) * 2;
		out[3] = 0.25 * s;
		out[0] = (m21 - m12) / s;
		out[1] = (m02 - m20) / s;
		out[2] = (m10 - m01) / s;
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		out[3] = (m21 - m12) / s;
		out[0] = 0.25 * s;
		out[1] = (m01 + m10) / s;
		out[2] = (m02 + m20) / s;
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		out[3] = (m02 - m20) / s;
		out[0] = (m01 + m10) / s;
		out[1] = 0.25 * s;
		out[2] = (m12 + m21) / s;
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
		out[3] = (m10 - m01) / s;
		out[0] = (m02 + m20) / s;
		out[1] = (m12 + m21) / s;
		out[2] = 0.25 * s;
	}
}

/**
 * One marble run on one course: its own Rapier world (deterministic build), the course's
 * trimesh pieces, the marble and any sweepers. `step(input)` is the whole game rule set, so
 * a run is fully defined by (course, seed, input log): a ghost is just a second MarbleSim fed
 * the logged inputs.
 */
export class MarbleSim {
	readonly world: PhysWorld;
	readonly views: WorldViews;
	readonly events = new EventQueue();
	readonly seed: number;
	readonly marbleId: number;
	readonly marbleSlot: number;
	readonly sweepers: Sweeper[] = [];
	readonly gravity: number;

	phase: Phase = PHASE.COUNTDOWN;
	/** Ticks stepped (including the countdown). */
	tick = 0;
	/** Ticks since GO (the clock). */
	runTick = 0;
	/** Nearest centerline sample. */
	progress = 2;
	/** Next checkpoint to cross (index into track.checkpoints). */
	cpNext = 0;
	/** Split times (s, sub-tick) at each checkpoint, then the finish. */
	readonly splits: number[] = [];
	finishTime = -1;
	respawns = 0;
	freeze = 0;
	grounded = false;
	airTicks = 0;
	jumpCd = 0;
	coast = 0;
	/** Ground normal (when grounded). */
	nx = 0;
	ny = 1;
	nz = 0;
	/** Latest velocity and position (read after each step). */
	readonly vel = new Float64Array(6);
	readonly pos = new Float64Array(3);
	readonly prevPos = new Float64Array(3);
	/** Lateral offset from the centerline and height above it (m). */
	lateral = 0;
	above = 0;
	readonly boostUsed: Uint8Array;
	private readonly q = new Float64Array(4);
	private readonly hasher = new Fnv32();
	private lastVy = 0;

	readonly course: CourseFile;
	readonly track: Track;

	constructor(
		host: PhysicsHost,
		course: CourseFile,
		track: Track,
		seed: number,
	) {
		this.course = course;
		this.track = track;
		this.seed = seed >>> 0;
		this.gravity = course.physics?.gravity ?? TUNE.gravity;
		this.boostUsed = new Uint8Array(track.boosts.length);
		const w = host.create(this.seed, this.gravity);
		this.world = w;
		for (const c of track.colliders()) {
			w.spawn(
				JSON.stringify({
					position: [0, 0, 0],
					rotation: [0, 0, 0, 1],
					body: {
						type: "static",
						friction: TUNE.deckFriction,
						restitution: TUNE.restitution,
						linearDamping: 0,
						angularDamping: 0,
						ccd: false,
						collider: { shape: "trimesh", fixInternalEdges: true, ...c },
					},
				}),
			);
		}
		const rng = new Rng(this.seed ^ 0x5eed);
		for (const sw of track.sweepers) {
			const i = sw.i;
			const lift = MARBLE_RADIUS + 0.05;
			const cx = (track.px[i] as number) + (track.ux[i] as number) * lift;
			const cy = (track.py[i] as number) + (track.uy[i] as number) * lift;
			const cz = (track.pz[i] as number) + (track.uz[i] as number) * lift;
			// central post: static, full wall height
			w.spawn(
				JSON.stringify({
					position: [cx, cy, cz],
					rotation: [0, 0, 0, 1],
					body: {
						type: "static",
						friction: 0.4,
						restitution: 0.3,
						linearDamping: 0,
						angularDamping: 0,
						ccd: false,
						collider: { shape: "box", halfExtents: [0.32, 0.9, 0.32] },
					},
				}),
			);
			const phase0 = rng.range(0, Math.PI * 2);
			for (let k = 0; k < sw.count; k++) {
				const id = w.spawn(
					JSON.stringify({
						position: [cx, cy, cz],
						rotation: [0, 0, 0, 1],
						body: {
							type: "kinematic",
							friction: 0.3,
							restitution: 0.5,
							linearDamping: 0,
							angularDamping: 0,
							ccd: false,
							collider: {
								shape: "box",
								halfExtents: [sw.arm, TUNE.sweeperThick, TUNE.sweeperThick],
							},
						},
					}),
				);
				this.sweepers.push({
					id,
					cx,
					cy,
					cz,
					sample: i,
					speed: sw.speed,
					phase: phase0 + (k * Math.PI) / sw.count,
				});
			}
		}
		const s = 2;
		const sp = this.spawnPoint(s);
		this.marbleId = w.spawn(
			JSON.stringify({
				position: sp,
				rotation: [0, 0, 0, 1],
				body: {
					type: "dynamic",
					mass: MARBLE_MASS,
					friction: TUNE.marbleFriction,
					restitution: TUNE.restitution,
					linearDamping: 0,
					angularDamping: 0.05,
					ccd: true,
					collider: { shape: "sphere", radius: MARBLE_RADIUS },
				},
			}),
		);
		this.marbleSlot = w.slotOf(this.marbleId);
		this.views = new WorldViews(w, host.memory);
		this.posSweepers(0);
		this.readState();
		this.prevPos.set(this.pos);
	}

	free(): void {
		this.world.free();
	}

	private spawnPoint(i: number): [number, number, number] {
		const t = this.track;
		const lift = MARBLE_RADIUS + 0.02;
		return [
			(t.px[i] as number) + (t.ux[i] as number) * lift,
			(t.py[i] as number) + (t.uy[i] as number) * lift,
			(t.pz[i] as number) + (t.uz[i] as number) * lift,
		];
	}

	/** Sweeper rotation at sim time `t` (s), about the deck's local up. */
	private posSweepers(t: number): void {
		const tr = this.track;
		const q = this.q;
		for (const s of this.sweepers) {
			const i = s.sample;
			const a = s.phase + s.speed * t;
			const ca = Math.cos(a);
			const sa = Math.sin(a);
			const rx = tr.rx[i] as number;
			const ry = tr.ry[i] as number;
			const rz = tr.rz[i] as number;
			const tx = tr.tx[i] as number;
			const ty = tr.ty[i] as number;
			const tz = tr.tz[i] as number;
			// bar axis X' = r cos a + t sin a; Y' = u; Z' = X' x Y'
			const ax = rx * ca + tx * sa;
			const ay = ry * ca + ty * sa;
			const az = rz * ca + tz * sa;
			const ux = tr.ux[i] as number;
			const uy = tr.uy[i] as number;
			const uz = tr.uz[i] as number;
			const fx = ay * uz - az * uy;
			const fy = az * ux - ax * uz;
			const fz = ax * uy - ay * ux;
			quatFromBasis(ax, ay, az, ux, uy, uz, fx, fy, fz, q);
			this.world.setKinematicPose(
				s.id,
				s.cx,
				s.cy,
				s.cz,
				q[0] as number,
				q[1] as number,
				q[2] as number,
				q[3] as number,
			);
		}
	}

	private readState(): void {
		this.views.refresh();
		const c = this.views.curr;
		const o = this.marbleSlot * 8;
		this.pos[0] = c[o] as number;
		this.pos[1] = c[o + 1] as number;
		this.pos[2] = c[o + 2] as number;
		const w = this.world;
		if (w.linearVelocity(this.marbleId) && w.angularVelocity(this.marbleId)) {
			this.views.refresh();
			const sc = this.views.scratch;
			for (let k = 0; k < 3; k++) {
				this.vel[k] = sc[12 + k] as number;
				this.vel[3 + k] = sc[16 + k] as number;
			}
		}
	}

	speed(): number {
		const x = this.vel[0] as number;
		const y = this.vel[1] as number;
		const z = this.vel[2] as number;
		return Math.sqrt(x * x + y * y + z * z);
	}

	/** Seconds on the clock (sub-tick exact once finished). */
	clock(): number {
		return this.finishTime >= 0 ? this.finishTime : this.runTick / TICK_HZ;
	}

	private probeGround(): void {
		const t = this.track;
		const i = this.progress;
		// probe toward the deck (track down), falling back to world down in the air
		let dx = -(t.ux[i] as number);
		let dy = -(t.uy[i] as number);
		let dz = -(t.uz[i] as number);
		if (this.above > 3) {
			dx = 0;
			dy = -1;
			dz = 0;
		}
		const p = this.pos;
		const hit = this.world.raycast(
			p[0] as number,
			p[1] as number,
			p[2] as number,
			dx,
			dy,
			dz,
			GROUND_PROBE,
			RAY_EXCLUDE,
			this.marbleId,
		);
		if (hit) {
			this.views.refresh();
			const sc = this.views.scratch;
			this.nx = sc[1] as number;
			this.ny = sc[2] as number;
			this.nz = sc[3] as number;
		}
		this.grounded = hit;
	}

	private updateTrackSpace(): void {
		const t = this.track;
		const p = this.pos;
		const i = t.nearest(
			p[0] as number,
			p[1] as number,
			p[2] as number,
			this.progress,
		);
		this.progress = i;
		const dx = (p[0] as number) - (t.px[i] as number);
		const dy = (p[1] as number) - (t.py[i] as number);
		const dz = (p[2] as number) - (t.pz[i] as number);
		this.lateral =
			dx * (t.rx[i] as number) +
			dy * (t.ry[i] as number) +
			dz * (t.rz[i] as number);
		this.above =
			dx * (t.ux[i] as number) +
			dy * (t.uy[i] as number) +
			dz * (t.uz[i] as number);
	}

	/**
	 * Signed distances of the previous and current marble position past the gate plane at
	 * sample `i` (normal = tangent). Returns the crossing fraction of this tick in [0, 1], or
	 * -1 when the marble has not reached the plane yet. Splits are sub-tick exact.
	 */
	private crossing(i: number): number {
		const t = this.track;
		const tx = t.tx[i] as number;
		const ty = t.ty[i] as number;
		const tz = t.tz[i] as number;
		const d0 =
			((this.prevPos[0] as number) - (t.px[i] as number)) * tx +
			((this.prevPos[1] as number) - (t.py[i] as number)) * ty +
			((this.prevPos[2] as number) - (t.pz[i] as number)) * tz;
		const d1 =
			((this.pos[0] as number) - (t.px[i] as number)) * tx +
			((this.pos[1] as number) - (t.py[i] as number)) * ty +
			((this.pos[2] as number) - (t.pz[i] as number)) * tz;
		if (d1 < 0) return -1;
		if (d0 >= 0) return 0;
		return -d0 / (d1 - d0);
	}

	private respawn(): void {
		const t = this.track;
		const i =
			this.cpNext > 0 ? (t.checkpoints[this.cpNext - 1] as number) + 2 : 2;
		const sp = this.spawnPoint(i);
		this.world.teleport(this.marbleId, sp[0], sp[1], sp[2]);
		this.progress = i;
		this.freeze = RESPAWN_FREEZE;
		this.respawns++;
		for (let k = 0; k < t.boosts.length; k++)
			if ((t.boosts[k] as { i0: number }).i0 >= i) this.boostUsed[k] = 0;
		this.events.push(EV.RESPAWN);
	}

	step(input: TickInput): void {
		this.events.clear();
		this.tick++;
		if (this.phase === PHASE.DONE) return;
		if (this.phase === PHASE.COUNTDOWN) {
			const left = COUNTDOWN_TICKS - this.tick;
			if (left > 0 && left % TICK_HZ === 0)
				this.events.push(EV.COUNT, left / TICK_HZ);
			if (left <= 0) {
				this.phase = PHASE.RUN;
				this.events.push(EV.GO);
			}
			return;
		}
		const running = this.phase === PHASE.RUN;
		if (running) this.runTick++;
		const tsec = (this.tick - COUNTDOWN_TICKS) * DT;
		this.posSweepers(tsec);
		this.probeGround();

		const m = MARBLE_MASS;
		const v = this.vel;
		const vx = v[0] as number;
		const vy = v[1] as number;
		const vz = v[2] as number;
		let ix = 0;
		let iy = 0;
		let iz = 0;
		let tqx = 0;
		let tqy = 0;
		let tqz = 0;
		if (this.freeze > 0) {
			this.freeze--;
			this.world.setVelocity(this.marbleId, 0, 0, 0, 0, 0, 0);
		} else if (running) {
			// Tilt: the board leans toward the stick; on the ground the push follows the deck.
			const sx = input.x / 127;
			const sz = input.z / 127;
			const g = -this.gravity;
			const tilt = g * Math.sin((TUNE.tiltDeg * Math.PI) / 180);
			if (sx !== 0 || sz !== 0) {
				let dx = sx;
				let dy = 0;
				let dz = sz;
				let k = tilt * DT * m;
				if (this.grounded) {
					const dn = dx * this.nx + dz * this.nz;
					dx -= this.nx * dn;
					dy -= this.ny * dn;
					dz -= this.nz * dn;
					// spin about (n x d): rolls the marble the way it is pushed
					const s = TUNE.spin * DT;
					tqx = (this.ny * dz - this.nz * dy) * s;
					tqy = (this.nz * dx - this.nx * dz) * s;
					tqz = (this.nx * dy - this.ny * dx) * s;
				} else k *= TUNE.airControl;
				ix += dx * k;
				iy += dy * k;
				iz += dz * k;
			}
			if ((input.buttons & BTN.BRAKE) !== 0 && this.grounded) {
				const k = TUNE.brake * DT * m;
				const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
				if (sp > 0.5) {
					ix -= (vx / sp) * k;
					iy -= (vy / sp) * k;
					iz -= (vz / sp) * k;
				}
			}
			if (this.jumpCd > 0) this.jumpCd--;
			else if ((input.buttons & BTN.JUMP) !== 0 && this.grounded) {
				const k = TUNE.jumpSpeed * m;
				ix += this.nx * k;
				iy += this.ny * k;
				iz += this.nz * k;
				this.jumpCd = TUNE.jumpCooldown;
				this.events.push(EV.JUMP);
			}
			// boost pads: a one-shot kick along the track
			const t = this.track;
			for (let b = 0; b < t.boosts.length; b++) {
				const pad = t.boosts[b] as { i0: number; i1: number; half: number };
				if (
					this.boostUsed[b] === 0 &&
					this.progress >= pad.i0 &&
					this.progress <= pad.i1 &&
					Math.abs(this.lateral) < pad.half + MARBLE_RADIUS &&
					this.above < 1.5
				) {
					const i = this.progress;
					const ttx = t.tx[i] as number;
					const tty = t.ty[i] as number;
					const ttz = t.tz[i] as number;
					const vt = vx * ttx + vy * tty + vz * ttz;
					const target = Math.max(vt + TUNE.boostKick, TUNE.boostMin);
					const dv = target - vt;
					ix += ttx * dv * m;
					iy += tty * dv * m;
					iz += ttz * dv * m;
					this.boostUsed[b] = 1;
					this.events.push(EV.BOOST, b);
				}
			}
		} else {
			// finished: coast down
			const k = 3 * DT * m;
			ix -= vx * k * 0.6;
			iy -= vy * k * 0.2;
			iz -= vz * k * 0.6;
		}
		// quadratic air drag
		const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
		const kd = TUNE.drag * sp * DT * m;
		ix -= vx * kd;
		iy -= vy * kd;
		iz -= vz * kd;
		if (this.freeze === 0) {
			this.world.applyImpulse(this.marbleId, ix, iy, iz);
			this.world.applyTorqueImpulse(this.marbleId, tqx, tqy, tqz);
		}

		this.prevPos.set(this.pos);
		this.lastVy = vy;
		this.world.step(1);
		this.readState();
		this.updateTrackSpace();

		// landing
		const wasAir = this.airTicks;
		this.probeGround();
		if (this.grounded) {
			if (wasAir > 10) {
				const impact = Math.abs(
					this.lastVy * this.ny, // approx normal speed at touchdown
				);
				this.events.push(EV.LAND, 0, impact);
			}
			this.airTicks = 0;
		} else this.airTicks++;

		const t = this.track;
		if (running) {
			// checkpoints and finish: sub-tick crossing time
			const nextCp = t.checkpoints[this.cpNext];
			const gate = nextCp ?? t.finish;
			const f =
				this.progress >= gate - 4 && this.progress < gate + 40
					? this.crossing(gate)
					: -1;
			if (f >= 0 && nextCp !== undefined) {
				const time = (this.runTick - 1 + f) * DT;
				this.splits.push(time);
				this.cpNext++;
				this.events.push(EV.CHECKPOINT, this.cpNext - 1, time);
			} else if (f >= 0) {
				const time = (this.runTick - 1 + f) * DT;
				this.finishTime = time;
				this.splits.push(time);
				this.phase = PHASE.FINISHED;
				this.events.push(EV.FINISH, 0, time);
			} else if (this.runTick >= MAX_RUN_TICKS) {
				this.phase = PHASE.FINISHED;
			}
			const p = this.pos;
			if (
				this.above < -FALL_DEPTH ||
				(p[1] as number) < t.minY - 25 ||
				Math.abs(this.lateral) > (t.width[this.progress] as number) + 12
			)
				this.respawn();
		} else if (this.phase === PHASE.FINISHED) {
			this.coast++;
			if (this.coast >= FINISH_COAST_TICKS) this.phase = PHASE.DONE;
		}
	}

	/** Engine world hash (all body poses) + game-state hash (velocities, clock, splits). */
	hash(): string {
		const h = this.hasher.reset();
		h.word(this.tick).word(this.runTick).word(this.phase).word(this.progress);
		h.word(this.cpNext).word(this.respawns).word(this.freeze).word(this.jumpCd);
		for (let k = 0; k < 6; k++) h.float(this.vel[k] as number);
		h.float(this.finishTime);
		for (const s of this.splits) h.float(s);
		for (let k = 0; k < this.boostUsed.length; k++)
			h.word(this.boostUsed[k] as number);
		return `${this.world.stateHash()}:${h.hex()}`;
	}
}
