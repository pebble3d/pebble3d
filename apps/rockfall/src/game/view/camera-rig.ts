import { type PerspectiveCamera, Vector3 } from "three/webgpu";
import { PHASE } from "../phase.ts";
import type { RockfallSim } from "../sim.ts";

const FOV = 46;
/** Gameplay framing: a high chase angle so falling rocks and their rings read. */
const DIST = 19;
const PITCH = -0.9;
const YAW = 0;
const FOLLOW = 5;
/** Trauma decay per second (shake = trauma^2). */
const TRAUMA_DECAY = 1.6;
const SHAKE_METRES = 0.45;
const TARGET_LIMIT = 9;

/**
 * Fixed-yaw chase camera (north-up, so WASD is always the same way on screen), smoothed
 * follow with the target held inside the arena, trauma shake (no FOV changes: the CSM split frustums stay valid). Title and
 * results screens orbit slowly instead.
 */
export class CameraRig {
	/** False while a scene camera preset is shown (`__pebble3d.setCamera`). */
	enabled = true;
	yaw = YAW;
	pitch = PITCH;
	dist = DIST;
	private trauma = 0;
	private t = 0;
	private orbit = 0;
	private readonly target = new Vector3();
	private readonly want = new Vector3();
	private readonly camera: PerspectiveCamera;
	private readonly sim: RockfallSim;
	private first = true;

	constructor(camera: PerspectiveCamera, sim: RockfallSim) {
		this.camera = camera;
		this.sim = sim;
		camera.fov = FOV;
		camera.near = 0.3;
		camera.far = 400;
		camera.updateProjectionMatrix();
	}

	shake(amount: number): void {
		this.trauma = Math.min(1, this.trauma + amount);
	}

	update(dt: number): void {
		this.t += dt;
		const sim = this.sim;
		const cam = this.camera;
		let yaw = this.yaw;
		let pitch = this.pitch;
		let dist = this.dist;
		if (sim.phase === PHASE.TITLE) {
			this.orbit += dt * 0.07;
			this.want.set(0, 1.5, 0);
			yaw = this.orbit + 0.6;
			pitch = -0.5;
			dist = 31;
		} else if (sim.phase === PHASE.OVER) {
			this.orbit += dt * 0.12;
			this.want.set(sim.px, sim.py, sim.pz);
			yaw = this.yaw + Math.sin(this.orbit) * 0.5;
			pitch = -0.62;
			dist = 13;
		} else {
			this.orbit = 0;
			const l = TARGET_LIMIT;
			this.want.set(
				Math.max(-l, Math.min(l, sim.px)),
				0.6,
				Math.max(-l, Math.min(l, sim.pz)),
			);
		}
		if (this.first) {
			this.target.copy(this.want);
			this.first = false;
		} else this.target.lerp(this.want, 1 - Math.exp(-FOLLOW * dt));

		// Near the south wall (between the camera and the player) the view steepens so the wall
		// never covers the play area.
		if (sim.phase !== PHASE.TITLE && sim.phase !== PHASE.OVER) {
			const k = Math.max(0, Math.min(1, (this.target.z - 2) / 7));
			pitch -= k * k * (3 - 2 * k) * 0.32;
		}
		const cp = Math.cos(pitch);
		cam.position.set(
			this.target.x + Math.sin(yaw) * cp * dist,
			this.target.y - Math.sin(pitch) * dist,
			this.target.z + Math.cos(yaw) * cp * dist,
		);
		// Shake: smooth pseudo-noise from incommensurate sines, scaled by trauma^2.
		this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
		const s = this.trauma * this.trauma * SHAKE_METRES;
		const t = this.t * 31;
		cam.position.x += s * (Math.sin(t * 1.13) + Math.sin(t * 2.71) * 0.5);
		cam.position.y += s * (Math.sin(t * 1.37 + 1) + Math.sin(t * 3.07) * 0.5);
		cam.position.z += s * (Math.sin(t * 0.97 + 2) * 0.6);
		cam.lookAt(this.target.x, this.target.y, this.target.z - 0.6);
	}
}
