import { type PerspectiveCamera, Vector3 } from "three/webgpu";

const _v = new Vector3();

/**
 * Orbit-style strategy camera over the plateau: pan (WASD / arrows / middle drag), rotate
 * (Q/E / right drag), zoom (wheel), tilt (R/F). Provides the picking ray for a screen point.
 */
export class CameraRig {
	tx = 0;
	tz = 5;
	yaw = 0;
	pitch = 0.98;
	dist = 92;
	enabled = true;
	/** Slow cinematic drift (demo / title). */
	drift = 0;
	shake = 0;
	private readonly keys = new Set<string>();
	private drag: 0 | 1 | 2 = 0;
	private lx = 0;
	private ly = 0;
	private t = 0;
	private readonly camera: PerspectiveCamera;

	constructor(camera: PerspectiveCamera, dom: HTMLElement) {
		this.camera = camera;
		window.addEventListener("keydown", (e) => {
			if (!(e.target instanceof HTMLInputElement)) this.keys.add(e.code);
		});
		window.addEventListener("keyup", (e) => this.keys.delete(e.code));
		window.addEventListener("blur", () => this.keys.clear());
		dom.addEventListener("contextmenu", (e) => e.preventDefault());
		dom.addEventListener("pointerdown", (e) => {
			if (e.button === 2) this.drag = 1;
			else if (e.button === 1) this.drag = 2;
			else return;
			this.lx = e.clientX;
			this.ly = e.clientY;
			dom.setPointerCapture(e.pointerId);
		});
		dom.addEventListener("pointermove", (e) => {
			if (!this.drag) return;
			const dx = e.clientX - this.lx;
			const dy = e.clientY - this.ly;
			this.lx = e.clientX;
			this.ly = e.clientY;
			if (this.drag === 1) {
				this.yaw -= dx * 0.005;
				this.pitch = Math.min(1.45, Math.max(0.45, this.pitch + dy * 0.004));
			} else this.pan(-dx * this.dist * 0.0016, -dy * this.dist * 0.0016);
		});
		dom.addEventListener("pointerup", () => {
			this.drag = 0;
		});
		dom.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				this.dist = Math.min(
					125,
					Math.max(22, this.dist * (1 + Math.sign(e.deltaY) * 0.1)),
				);
			},
			{ passive: false },
		);
	}

	private pan(right: number, fwd: number): void {
		const c = Math.cos(this.yaw);
		const s = Math.sin(this.yaw);
		this.tx = Math.min(40, Math.max(-40, this.tx + right * c - fwd * s));
		this.tz = Math.min(40, Math.max(-40, this.tz - right * s - fwd * c));
	}

	update(dt: number): void {
		this.t += dt;
		const k = this.keys;
		const sp = this.dist * 0.9 * dt;
		if (this.enabled) {
			let r = 0;
			let f = 0;
			if (k.has("KeyD") || k.has("ArrowRight")) r += 1;
			if (k.has("KeyA") || k.has("ArrowLeft")) r -= 1;
			if (k.has("KeyW") || k.has("ArrowUp")) f += 1;
			if (k.has("KeyS") || k.has("ArrowDown")) f -= 1;
			if (r || f) this.pan(r * sp, f * sp);
			if (k.has("KeyQ")) this.yaw += dt * 1.3;
			if (k.has("KeyE")) this.yaw -= dt * 1.3;
			if (k.has("KeyR")) this.pitch = Math.min(1.45, this.pitch + dt);
			if (k.has("KeyF")) this.pitch = Math.max(0.45, this.pitch - dt);
		}
		this.yaw += this.drift * dt;
		const cp = Math.cos(this.pitch);
		const cam = this.camera;
		const sh = this.shake * this.shake * 0.8;
		cam.position.set(
			this.tx +
				Math.sin(this.yaw) * cp * this.dist +
				Math.sin(this.t * 47) * sh,
			Math.sin(this.pitch) * this.dist + Math.sin(this.t * 53) * sh,
			this.tz + Math.cos(this.yaw) * cp * this.dist,
		);
		cam.lookAt(this.tx, 0, this.tz);
		cam.updateMatrixWorld();
	}

	/** World ray through normalised device coords; writes origin and direction. */
	ray(ndcX: number, ndcY: number, origin: Vector3, dir: Vector3): void {
		const cam = this.camera;
		origin.copy(cam.position);
		_v.set(ndcX, ndcY, 0.5).unproject(cam);
		dir.copy(_v).sub(origin).normalize();
	}
}
