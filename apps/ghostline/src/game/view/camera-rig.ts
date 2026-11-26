import type { PerspectiveCamera } from "three/webgpu";
import { Vector3 } from "three/webgpu";
import type { Track } from "../track.ts";

const _f = new Vector3();
const _want = new Vector3();
const _look = new Vector3();
const _t = new Vector3();

/** Exponential smoothing factor for rate `k` (1/s) over `dt`. */
function ease(k: number, dt: number): number {
	return 1 - Math.exp(-k * dt);
}

/**
 * Chase camera: rides behind the marble along a blend of its velocity and the track tangent,
 * pulls back and widens the FOV with speed, rolls a little with the tilt input and shakes on
 * hard landings. Also does the countdown swoop and the results orbit. Allocation-free.
 */
export class CameraRig {
	readonly cam: PerspectiveCamera;
	private readonly pos = new Vector3();
	private readonly target = new Vector3();
	private readonly fwd = new Vector3(0, 0, 1);
	private roll = 0;
	private shake = 0;
	private shakeT = 0;
	private fov = 62;
	private initialised = false;
	orbitAngle = 0;
	/** Chase distance override (captures). */
	distBase: number | null = null;

	constructor(cam: PerspectiveCamera) {
		this.cam = cam;
	}

	kick(amount: number): void {
		this.shake = Math.min(0.6, this.shake + amount);
	}

	/** Snap (no smoothing) on the next update. */
	reset(): void {
		this.initialised = false;
	}

	/**
	 * Keeps the chase lens inside the channel: clamps its lateral offset at the deck sample
	 * behind the marble, and keeps it well above the deck there, so a marble riding high on
	 * a banked wall never drags the camera into (or level with) the rail.
	 */
	private keepInChannel(track: Track, i: number, dist: number): void {
		const k = Math.max(0, i - Math.round(dist / 0.5));
		const cx = track.px[k] as number;
		const cy = track.py[k] as number;
		const cz = track.pz[k] as number;
		const rx = track.rx[k] as number;
		const ry = track.ry[k] as number;
		const rz = track.rz[k] as number;
		const ux = track.ux[k] as number;
		const uy = track.uy[k] as number;
		const uz = track.uz[k] as number;
		const dx = _want.x - cx;
		const dy = _want.y - cy;
		const dz = _want.z - cz;
		const lat = dx * rx + dy * ry + dz * rz;
		const up = dx * ux + dy * uy + dz * uz;
		const lim = Math.max(0, (track.width[k] as number) / 2 - 0.9);
		const clat = Math.max(-lim, Math.min(lim, lat));
		const cup = Math.max(up, (track.wall[k] as number) + 1.3);
		_want.x += rx * (clat - lat) + ux * (cup - up);
		_want.y += ry * (clat - lat) + uy * (cup - up);
		_want.z += rz * (clat - lat) + uz * (cup - up);
	}

	/** Title: a slow high orbit around the whole course, framed off-centre (menu on the left). */
	overview(
		dt: number,
		cx: number,
		cy: number,
		cz: number,
		radius: number,
		height: number,
	): void {
		this.orbitAngle += dt * 0.05;
		const cam = this.cam;
		cam.position.set(
			cx + Math.sin(this.orbitAngle) * radius,
			cy + height,
			cz + Math.cos(this.orbitAngle) * radius,
		);
		cam.up.set(0, 1, 0);
		cam.lookAt(cx, cy, cz);
		cam.rotateY(0.3);
		if (cam.fov !== 50) {
			cam.fov = 50;
			cam.updateProjectionMatrix();
		}
		this.initialised = false;
	}

