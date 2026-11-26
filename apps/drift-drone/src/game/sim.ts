import {
	COUNTDOWN_TICKS,
	DRONE_MASS,
	DRONE_RADIUS,
	DT,
	type FlightMode,
	GRAVITY,
	MAX_RACE_TICKS,
	TUNE,
} from "./constants.ts";
import { EV, EventQueue } from "./events.ts";
import { Fnv32 } from "./hash.ts";
import type { TickInput } from "./input.ts";
import { type PhysicsHost, type PhysWorld, WorldViews } from "./physics.ts";
import {
	type Gate,
	gateBars,
	gatesOf,
	type SiteDef,
	type TrackFile,
	yawQuat,
} from "./track.ts";

export const PHASE = { COUNTDOWN: 0, RACE: 1, FINISHED: 2 } as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];
export const PHASE_NAMES = ["countdown", "race", "finished"] as const;

const VEL = 12;
const ANG = 16;
const INERTIA = 0.4 * DRONE_MASS * DRONE_RADIUS * DRONE_RADIUS;
const MAX_THRUST = TUNE.twr * DRONE_MASS * -GRAVITY;
const PAD_TOP = 0.08;
/** World seed: the sim draws no randomness, so every run and ghost uses the same one. */
export const WORLD_SEED = 1;

function staticBox(
	x: number,
	y: number,
	z: number,
	hx: number,
	hy: number,
	hz: number,
	qy = 0,
	qw = 1,
): string {
	return JSON.stringify({
		position: [x, y, z],
		rotation: [0, qy, 0, qw],
		body: {
			type: "static",
			friction: 0.6,
			restitution: 0.2,
			linearDamping: 0,
			angularDamping: 0,
			ccd: false,
			collider: { shape: "box", halfExtents: [hx, hy, hz] },
		},
	});
}

/**
 * One race on one track: its own Rapier world (deterministic build) holding the site's proxy
 * boxes, the flight-volume walls, the gate frames, the pad and the drone, a dynamic sphere
 * flown purely by impulses: thrust along its up axis and torque impulses from a rate loop that
 * reads `angularVelocity` every tick. `step(input)` is the whole rule set, so a race is fully
 * defined by (track, mode, input log) and a ghost is a second DroneSim fed the logged inputs.
 */
export class DroneSim {
	readonly world: PhysWorld;
	readonly views: WorldViews;
	readonly events = new EventQueue();
	readonly gates: Gate[];
	readonly track: TrackFile;
	readonly mode: FlightMode;
	droneId = -1;
	slot = -1;

	phase: Phase = PHASE.COUNTDOWN;
	/** Ticks stepped, countdown included. */
	tick = 0;
	/** Laps completed, and the lap in progress (-1 before the first start/finish crossing). */
	lap = -1;
	nextGate = 0;
	/** Race-clock time (s, sub-tick) when the current lap started. */
	lapStart = 0;
	/** The tick on which the current lap's start line was crossed. */
	lapStartTick = 0;
	readonly lapTimes: number[] = [];
	/** Ticks at which each completed lap started and ended (ghost records). */
	readonly lapTicks: [number, number][] = [];
	finishTime = -1;
	crashes = 0;
	/** Ticks left of the crash blackout, then of the auto-hover after a respawn. */
	freeze = 0;
	hover = 0;
	/** Last gate flown through (respawn point), -1 = the pad. */
	lastGate = -1;
	flipped = 0;
	/** Latest state (after each step). */
	readonly pos = new Float64Array(3);
	readonly prevPos = new Float64Array(3);
	readonly vel = new Float64Array(3);
	readonly ang = new Float64Array(3);
	readonly quat = new Float64Array([0, 0, 0, 1]);
	readonly up = new Float64Array([0, 1, 0]);
	readonly right = new Float64Array([1, 0, 0]);
	readonly fwd = new Float64Array([0, 0, -1]);
	/** Horizontal heading (unit) and its right-hand axis. */
	hfx = 0;
	hfz = -1;
	/** Thrust as a fraction of max (presentation: motor pitch, prop blur). */
	thrust = 0;
	/** Last tick's unexplained velocity change (m/s). */
	impact = 0;
	private readonly predV = new Float64Array(3);
	private readonly hasher = new Fnv32();

