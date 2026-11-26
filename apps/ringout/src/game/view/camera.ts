import type { PerspectiveCamera } from "three/webgpu";
import { Vector3 } from "three/webgpu";

const _want = new Vector3();
const _look = new Vector3();

function ease(k: number, dt: number): number {
	return 1 - Math.exp(-k * dt);
}

export type CamMode = "title" | "play" | "replay" | "results";

/**
 * Arena camera. Play: a fixed-yaw broadcast view from the south (so WASD and the arrows
 * always mean the same screen directions for both players), easing toward the action and
 * in as the arena shrinks. Replay: a lower, slowly orbiting cinematic lens. Allocation-free.
 */
export class ArenaCamera {
	readonly cam: PerspectiveCamera;
	private readonly pos = new Vector3(0, 14, 16);
	private readonly target = new Vector3();
	private shake = 0;
	private t = 0;
	private snap = true;
	/** Seconds into the current mode (for orbits). */
	private modeT = 0;
	private mode: CamMode = "title";

	constructor(cam: PerspectiveCamera) {
		this.cam = cam;
	}

	kick(amount: number): void {
		this.shake = Math.min(0.5, this.shake + amount);
	}

	setMode(m: CamMode, snap = false): void {
		if (m !== this.mode) this.modeT = 0;
		this.mode = m;
		if (snap) this.snap = true;
	}

	/** `cx, cz`: focus on the floor; `spread`: how far apart the orbs are; `arena`: arena radius (m). */
	update(
		dt: number,
		cx: number,
		cz: number,
		spread: number,
		arena: number,
	): void {
		this.t += dt;
		this.modeT += dt;
		const m = this.mode;
		let fov = 42;
		let k = 2.5;
		if (m === "title") {
			const a = this.modeT * 0.12 + 0.4;
			_want.set(Math.sin(a) * 18, 9.5, Math.cos(a) * 18);
			_look.set(0, -3.2, 0);
			fov = 46;
			k = 1.2;
		} else if (m === "play") {
			const dist = 9.5 + Math.max(arena, 2) * 0.62 + spread * 0.25;
			_look.set(cx * 0.45, 0, cz * 0.45);
			_want.set(_look.x, dist * 0.92, _look.z + dist * 0.78);
		} else if (m === "replay") {
			const a = 0.5 + this.modeT * 0.1;
			const dist = 6.5 + spread * 0.45 + arena * 0.25;
			_look.set(cx * 0.8, 0.2, cz * 0.8);
			_want.set(
				_look.x + Math.sin(a) * dist,
				2.4 + dist * 0.35,
				_look.z + Math.cos(a) * dist,
			);
			fov = 48;
			k = 2;
		} else {
			const a = this.modeT * 0.16 + 0.3;
			// keep the champion right of centre, clear of the results panel on the left
			const ox = -Math.cos(a) * 2.6;
			const oz = Math.sin(a) * 2.6;
			_look.set(cx + ox, 0.4, cz + oz);
			_want.set(cx + ox + Math.sin(a) * 8.5, 3.6, cz + oz + Math.cos(a) * 8.5);
			fov = 40;
			k = 1.5;
		}
		if (this.snap) {
			this.pos.copy(_want);
			this.target.copy(_look);
			this.snap = false;
		} else {
			const e = ease(k, dt);
			this.pos.lerp(_want, e);
			this.target.lerp(_look, e);
		}
		this.shake = Math.max(0, this.shake - dt * 1.6);
		const s = this.shake * this.shake;
		const c = this.cam;
		c.position.set(
			this.pos.x + Math.sin(this.t * 41) * s * 0.6,
			this.pos.y + Math.sin(this.t * 53 + 1) * s * 0.5,
			this.pos.z + Math.sin(this.t * 37 + 2) * s * 0.6,
		);
		c.lookAt(this.target);
		if (Math.abs(c.fov - fov) > 0.01) {
			c.fov += (fov - c.fov) * ease(3, dt);
			c.updateProjectionMatrix();
		}
	}
}