	/**
	 * mode: "chase" (racing), "intro" (countdown swoop, k = 0..1 progress), "orbit" (results),
	 * "fly" (title flyover: `ball` is a point moving along the track).
	 */
	update(
		dt: number,
		mode: "chase" | "intro" | "orbit" | "fly",
		ball: Vector3,
		vel: Vector3,
		track: Track,
		sample: number,
		steer: number,
		k = 1,
	): void {
		const i = Math.max(0, Math.min(track.n - 1, sample));
		_t.set(track.tx[i] as number, track.ty[i] as number, track.tz[i] as number);
		const speed = vel.length();
		// forward: mostly the track, more of the velocity the faster we go
		const hv = Math.hypot(vel.x, vel.z);
		_f.copy(_t);
		_f.y *= 0.5;
		if (hv > 2) {
			_want.set(vel.x / hv, 0, vel.z / hv);
			_f.lerp(_want, Math.min(0.6, hv / 40));
		}
		_f.normalize();
		if (!this.initialised) this.fwd.copy(_f);
		else this.fwd.lerp(_f, ease(3.2, dt)).normalize();

		let dist = (this.distBase ?? 4.3) + Math.min(3, speed * 0.06);
		let height = 1.45 + Math.min(1, speed * 0.018);
		let fovWant = 60 + Math.min(20, Math.max(0, speed - 6) * 0.6);
		if (mode === "intro") {
			const e = 1 - (1 - k) * (1 - k) * (1 - k);
			dist = 26 - 20.8 * e;
			height = 12 - 10.25 * e;
			fovWant = 50 + 10 * e;
			this.orbitAngle = (1 - e) * 1.2;
		}
		if (mode === "orbit") {
			this.orbitAngle += dt * 0.22;
			dist = 6;
			height = 3.2;
			fovWant = 50;
		}
		if (mode === "fly") {
			dist = 9;
			height = 4.5;
			fovWant = 55;
		}
		// behind the marble, rotated about Y by orbitAngle
		const ca = Math.cos(this.orbitAngle);
		const sa = Math.sin(this.orbitAngle);
		const bx = -this.fwd.x * ca + -this.fwd.z * sa;
		const bz = -this.fwd.z * ca - -this.fwd.x * sa;
		_want.set(ball.x + bx * dist, ball.y + height, ball.z + bz * dist);
		if (mode === "chase") this.keepInChannel(track, i, dist);
		// never below the deck we are looking along
		const deckY = (track.py[i] as number) + 1.1;
		if (_want.y < deckY) _want.y = deckY;
		_look.set(
			ball.x + this.fwd.x * 3.2,
			ball.y + 0.45 + this.fwd.y * 2,
			ball.z + this.fwd.z * 3.2,
		);
		// orbit/intro, and any chase angle that puts the lens beside or ahead: frame the marble
		if (mode === "orbit" || mode === "intro" || Math.abs(this.orbitAngle) > 1.2)
			_look.set(ball.x, ball.y + 0.25, ball.z);

		if (!this.initialised) {
			this.pos.copy(_want);
			this.target.copy(_look);
			this.fov = fovWant;
			this.initialised = true;
		} else {
			const pk = mode === "chase" ? 9 : 4;
			this.pos.lerp(_want, ease(pk, dt));
			this.target.lerp(_look, ease(14, dt));
			this.fov += (fovWant - this.fov) * ease(3, dt);
		}
		this.roll += (steer * 0.07 - this.roll) * ease(4, dt);
		const cam = this.cam;
		cam.position.copy(this.pos);
		if (this.shake > 0.001) {
			this.shakeT += dt * 38;
			const s = this.shake * this.shake;
			cam.position.x += Math.sin(this.shakeT * 1.3) * s * 0.35;
			cam.position.y += Math.sin(this.shakeT * 1.9 + 1) * s * 0.35;
			this.shake *= Math.exp(-dt * 5);
		}
		// roll the horizon with the tilt (a board leaning under you)
		cam.up.set(0, 1, 0);
		cam.lookAt(this.target);
		cam.rotateZ(this.roll);
		if (Math.abs(cam.fov - this.fov) > 0.01) {
			cam.fov = this.fov;
			cam.updateProjectionMatrix();
		}
	}
}