	constructor(
		host: PhysicsHost,
		track: TrackFile,
		site: SiteDef,
		mode: FlightMode,
	) {
		this.track = track;
		this.mode = mode;
		this.gates = gatesOf(track);
		const w = host.create(WORLD_SEED, GRAVITY);
		this.world = w;
		// floor, flight-volume walls and ceiling
		w.spawn(staticBox(3, -0.5, 9, 40, 0.5, 40));
		const { min, max } = site.bounds;
		const cx = (min[0] + max[0]) / 2;
		const cz = (min[2] + max[2]) / 2;
		const hx = (max[0] - min[0]) / 2;
		const hz = (max[2] - min[2]) / 2;
		const H = max[1];
		w.spawn(staticBox(min[0] - 0.5, H / 2, cz, 0.5, H / 2 + 1, hz + 1));
		w.spawn(staticBox(max[0] + 0.5, H / 2, cz, 0.5, H / 2 + 1, hz + 1));
		w.spawn(staticBox(cx, H / 2, min[2] - 0.5, hx + 1, H / 2 + 1, 0.5));
		w.spawn(staticBox(cx, H / 2, max[2] + 0.5, hx + 1, H / 2 + 1, 0.5));
		w.spawn(staticBox(cx, H + 0.5, cz, hx + 1, 0.5, hz + 1));
		for (const b of site.proxies)
			w.spawn(staticBox(b.c[0], b.c[1], b.c[2], b.h[0], b.h[1], b.h[2]));
		for (const g of this.gates)
			for (const b of gateBars(g))
				w.spawn(
					staticBox(
						g.cx + g.rx * b.lx,
						b.ly,
						g.cz + g.rz * b.lx,
						b.hx,
						b.hy,
						b.hz,
						g.qy,
						g.qw,
					),
				);
		const pad = track.pad.p;
		w.spawn(staticBox(pad[0], PAD_TOP / 2, pad[2], 0.36, PAD_TOP / 2, 0.36));
		this.views = new WorldViews(w, host.memory);
		const l = Math.sqrt(track.pad.dir[0] ** 2 + track.pad.dir[1] ** 2);
		this.spawnDrone(
			pad[0],
			PAD_TOP + DRONE_RADIUS + 0.002,
			pad[2],
			track.pad.dir[0] / l,
			track.pad.dir[1] / l,
		);
	}

	/** Race clock (s): 0 at GO. */
	get raceTime(): number {
		return (this.tick - COUNTDOWN_TICKS) * (1 / 60);
	}

	get laps(): number {
		return this.track.laps;
	}

	/** Best completed lap (s), or -1. */
	get bestLap(): number {
		let b = -1;
		for (const t of this.lapTimes) if (b < 0 || t < b) b = t;
		return b;
	}

	speed(): number {
		const v = this.vel;
		return Math.sqrt(
			(v[0] as number) ** 2 + (v[1] as number) ** 2 + (v[2] as number) ** 2,
		);
	}

	private spawnDrone(
		x: number,
		y: number,
		z: number,
		dx: number,
		dz: number,
	): void {
		if (this.droneId >= 0) this.world.despawn(this.droneId);
		const [qy, qw] = yawQuat(dx, dz);
		this.droneId = this.world.spawn(
			JSON.stringify({
				position: [x, y, z],
				rotation: [0, qy, 0, qw],
				body: {
					type: "dynamic",
					mass: DRONE_MASS,
					friction: 0.5,
					restitution: 0.25,
					linearDamping: TUNE.linearDamping,
					angularDamping: 0,
					ccd: true,
					collider: { shape: "sphere", radius: DRONE_RADIUS },
				},
			}),
		);
		this.views.refresh();
		this.slot = this.world.slotOf(this.droneId);
		this.readState();
		this.prevPos.set(this.pos);
	}

