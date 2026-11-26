import { FRAME_ASPECT } from "./constants.ts";
import { BTN, type TickInput } from "./input.ts";
import { project } from "./photo.ts";
import { type Anomaly, type FieldSim, PHASE, type WorldDef } from "./sim.ts";

const DEG = Math.PI / 180;
/** Desired subject fill (diameter / frame height) the bot zooms for. */
const FILL_TARGET = 0.36;
const MAX_TURN = 0.045;
const ARRIVE = 0.3;
const OBSTACLE_PAD = 0.42;
const BOUNDS_PAD = 0.45;
/** Clearance a path segment keeps from obstacle boxes (capsule radius plus a margin). */
const EDGE_PAD = 0.34;

/** Viewpoint directions (degrees from +Z, the hall-facing side first), every 10 degrees. */
const FAN: number[] = [0];
for (let d = 10; d < 180; d += 10) FAN.push(d, -d);
FAN.push(180);

const S = {
	TITLE: 0,
	PLAN: 1,
	WALK: 2,
	FACE: 3,
	AIM: 4,
	SETTLE: 5,
	ADMIRE: 6,
	DONE: 7,
} as const;

/**
 * Demo autoplayer (`?demo=1`). Walks to a viewpoint for each anomaly that is not yet
 * documented, raises the camera, composes on a thirds point, zooms, focuses, meters and
 * shoots. It reads sim state only and writes a TickInput, so a demo run is an ordinary
 * input log. Deterministic for a seed.
 */
export class DemoBot {
	private s: number = S.TITLE;
	private t = 0;
	private target = -1;
	private readonly vp = { x: 0, z: 0 };
	/** Waypoints before the viewpoint, flat [x, z, ...], and the next one's index. */
	private readonly path: number[] = [];
	private pathAt = 0;
	private yaw = 0;
	private lastDist = Number.POSITIVE_INFINITY;
	private stuckT = 0;
	private attempt = 0;
	private scouting = false;
	/** Failed attempts per anomaly (stuck or unstarred). */
	private readonly failures: number[] = [];
	private u = 1 / 3;
	private v = 1 / 3;
	private evPresses = 0;
	private readonly proj = { u: 0, v: 0, depth: 0 };
	/** Human-readable current action (shot sidecar). */
	current = "title";

	constructor(
		private readonly sim: FieldSim,
		private readonly world: WorldDef,
		startYaw: number,
		/** Ticks to linger on the title before starting. */
		private readonly titleTicks = 90,
	) {
		this.yaw = startYaw;
	}

	next(out: TickInput): void {
		const sim = this.sim;
		out.buttons = 0;
		out.lookYaw = 0;
		out.lookPitch = 0;
		out.zoom = 0;
		out.focus = 0;
		out.camYaw = this.yaw;
		this.t++;
		if (sim.phase === PHASE.TITLE) {
			this.current = "title";
			if (this.t >= this.titleTicks) out.buttons |= BTN.START;
			return;
		}
		if (sim.phase === PHASE.RESULTS) {
			this.current = "results";
			return;
		}
		switch (this.s) {
			case S.TITLE:
			case S.PLAN:
				this.plan();
				break;
			case S.WALK:
				this.walk(out);
				break;
			case S.FACE:
				this.face(out);
				break;
			case S.AIM:
				this.aim(out);
				break;
			case S.SETTLE:
				this.settle(out);
				break;
			case S.ADMIRE:
				if (this.t > 50) {
					out.buttons |= BTN.PHOTO;
					this.attempt++;
					this.go(S.PLAN);
				}
				break;
			case S.DONE:
				break;
		}
		out.camYaw = this.yaw;
	}

	private go(s: number): void {
		this.s = s;
		this.t = 0;
	}

	private anomaly(): Anomaly {
		return this.sim.anomalies[this.target] as Anomaly;
	}

