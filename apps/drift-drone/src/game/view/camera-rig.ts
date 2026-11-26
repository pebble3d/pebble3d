import { type PerspectiveCamera, Quaternion, Vector3 } from "three/webgpu";
import type { SiteDef } from "../track.ts";

export type CamMode = "chase" | "fpv";

/** Static-geometry ray: distance to the first hit, or -1. */
export type CamRay = (
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number,
	max: number,
) => number;

const _want = new Vector3();
const _look = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();
const _tilt = new Quaternion();
const _off = new Vector3();

function ease(k: number, dt: number): number {
	return 1 - Math.exp(-k * dt);
}

/**
 * Chase, FPV, title sway and staged cameras. Chase rides behind and above the drone along its
 * heading blended with its velocity, pulls back and widens with speed, and is kept out of the
 * walls by a static-only engine raycast from the drone; FPV is the drone's own camera, rigidly
 * mounted and tilted up 10 degrees like a racing quad's. Allocation-free.
 */
export class CameraRig {
	readonly cam: PerspectiveCamera;
	mode: CamMode = "chase";
	private readonly pos = new Vector3();
	private readonly look = new Vector3();
	private fov = 68;
	private snap = true;
	private readonly site: SiteDef;
	private readonly ray: CamRay;
	shake = 0;
	private shakeT = 0;

	constructor(cam: PerspectiveCamera, site: SiteDef, ray: CamRay) {
		this.cam = cam;
		this.site = site;
		this.ray = ray;
		_tilt.setFromAxisAngle(new Vector3(1, 0, 0), 0.17);
	}

	reset(): void {
		this.snap = true;
	}

	private apply(fov: number): void {
		const c = this.cam;
		if (Math.abs(c.fov - fov) > 1e-3) {
			c.fov = fov;
			c.updateProjectionMatrix();
		}
	}

	/**
	 * Behind the drone. `hx, hz` = heading; `v` = velocity; `hist` = where the drone was about a
	 * quarter second ago (null if unknown). The lens rides that point of the flown path, so it
	 * follows the drone through gate openings instead of clipping their frames; when the path is
	 * too short (hovering, just respawned) it falls back to a fixed offset along the heading.
	 */
	chase(
		dt: number,
		p: Vector3,
		hx: number,
		hz: number,
		v: Vector3,
		hist: Vector3 | null,
	): void {
		const sp = v.length();
		const vh = Math.hypot(v.x, v.z);
		let dx = hx;
		let dz = hz;
		if (vh > 0.8) {
			const k = Math.min(1, (vh - 0.8) / 3) * 0.6;
			dx += (v.x / vh) * k;
			dz += (v.z / vh) * k;
		}
		const dl = Math.hypot(dx, dz) || 1;
		dx /= dl;
		dz /= dl;
		const minD = 1.5;
		const maxD = 2.6;
		_want.set(p.x - dx * minD, p.y + 0.5, p.z - dz * minD);
		if (hist) {
			_off.set(hist.x, hist.y + 0.32, hist.z).sub(p);
			const d = _off.length();
			if (d > maxD) _off.multiplyScalar(maxD / d);
			const w = Math.min(1, d / minD);
			_d.copy(p).add(_off);
			_want.lerp(_d, w * w);
		}
		// keep the lens out of the proxies and the gate frames
		_d.subVectors(_want, p);
		const len = _d.length();
		if (len > 1e-3) {
			_d.divideScalar(len);
			const hit = this.ray(p.x, p.y, p.z, _d.x, _d.y, _d.z, len + 0.2);
			if (hit >= 0 && hit < len + 0.2)
				_want.copy(p).addScaledVector(_d, Math.max(0.35, hit - 0.2));
		}
		const { min, max } = this.site.bounds;
		_want.x = Math.min(max[0] + 0.8, Math.max(min[0] - 0.8, _want.x));
		_want.z = Math.min(max[2] + 0.8, Math.max(min[2] - 0.2, _want.z));
		_want.y = Math.min(max[1] + 0.5, Math.max(0.25, _want.y));
		_look.set(p.x + dx * 1.4, p.y + 0.12, p.z + dz * 1.4);
		if (this.snap) {
			this.pos.copy(_want);
			this.look.copy(_look);
			this.snap = false;
		} else {
			this.pos.lerp(_want, ease(14, dt));
			this.look.lerp(_look, ease(10, dt));
		}
		this.fov += (68 + Math.min(14, sp * 1.1) - this.fov) * ease(3, dt);
		this.cam.position.copy(this.pos);
		this.addShake(dt);
		this.cam.lookAt(this.look);
		this.apply(this.fov);
	}

	/** The drone's own camera. */
	fpv(p: Vector3, q: Quaternion, sp: number): void {
		_off.set(0, 0.06, -0.07).applyQuaternion(q);
		this.cam.position.copy(p).add(_off);
		_q.copy(q).multiply(_tilt);
		this.cam.quaternion.copy(_q);
		this.addShake(1 / 60);
		this.apply(84 + Math.min(10, sp * 0.6));
		this.snap = true;
	}

	/** Title: a slow side-to-side drift around `angle` (radians, 0 = +X of the centre). */
	sway(
		dt: number,
		cx: number,
		cy: number,
		cz: number,
		r: number,
		h: number,
		angle: number,
	): void {
		this.swayT += dt;
		const a = angle + Math.sin(this.swayT * 0.09) * 0.28;
		this.cam.position.set(cx + Math.cos(a) * r, cy + h, cz + Math.sin(a) * r);
		this.cam.lookAt(cx, cy, cz);
		this.apply(46);
		this.snap = true;
	}
	private swayT = 0;

	/** A fixed pose. */
	staged(
		px: number,
		py: number,
		pz: number,
		tx: number,
		ty: number,
		tz: number,
		fov: number,
	): void {
		this.cam.position.set(px, py, pz);
		this.cam.lookAt(tx, ty, tz);
		this.apply(fov);
		this.snap = true;
	}

	kick(a: number): void {
		this.shake = Math.min(0.5, this.shake + a);
	}

	private addShake(dt: number): void {
		if (this.shake <= 0.001) return;
		this.shakeT += dt * 60;
		const s = this.shake * 0.08;
		this.cam.position.x += Math.sin(this.shakeT * 1.7) * s;
		this.cam.position.y += Math.sin(this.shakeT * 2.3 + 1) * s;
		this.shake *= Math.exp(-dt * 6);
	}
}