	/** Pose and velocities from the world, plus the derived body axes and heading. */
	private readState(): void {
		const c = this.views.curr;
		const o = this.slot * 8;
		const p = this.pos;
		p[0] = c[o] as number;
		p[1] = c[o + 1] as number;
		p[2] = c[o + 2] as number;
		const x = c[o + 3] as number;
		const y = c[o + 4] as number;
		const z = c[o + 5] as number;
		const w = c[o + 6] as number;
		const q = this.quat;
		q[0] = x;
		q[1] = y;
		q[2] = z;
		q[3] = w;
		const s = this.views.scratch;
		const v = this.vel;
		if (this.world.linearVelocity(this.droneId)) {
			v[0] = s[VEL] as number;
			v[1] = s[VEL + 1] as number;
			v[2] = s[VEL + 2] as number;
		}
		const a = this.ang;
		if (this.world.angularVelocity(this.droneId)) {
			a[0] = s[ANG] as number;
			a[1] = s[ANG + 1] as number;
			a[2] = s[ANG + 2] as number;
		}
		const u = this.up;
		u[0] = 2 * (x * y - w * z);
		u[1] = 1 - 2 * (x * x + z * z);
		u[2] = 2 * (y * z + w * x);
		const r = this.right;
		r[0] = 1 - 2 * (y * y + z * z);
		r[1] = 2 * (x * y + w * z);
		r[2] = 2 * (x * z - w * y);
		const f = this.fwd;
		f[0] = -2 * (x * z + w * y);
		f[1] = -2 * (y * z - w * x);
		f[2] = -(1 - 2 * (x * x + y * y));
		// heading: the forward axis flattened; when the nose points straight up or down, the up
		// axis flattened (it leans the way the nose came from) so yaw stays continuous
		let hx = f[0] as number;
		let hz = f[2] as number;
		let l = Math.sqrt(hx * hx + hz * hz);
		if (l < 0.25) {
			const sgn = (f[1] as number) > 0 ? -1 : 1;
			hx = (u[0] as number) * sgn;
			hz = (u[2] as number) * sgn;
			l = Math.sqrt(hx * hx + hz * hz);
		}
		if (l > 1e-4) {
			this.hfx = hx / l;
			this.hfz = hz / l;
		}
	}

	/** Thrust (N) and target body rates (world frame, rad/s) from the sticks. */
	private control(
		thr: number,
		yaw: number,
		pitch: number,
		roll: number,
		assisted: boolean,
		out: Float64Array,
	): number {
		const u = this.up;
		const ux = u[0] as number;
		const uy = u[1] as number;
		const uz = u[2] as number;
		const v = this.vel;
		if (!assisted) {
			const r = this.right;
			const f = this.fwd;
			const P = -pitch * TUNE.acroRate;
			const Y = -yaw * TUNE.acroYaw;
			const R = roll * TUNE.acroRate;
			out[0] = (r[0] as number) * P + ux * Y + (f[0] as number) * R;
			out[1] = (r[1] as number) * P + uy * Y + (f[1] as number) * R;
			out[2] = (r[2] as number) * P + uz * Y + (f[2] as number) * R;
			return ((thr + 1) / 2) * MAX_THRUST;
		}
		// assisted: sticks set a tilt (auto-level when centred), throttle sets a climb rate
		const hfx = this.hfx;
		const hfz = this.hfz;
		const hrx = -hfz;
		const hrz = hfx;
		const idle = 1 - Math.max(Math.abs(pitch), Math.abs(roll));
		const brake = TUNE.brake * idle;
		let dx =
			(hrx * roll + hfx * pitch) * TUNE.assistTilt - (v[0] as number) * brake;
		let dz =
			(hrz * roll + hfz * pitch) * TUNE.assistTilt - (v[2] as number) * brake;
		const tl = Math.sqrt(dx * dx + dz * dz);
		if (tl > TUNE.assistTilt) {
			dx = (dx / tl) * TUNE.assistTilt;
			dz = (dz / tl) * TUNE.assistTilt;
		}
		const dl = Math.sqrt(dx * dx + 1 + dz * dz);
		const tx = dx / dl;
		const ty = 1 / dl;
		const tz = dz / dl;
		// error axis: up x target
		let ex = uy * tz - uz * ty;
		let ey = uz * tx - ux * tz;
		let ez = ux * ty - uy * tx;
		if (ux * tx + uy * ty + uz * tz < 0) {
			// more than 90 degrees off: full-rate recovery about the error axis (or the right axis)
			const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
			if (el > 1e-3) {
				ex /= el;
				ey /= el;
				ez /= el;
			} else {
				const r = this.right;
				ex = r[0] as number;
				ey = r[1] as number;
				ez = r[2] as number;
			}
		}
		const k = TUNE.attitudeGain;
		out[0] = ex * k;
		out[1] = ey * k - yaw * TUNE.assistYaw;
		out[2] = ez * k;
		const vzWant = thr * TUNE.climbRate;
		const aUp = -GRAVITY + (vzWant - (v[1] as number)) * TUNE.climbGain;
		if (uy < 0.15) return 0;
		const t = (DRONE_MASS * aUp) / Math.max(uy, 0.45);
		return t < 0 ? 0 : Math.min(t, MAX_THRUST);
	}