	/** Nearest anomaly without a starred photo; then a viewpoint facing it (hall side first). */
	private plan(): void {
		const sim = this.sim;
		let best = -1;
		let bestD = Number.POSITIVE_INFINITY;
		for (let i = 0; i < sim.anomalies.length; i++) {
			const a = sim.anomalies[i] as Anomaly;
			if (a.bestStars > 0) continue;
			// Give up on one that keeps failing while others remain (retried at the end).
			const d =
				Math.hypot(a.x - sim.px, a.z - sim.pz) +
				((this.failures[i] ?? 0) >= 6 ? 1000 : 0);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		if (best < 0) {
			this.current = "done";
			this.go(S.DONE);
			return;
		}
		if (best !== this.target) this.attempt = 0;
		this.target = best;
		const a = this.anomaly();
		const r = a.def.r;
		// The ideal shooting distance for the subject's size; a hidden anomaly is first
		// approached close enough to reveal it (scouting), then re-planned.
		const ideal = Math.min(3.9, Math.max(2.1, r * 6.5));
		const reach = sim.reveal - 0.35;
		this.scouting = !a.revealed && ideal > reach;
		const dist = this.scouting ? reach : ideal;
		// Candidate directions from the anomaly to the viewpoint: +Z (camera faces the hall)
		// first, then fanning out. Later attempts skip ahead in the fan.
		const fan = FAN;
		this.vp.x = a.x;
		this.vp.z = a.z + dist;
		// Closer in when the room is tight (the zoom makes up for it).
		let found = false;
		search: for (const k of [1, 0.85, 0.7, 0.58, 0.47, 0.38]) {
			// Scouting only has to get close; a photo viewpoint keeps some distance.
			const dk = Math.max(this.scouting ? 0.8 : 1.5, dist * k);
			for (let f = 0; f < fan.length; f++) {
				// The door is shot face-on: the fan centres on its facing.
				const base = a.def.id === "door" ? a.facing : 0;
				const ang =
					base +
					((fan[(f + this.attempt * 2) % fan.length] as number) +
						(a.kind % 2 === 0 ? 8 : -8)) *
						DEG;
				const x = a.x + Math.sin(ang) * dk;
				const z = a.z + Math.cos(ang) * dk;
				if (!this.free(x, z) || !this.sightline(x, z, a.x, a.z)) continue;
				this.vp.x = x;
				this.vp.z = z;
				if (this.route()) {
					found = true;
					break search;
				}
			}
		}
		if (!found) {
			// Nothing reachable: head straight for the hall side; the stuck timer moves on.
			this.vp.x = a.x;
			this.vp.z = a.z + dist;
			this.path.length = 0;
			this.pathAt = 0;
		}
		this.u = a.kind % 2 === 0 ? 1 / 3 : 2 / 3;
		this.v = a.y < 1.2 ? 2 / 3 : 1 / 3;
		if (a.kind === 4) this.u = 0.42;
		if (a.kind === 5) this.v = 0.5; // the door: centred vertically, thirds across
		this.lastDist = Number.POSITIVE_INFINITY;
		this.stuckT = 0;
		this.current = `walk:${a.def.id}`;
		this.go(S.WALK);
	}

	/** Inside the bounds and clear of every obstacle (padded). */
	private free(x: number, z: number): boolean {
		const b = this.world.bounds;
		if (
			x < b.min[0] + BOUNDS_PAD ||
			x > b.max[0] - BOUNDS_PAD ||
			z < b.min[1] + BOUNDS_PAD ||
			z > b.max[1] - BOUNDS_PAD
		)
			return false;
		for (const o of this.world.obstacles)
			if (
				Math.abs(x - o.x) < o.hx + OBSTACLE_PAD &&
				Math.abs(z - o.z) < o.hz + OBSTACLE_PAD
			)
				return false;
		return true;
	}

	/**
	 * Shortest path to the viewpoint over a visibility graph: the start, the goal and the
	 * corners of every (padded) obstacle, joined where the straight segment stays clear.
	 * Runs once per plan (not per tick).
	 */
	private route(): boolean {
		const sim = this.sim;
		this.path.length = 0;
		this.pathAt = 0;
		const xs: number[] = [sim.px, this.vp.x];
		const zs: number[] = [sim.pz, this.vp.z];
		for (const o of this.world.obstacles) {
			const hx = o.hx + OBSTACLE_PAD + 0.05;
			const hz = o.hz + OBSTACLE_PAD + 0.05;
			for (const sx of [-1, 1])
				for (const sz of [-1, 1]) {
					const cx = o.x + sx * hx;
					const cz = o.z + sz * hz;
					if (this.free(cx, cz)) {
						xs.push(cx);
						zs.push(cz);
					}
				}
		}
		const n = xs.length;
		const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
		const prev = new Int32Array(n).fill(-1);
		const done = new Uint8Array(n);
		dist[0] = 0;
		for (;;) {
			let u = -1;
			for (let i = 0; i < n; i++)
				if (!done[i] && (u < 0 || (dist[i] as number) < (dist[u] as number)))
					u = i;
			if (u < 0 || dist[u] === Number.POSITIVE_INFINITY || u === 1) break;
			done[u] = 1;
			for (let v = 0; v < n; v++) {
				if (done[v] || v === u) continue;
				const ux = xs[u] as number;
				const uz = zs[u] as number;
				const vx = xs[v] as number;
				const vz = zs[v] as number;
				// The player may already stand inside a padded margin: leaving the start only
				// needs to miss the furniture itself.
				if (!this.clear(ux, uz, vx, vz, u === 0 ? 0.2 : EDGE_PAD)) continue;
				const d = (dist[u] as number) + Math.hypot(vx - ux, vz - uz);
				if (d < (dist[v] as number)) {
					dist[v] = d;
					prev[v] = u;
				}
			}
		}
		if (prev[1] === -1) return false;
		const rev: number[] = [];
		for (let v = prev[1] as number; v > 0; v = prev[v] as number) rev.push(v);
		for (let i = rev.length - 1; i >= 0; i--) {
			const k = rev[i] as number;
			this.path.push(xs[k] as number, zs[k] as number);
		}
		return true;
	}

	/** No tall obstacle (a wall panel, not furniture) between the lens and the subject. */
	private sightline(ax: number, az: number, bx: number, bz: number): boolean {
		for (const o of this.world.obstacles)
			if (o.h > 1.2 && segmentHitsBox(ax, az, bx, bz, o.x, o.z, o.hx, o.hz))
				return false;
		return true;
	}

	/** The segment keeps a capsule's clearance from every obstacle. */
	private clear(
		ax: number,
		az: number,
		bx: number,
		bz: number,
		pad = EDGE_PAD,
	): boolean {
		for (const o of this.world.obstacles)
			if (segmentHitsBox(ax, az, bx, bz, o.x, o.z, o.hx + pad, o.hz + pad))
				return false;
		return true;
	}

	private turnToward(want: number, rate = MAX_TURN): void {
		let d = want - this.yaw;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		this.yaw += Math.max(-rate, Math.min(rate, d));
	}

	private walk(out: TickInput): void {
		const sim = this.sim;
		const way = this.pathAt < this.path.length;
		const gx = way ? (this.path[this.pathAt] as number) : this.vp.x;
		const gz = way ? (this.path[this.pathAt + 1] as number) : this.vp.z;
		const dx = gx - sim.px;
		const dz = gz - sim.pz;
		const d = Math.hypot(dx, dz);
		if (d < (way ? 0.4 : ARRIVE)) {
			if (way) {
				this.pathAt += 2;
				this.lastDist = Number.POSITIVE_INFINITY;
				return;
			}
			this.go(S.FACE);
			return;
		}
		// Turn on the spot when the heading is far off (movement follows the camera yaw, and
		// the camera turns smoothly), so tight waypoints are never orbited.
		const want = Math.atan2(-dx, -dz);
		const look = this.world.view.botLook;
		if (look) {
			// Keep the camera on the good side of the capture and strafe with the 8-way keys,
			// like a player who keeps the hall in view.
			const [centre, range] = look;
			this.turnToward(centre + clamp(wrap(want - centre), range));
			const k = Math.round(wrap(want - this.yaw) / (Math.PI / 4));
			out.buttons |= MOVE8[(k + 8) % 8] as number;
			if (d > 3.5) out.buttons |= BTN.SPRINT;
		} else {
			this.turnToward(want);
			const err = wrap(want - this.yaw);
			if (Math.abs(err) < 0.6) out.buttons |= BTN.F;
			if (d > 3.5 && Math.abs(err) < 0.15) out.buttons |= BTN.SPRINT;
		}
		// Stuck (sliding along something): re-plan from another angle.
		if (d < this.lastDist - 0.02) {
			this.lastDist = d;
			this.stuckT = 0;
		} else if (++this.stuckT > 90) {
			this.attempt++;
			this.failures[this.target] = (this.failures[this.target] ?? 0) + 1;
			this.go(S.PLAN);
		}
	}

	private face(out: TickInput): void {
		const sim = this.sim;
		const a = this.anomaly();
		if (this.scouting && a.revealed) {
			this.scouting = false;
			this.go(S.PLAN);
			return;
		}
		const want = Math.atan2(-(a.x - sim.px), -(a.z - sim.pz));
		this.turnToward(want, 0.06);
		let d = want - this.yaw;
		while (d > Math.PI) d -= 2 * Math.PI;
		while (d < -Math.PI) d += 2 * Math.PI;
		if (Math.abs(d) < 0.02 && this.t > 12) {
			out.buttons |= BTN.PHOTO;
			this.current = `aim:${a.def.id}`;
			this.evPresses = 0;
			this.go(S.AIM);
		}
	}

	private aim(out: TickInput): void {
		const sim = this.sim;
		const a = this.anomaly();
		const c = sim.cam;
		if (sim.phase !== PHASE.PHOTO) return;
		project(c, a.x, a.y, a.z, this.proj);
		const tanH = Math.tan((c.fovDeg * DEG) / 2);
		const hfov = 2 * Math.atan(tanH * FRAME_ASPECT);
		const vfov = c.fovDeg * DEG;
		const eu = this.proj.u - this.u;
		const ev = this.proj.v - this.v;
		out.lookYaw = clamp(-eu * hfov * 0.22, 0.03);
		out.lookPitch = clamp(-ev * vfov * 0.22, 0.03);
		// Zoom toward the target fill: fill = r / (depth tan(fov/2)).
		const want =
			(2 *
				Math.atan(a.def.r / (Math.max(0.5, this.proj.depth) * FILL_TARGET))) /
			DEG;
		out.zoom = clamp(want - c.fovDeg, 0.9);
		const settled =
			Math.abs(eu) < 0.012 &&
			Math.abs(ev) < 0.012 &&
			Math.abs(want - c.fovDeg) < 1.5;
		if (settled || this.t > 240) {
			out.buttons |= BTN.AF;
			this.go(S.SETTLE);
		}
	}

	private settle(out: TickInput): void {
		const sim = this.sim;
		const a = this.anomaly();
		// Hold the framing while metering.
		project(sim.cam, a.x, a.y, a.z, this.proj);
		const tanH = Math.tan((sim.cam.fovDeg * DEG) / 2);
		out.lookYaw = clamp(
			-(this.proj.u - this.u) * 2 * Math.atan(tanH * FRAME_ASPECT) * 0.2,
			0.02,
		);
		out.lookPitch = clamp(
			-(this.proj.v - this.v) * sim.cam.fovDeg * DEG * 0.2,
			0.02,
		);
		// A human touch: the prism gets shot without metering, the bloom a little loose.
		const meters = this.anomaly().kind !== 2;
		if (
			meters &&
			this.t % 10 === 0 &&
			Number.isFinite(sim.meter) &&
			this.evPresses < 8
		) {
			if (sim.meter < -0.17) {
				out.buttons |= BTN.EV_UP;
				this.evPresses++;
				return;
			}
			if (sim.meter > 0.17) {
				out.buttons |= BTN.EV_DOWN;
				this.evPresses++;
				return;
			}
		}
		if (this.t === 70) out.buttons |= BTN.AF;
		if (this.t >= 90 && sim.shutterCd === 0) {
			out.buttons |= BTN.SHUTTER;
			this.current = `shoot:${a.def.id}`;
			this.go(S.ADMIRE);
		}
	}
}

/** Key combos for the 8 directions, by 45-degree steps counter-clockwise from forward. */
const MOVE8 = [
	BTN.F,
	BTN.F | BTN.L,
	BTN.L,
	BTN.B | BTN.L,
	BTN.B,
	BTN.B | BTN.R,
	BTN.R,
	BTN.F | BTN.R,
];

function wrap(a: number): number {
	while (a > Math.PI) a -= 2 * Math.PI;
	while (a < -Math.PI) a += 2 * Math.PI;
	return a;
}

function clamp(x: number, m: number): number {
	return Math.max(-m, Math.min(m, x));
}

/** Does the segment (ax,az)->(bx,bz) cross the box centred (cx,cz) with half sizes hx,hz? */
export function segmentHitsBox(
	ax: number,
	az: number,
	bx: number,
	bz: number,
	cx: number,
	cz: number,
	hx: number,
	hz: number,
): boolean {
	// Slab test.
	let t0 = 0;
	let t1 = 1;
	const dx = bx - ax;
	const dz = bz - az;
	const slabs: [number, number, number, number][] = [
		[ax, dx, cx - hx, cx + hx],
		[az, dz, cz - hz, cz + hz],
	];
	for (const [p, d, lo, hi] of slabs) {
		if (Math.abs(d) < 1e-9) {
			if (p < lo || p > hi) return false;
			continue;
		}
		let ta = (lo - p) / d;
		let tb = (hi - p) / d;
		if (ta > tb) [ta, tb] = [tb, ta];
		t0 = Math.max(t0, ta);
		t1 = Math.min(t1, tb);
		if (t0 > t1) return false;
	}
	return true;
}
