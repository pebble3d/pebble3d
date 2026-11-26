import { ThirdPersonController } from "@pebble3d/renderer";
import { type PerspectiveCamera, Vector3 } from "three/webgpu";
import type { GameSim } from "../sim.ts";

const PIVOT_HEIGHT = 1.2;
const BASE_FOV = 40;
/**
 * The splat capture is sharp from above and toward the hall, and smears near the ground
 * and past its south/east edges. The follow camera therefore stays high (pitch within
 * [PITCH_LOW, PITCH_HIGH], a 12 m arm with a 40 degree lens) and keeps facing roughly north (yaw within
 * +-YAW_LIMIT of looking at the hall).
 */
const ARM = 12;
const PITCH_HIGH = -0.72;
const PITCH_LOW = -1.1;
const PITCH_DEFAULT = -0.8;
const YAW_LIMIT = 1.25;
/** Trauma decay per second (shake = trauma^2). */
const TRAUMA_DECAY = 1.7;
const SHAKE_METRES = 0.32;

/**
 * Third-person spring-arm camera (the engine's controller, mouse-look via pointer lock) with
 * trauma-based shake and an FOV punch. In `auto` mode (demo/captures) it frames the player
 * and the gate. The arena has no camera occluders, so the arm never collides.
 */
export class CameraRig {
	readonly tpc: ThirdPersonController;
	auto = false;
	fixedYaw: number | null = null;
	fixedPitch: number | null = null;
	private trauma = 0;
	private fovKick = 0;
	private t = 0;
	private readonly pivot = new Vector3();
	private readonly camera: PerspectiveCamera;
	private readonly sim: GameSim;

	constructor(
		camera: PerspectiveCamera,
		sim: GameSim,
		dom: HTMLElement | null,
	) {
		this.camera = camera;
		this.sim = sim;
		this.tpc = new ThirdPersonController(camera, () => null);
		this.tpc.distance = ARM;
		this.tpc.pitch = PITCH_DEFAULT;
		this.tpc.yaw = 0;
		if (dom) this.tpc.connect(dom);
	}

	/**
	 * Slow establishing orbit around a point (title and end screens). The frame is offset so
	 * the subject sits right of centre, leaving the left for the screen's text.
	 */
	cinematic(
		dt: number,
		tx: number,
		ty: number,
		tz: number,
		radius: number,
	): void {
		this.t += dt;
		const a = 0.35 + 0.22 * Math.sin(this.t * 0.07);
		const cam = this.camera;
		cam.position.set(
			tx + Math.sin(a) * radius,
			ty + radius * 0.38,
			tz + Math.cos(a) * radius,
		);
		// look slightly left of the subject so it lands right of centre
		this.pivot.set(
			tx - Math.cos(a) * radius * 0.28,
			ty + 0.6,
			tz + Math.sin(a) * radius * 0.28,
		);
		cam.lookAt(this.pivot);
		if (Math.abs(cam.fov - 42) > 1e-3) {
			cam.fov = 42;
			cam.updateProjectionMatrix();
		}
		cam.updateMatrixWorld();
		// the follow camera resumes from behind the player
		this.tpc.yaw = 0;
	}

	addTrauma(v: number): void {
		this.trauma = Math.min(1, this.trauma + v);
	}

	punch(fov: number): void {
		this.fovKick = Math.max(this.fovKick, fov);
	}

	update(dt: number, px: number, py: number, pz: number): void {
		this.t += dt;
		const s = this.sim;
		if (this.auto) {
			// Stay on the south side looking north at the hall (the capture is sharpest
			// there), swinging up to +-0.55 rad to keep the player-to-gate line in frame.
			const o = s.objective;
			const dx = o.x - px;
			const dz = o.z - pz;
			let want = Math.atan2(-dx, -dz);
			if (Math.hypot(dx, dz) < 3) want = 0;
			const target = Math.max(-0.55, Math.min(0.55, want * 0.6));
			let diff = target - this.tpc.yaw;
			while (diff > Math.PI) diff -= Math.PI * 2;
			while (diff < -Math.PI) diff += Math.PI * 2;
			this.tpc.yaw += diff * (1 - Math.exp(-1.2 * dt));
			this.tpc.pitch = PITCH_DEFAULT;
		}
		if (this.fixedYaw === null)
			this.tpc.yaw = Math.max(-YAW_LIMIT, Math.min(YAW_LIMIT, this.tpc.yaw));
		if (this.fixedPitch === null)
			this.tpc.pitch = Math.max(
				PITCH_LOW,
				Math.min(PITCH_HIGH, this.tpc.pitch),
			);
		if (this.fixedYaw !== null) this.tpc.yaw = this.fixedYaw;
		if (this.fixedPitch !== null) this.tpc.pitch = this.fixedPitch;
		this.pivot.set(px, py + PIVOT_HEIGHT, pz);
		this.tpc.update(this.pivot, dt);
		// shake
		this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
		const sh = this.trauma * this.trauma * SHAKE_METRES;
		if (sh > 1e-4) {
			const t = this.t * 38;
			const cam = this.camera;
			cam.position.x +=
				sh * (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.7) * 0.5);
			cam.position.y +=
				sh * (Math.sin(t * 1.7 + 0.5) + Math.sin(t * 2.9) * 0.5);
			cam.position.z +=
				sh * (Math.sin(t * 1.3 + 2.1) + Math.sin(t * 3.1 + 0.3) * 0.5);
			cam.rotateZ(sh * 0.35 * Math.sin(t * 0.9));
		}
		this.fovKick = Math.max(0, this.fovKick - dt * 30);
		const fov = BASE_FOV - this.fovKick;
		if (Math.abs(this.camera.fov - fov) > 1e-3) {
			this.camera.fov = fov;
			this.camera.updateProjectionMatrix();
		}
		this.camera.updateMatrixWorld();
	}
}
