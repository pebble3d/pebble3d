/**
 * Three-quarter camera that orbits the pair slowly, leans in on submissions, and takes
 * eased punches and shakes from the presentation.
 */
import type { PerspectiveCamera } from "three/webgpu";

export type CamMode = "title" | "play" | "sub" | "results" | "intro";

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class Cam {
	private readonly cam: PerspectiveCamera;
	private angle = 0.75;
	private dist = 4.2;
	private height = 1.9;
	private fov = 40;
	private tx = 0;
	private ty = 0.4;
	private tz = 0;
	private shakeA = 0;
	private shakeT = 0;
	private punchA = 0;
	private side = 0;
	mode: CamMode = "title";
	/** Preferred orbit angle (radians) for submissions, or null. */
	prefer: number | null = null;
	/** Orbit speed in rad/s. */
	spin = 0.05;

	constructor(cam: PerspectiveCamera) {
		this.cam = cam;
	}

	shake(a: number): void {
		this.shakeA = Math.max(this.shakeA, a);
	}
	punch(a: number): void {
		this.punchA = Math.max(this.punchA, a);
	}

	update(dt: number, cx: number, cy: number, cz: number): void {
		const m = this.mode;
		const want =
			m === "title"
				? { d: 5.4, h: 2.3, f: 38, s: 0.08 }
				: m === "sub"
					? { d: 3.3, h: 1.5, f: 36, s: 0.035 }
					: m === "results"
						? { d: 4.6, h: 2.0, f: 38, s: 0.06 }
						: m === "intro"
							? { d: 4.6, h: 1.7, f: 40, s: 0.03 }
							: { d: 3.7, h: 1.8, f: 40, s: 0.045 };
		const k = 1 - Math.exp(-dt * 1.6);
		this.dist = lerp(this.dist, want.d, k);
		this.height = lerp(this.height, want.h, k);
		this.fov = lerp(this.fov, want.f, k);
		this.spin = lerp(this.spin, want.s, k);
		this.angle += this.spin * dt;
		// submissions: ease to a side-on view across the pair, the nearer of the two sides
		if (m === "sub" && this.prefer !== null) {
			let d = this.prefer - this.angle;
			d = Math.atan2(Math.sin(d), Math.cos(d));
			if (Math.abs(d) > Math.PI / 2) d -= Math.sign(d) * Math.PI;
			this.angle += d * (1 - Math.exp(-dt * 1.2));
		}
		const kt = 1 - Math.exp(-dt * 3);
		this.tx = lerp(this.tx, cx, kt);
		this.ty = lerp(this.ty, cy, kt);
		this.tz = lerp(this.tz, cz, kt);
		this.shakeT += dt;
		const sh = this.shakeA;
		this.shakeA *= Math.exp(-dt * 7);
		this.punchA *= Math.exp(-dt * 6);
		const d = this.dist * (1 - this.punchA * 0.12);
		const sx = Math.sin(this.shakeT * 53) * sh * 0.05;
		const sy = Math.sin(this.shakeT * 71 + 1) * sh * 0.04;
		// title: aim left of the pair so it sits right of the menu
		this.side += ((m === "title" ? 1.15 : 0) - this.side) * k;
		const rx = -Math.sin(this.angle) * this.side;
		const rz = Math.cos(this.angle) * this.side;
		this.cam.position.set(
			this.tx + Math.cos(this.angle) * d + sx + rx,
			this.ty + this.height + sy,
			this.tz + Math.sin(this.angle) * d + rz,
		);
		this.cam.lookAt(this.tx + sx * 0.5 + rx, this.ty + sy * 0.5, this.tz + rz);
		if (Math.abs(this.cam.fov - this.fov) > 0.01) {
			this.cam.fov = this.fov;
			this.cam.updateProjectionMatrix();
		}
	}

	/** Distance from the camera to its target along the view axis (for depth of field). */
	focus(): number {
		return this.dist * (1 - this.punchA * 0.12) * 1.05;
	}
}