	private readonly wantW = new Float64Array(3);

	/** Advances one tick: countdown, flight, physics, gates, crashes. */
	step(input: TickInput): void {
		this.events.clear();
		const t = this.tick;
		if (this.phase === PHASE.COUNTDOWN) {
			if (t % 60 === 0 && t < COUNTDOWN_TICKS)
				this.events.push(EV.COUNT, 3 - t / 60);
			if (t === COUNTDOWN_TICKS - 1) this.events.push(EV.GO);
		}
		const flying = t >= COUNTDOWN_TICKS - 1;
		let thrust = 0;
		if (flying && this.freeze === 0) {
			const auto = this.hover > 0 || this.phase === PHASE.FINISHED;
			const s = 1 / 127;
			thrust = auto
				? this.control(0, 0, 0, 0, true, this.wantW)
				: this.control(
						input.throttle * s,
						input.yaw * s,
						input.pitch * s,
						input.roll * s,
						this.mode === "assisted",
						this.wantW,
					);
			if (this.hover > 0) this.hover--;
			const w = this.ang;
			const k = TUNE.rateLoop * INERTIA;
			const W = this.wantW;
			this.world.applyTorqueImpulse(
				this.droneId,
				((W[0] as number) - (w[0] as number)) * k,
				((W[1] as number) - (w[1] as number)) * k,
				((W[2] as number) - (w[2] as number)) * k,
			);
		}
		// thrust along the body's up axis, quadratic drag against the velocity
		const v = this.vel;
		const sp = this.speed();
		const u = this.up;
		const jT = thrust * DT;
		const jD = DRONE_MASS * TUNE.quadDrag * sp * DT;
		const jx = (u[0] as number) * jT - (v[0] as number) * jD;
		const jy = (u[1] as number) * jT - (v[1] as number) * jD;
		const jz = (u[2] as number) * jT - (v[2] as number) * jD;
		if (jx !== 0 || jy !== 0 || jz !== 0)
			this.world.applyImpulse(this.droneId, jx, jy, jz);
		this.thrust = thrust / MAX_THRUST;
		// what the velocity would be with no contact this tick
		const damp = 1 / (1 + DT * TUNE.linearDamping);
		const pv = this.predV;
		pv[0] = ((v[0] as number) + jx / DRONE_MASS) * damp;
		pv[1] = ((v[1] as number) + jy / DRONE_MASS + GRAVITY * DT) * damp;
		pv[2] = ((v[2] as number) + jz / DRONE_MASS) * damp;

		this.world.step(1);
		this.tick++;
		this.views.refresh();
		this.prevPos.set(this.pos);
		this.readState();

		const ix = (v[0] as number) - (pv[0] as number);
		const iy = (v[1] as number) - (pv[1] as number);
		const iz = (v[2] as number) - (pv[2] as number);
		this.impact = Math.sqrt(ix * ix + iy * iy + iz * iz);

		if (this.phase === PHASE.COUNTDOWN && this.tick >= COUNTDOWN_TICKS)
			this.phase = PHASE.RACE;
		if (this.phase !== PHASE.RACE) return;
		if (this.freeze > 0) {
			if (--this.freeze === 0) this.respawn();
			return;
		}
		this.checkGate();
		if (this.phase !== PHASE.RACE) return;
		this.checkCrash();
		if (this.tick >= MAX_RACE_TICKS) {
			this.phase = PHASE.FINISHED;
			this.events.push(EV.FINISH, 0, -1);
		}
	}

