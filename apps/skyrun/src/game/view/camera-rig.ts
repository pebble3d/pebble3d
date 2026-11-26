import { ThirdPersonController } from "@pebble3d/renderer";
import { type PerspectiveCamera, Vector3 } from "three/webgpu";
import type { Course } from "../course.ts";
import type { PhysWorld } from "../physics.ts";

/** wasm `raycast` filter: static bodies only (platforms never pop the arm in and out). */
const STATIC_ONLY = 1;
/** The chase camera looks at this height above the runner's feet. */
const PIVOT = 1.25;
/** Rate (1/s) the chase camera swings behind the runner's heading when not steered. */
const FOLLOW_RATE = 1.6;

export type CamMode = "title" | "chase" | "orbit";

/**
 * The camera: the engine's spring-arm `ThirdPersonController` while running (its arm ray
 * hits static geometry only, read from the live sim world), easing behind the runner's
 * heading when the player is not steering it; a slow orbit over the course on the title;
 * and an orbit around the runner on the results. `update` does not allocate.
 */
export class CameraRig {
	readonly tpc: ThirdPersonController;
	mode: CamMode = "title";
	/** Ease the chase yaw behind the velocity (demo, or no mouse/QE input lately). */
	autoFollow = true;
	private world: PhysWorld | null = null;
	private views: { scratch: Float32Array; refresh(): void } | null = null;
	private readonly camera: PerspectiveCamera;
	private readonly pivot = new Vector3();
	private readonly target = new Vector3();
	private readonly eye = new Vector3();
	private orbitT = 0;
	private course: Course | null = null;

	constructor(camera: PerspectiveCamera, dom: HTMLElement | null) {
		this.camera = camera;
		this.tpc = new ThirdPersonController(camera, (o, d, max) => {
			const w = this.world;
			const v = this.views;
			if (!w || !v) return null;
			if (!w.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, STATIC_ONLY, 0))
				return null;
			// Re-read the scratch view: wasm memory growth (any world's spawn) detaches old views.
			v.refresh();
			const toi = v.scratch[0] as number;
			return Number.isFinite(toi) ? toi : null;
		});
		this.tpc.distance = 6.4;
		this.tpc.pitch = -0.3;
		if (dom) this.tpc.connect(dom);
	}

	/** The world (and its views, for the scratch region) the arm ray queries. */
	attach(
		world: PhysWorld,
		views: { scratch: Float32Array; refresh(): void },
	): void {
		this.world = world;
		this.views = views;
	}

	setCourse(c: Course): void {
		this.course = c;
		this.orbitT = 0;
	}

	/** Chase: snap behind a yaw (radians, 0 looks down -Z). */
	snapBehind(yaw: number): void {
		this.tpc.yaw = yaw;
		this.tpc.pitch = -0.3;
	}

	update(
		dt: number,
		feet: Vector3,
		vx: number,
		vz: number,
		turn: number,
		steering: boolean,
	): void {
		const tpc = this.tpc;
		if (this.mode === "chase") {
			tpc.enabled = true;
			tpc.yaw += turn * 2.2 * dt;
			const speed = Math.hypot(vx, vz);
			if (this.autoFollow && !steering && speed > 1.5) {
				const want = Math.atan2(-vx, -vz);
				let d = want - tpc.yaw;
				d = Math.atan2(Math.sin(d), Math.cos(d));
				// Do not swing around when backing toward the camera.
				if (Math.abs(d) < 2.2)
					tpc.yaw +=
						d * (1 - Math.exp(-FOLLOW_RATE * dt * Math.min(1, speed / 5)));
			}
			this.pivot.set(feet.x, feet.y + PIVOT, feet.z);
			tpc.update(this.pivot, dt);
			return;
		}
		tpc.enabled = false;
		this.orbitT += dt;
		if (this.mode === "title" && this.course) {
			const v = this.course.view;
			this.target.set(v.target[0], v.target[1], v.target[2]);
			const dx = v.eye[0] - v.target[0];
			const dz = v.eye[2] - v.target[2];
			const r = Math.hypot(dx, dz);
			const a = Math.atan2(dz, dx) + Math.sin(this.orbitT * 0.08) * 0.35;
			this.eye.set(
				v.target[0] + Math.cos(a) * r,
				v.eye[1],
				v.target[2] + Math.sin(a) * r,
			);
		} else {
			// Results: circle the runner at the goal.
			const a = this.orbitT * 0.25 + 0.6;
			this.target.set(feet.x, feet.y + 1.1, feet.z);
			this.eye.set(
				feet.x + Math.cos(a) * 8.5,
				feet.y + 3.6,
				feet.z + Math.sin(a) * 8.5,
			);
		}
		this.camera.position.copy(this.eye);
		this.camera.lookAt(this.target);
		this.camera.updateMatrixWorld();
	}

	/** Current yaw for camera-relative input. */
	get yaw(): number {
		return this.tpc.yaw;
	}
}