	private checkCrash(): void {
		const imp = this.impact;
		const onFloor = (this.pos[1] as number) < DRONE_RADIUS + 0.12;
		if ((this.up[1] as number) < 0.2 && onFloor) this.flipped++;
		else this.flipped = 0;
		if (imp > TUNE.crashDv || this.flipped > TUNE.flipTicks) {
			this.crashes++;
			this.freeze = TUNE.crashTicks;
			this.flipped = 0;
			this.events.push(EV.CRASH, 0, imp);
		} else if (imp > TUNE.bumpDv && this.tick > COUNTDOWN_TICKS + 2)
			this.events.push(EV.BUMP, 0, imp);
	}

	private respawn(): void {
		const n = this.gates[this.nextGate] as Gate;
		let x: number;
		let y: number;
		let z: number;
		if (this.lastGate < 0) {
			const p = this.track.pad.p;
			x = p[0];
			y = PAD_TOP + 0.9;
			z = p[2];
		} else {
			const g = this.gates[this.lastGate] as Gate;
			x = g.cx + g.nx * 0.6;
			y = g.cy;
			z = g.cz + g.nz * 0.6;
		}
		let dx = n.cx - x;
		let dz = n.cz - z;
		const l = Math.sqrt(dx * dx + dz * dz);
		if (l > 1e-3) {
			dx /= l;
			dz /= l;
		} else {
			dx = n.nx;
			dz = n.nz;
		}
		this.spawnDrone(x, y, z, dx, dz);
		this.hover = TUNE.hoverTicks;
		this.events.push(EV.RESPAWN);
	}

	/** Flew through the next gate's opening this tick, in the right direction? */
	private checkGate(): void {
		const g = this.gates[this.nextGate] as Gate;
		const p0 = this.prevPos;
		const p1 = this.pos;
		const s0 =
			((p0[0] as number) - g.cx) * g.nx + ((p0[2] as number) - g.cz) * g.nz;
		const s1 =
			((p1[0] as number) - g.cx) * g.nx + ((p1[2] as number) - g.cz) * g.nz;
		if (!(s0 < 0 && s1 >= 0)) return;
		const f = s0 / (s0 - s1);
		const hx = (p0[0] as number) + ((p1[0] as number) - (p0[0] as number)) * f;
		const hy = (p0[1] as number) + ((p1[1] as number) - (p0[1] as number)) * f;
		const hz = (p0[2] as number) + ((p1[2] as number) - (p0[2] as number)) * f;
		const lat = (hx - g.cx) * g.rx + (hz - g.cz) * g.rz;
		if (Math.abs(lat) > g.w / 2 || Math.abs(hy - g.cy) > g.h / 2) return;
		// sub-tick crossing time on the race clock
		const time = this.raceTime - (1 - f) * DT;
		this.lastGate = g.index;
		if (g.index === 0) {
			if (this.lap >= 0) {
				const lapTime = time - this.lapStart;
				this.lapTimes.push(lapTime);
				this.lapTicks.push([this.lapStartTick, this.tick]);
				this.events.push(EV.LAP, this.lap, lapTime);
				if (this.lapTimes.length >= this.track.laps) {
					this.finishTime = time;
					this.phase = PHASE.FINISHED;
					this.events.push(EV.GATE, 0, lapTime);
					this.events.push(EV.FINISH, 0, time);
					return;
				}
			}
			this.lap = this.lapTimes.length;
			this.lapStart = time;
			this.lapStartTick = this.tick;
			this.events.push(EV.GATE, 0, 0);
		} else this.events.push(EV.GATE, g.index, time - this.lapStart);
		this.nextGate = (g.index + 1) % this.gates.length;
	}

	/** World hash plus the race state: equal for equal (track, mode, inputs). */
	hash(): string {
		const h = this.hasher.reset();
		h.word(this.tick)
			.word(this.lap + 1)
			.word(this.nextGate)
			.word(this.crashes);
		for (const t of this.lapTimes) h.float(t);
		h.float(this.finishTime);
		return `${this.world.stateHash()}:${h.hex()}`;
	}

	free(): void {
		this.world.free();
	}
}
