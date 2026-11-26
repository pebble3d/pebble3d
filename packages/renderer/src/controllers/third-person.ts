import { type PerspectiveCamera, Vector3 } from "three/webgpu";

/**
 * Spring-arm length: the desired distance, pulled in to `hitToi - padding` when the arm's
 * ray hits something closer, never below `min`.
 */
export function springArmDistance(
	desired: number,
	hitToi: number | null,
	padding = 0.2,
	min = 0.5,
): number {
	if (hitToi === null) return desired;
	return Math.max(min, Math.min(desired, hitToi - padding));
}

/** Ray query used by the spring arm: origin, unit direction, max distance -> hit toi or null. */
export type ArmRaycast = (
	origin: Vector3,
	dir: Vector3,
	max: number,
) => number | null;

export const PITCH_MIN = -1.2;
export const PITCH_MAX = 0.3;
/** Radians per pixel of pointer-locked mouse movement. */
const MOUSE_SENSITIVITY = 0.0025;
/** How fast (1/s) the arm grows back out after an obstruction clears; it pulls in instantly. */
const ARM_RETURN_RATE = 6;

/**
 * Third-person orbit camera on a spring arm. `yaw` uses the same convention as
 * `cameraRelativeInput` (yaw 0 looks down -Z, so the camera sits on +Z of the target);
 * `pitch` is the look pitch (negative looks down, so the camera sits above the target).
 * Each update casts one ray from the target toward the camera and pulls the arm in when it
 * hits; the caller decides what the ray sees (static-only, so moving props never pop it).
 * `update` does not allocate.
 */
export class ThirdPersonController {
	yaw = 0;
	pitch = -0.26;
	/** Desired arm length, metres. */
	distance = 5.6;
	enabled = true;
	private arm: number;
	private readonly camera: PerspectiveCamera;
	private readonly raycast: ArmRaycast;
	private readonly dir = new Vector3();
	private dom: HTMLElement | null = null;

	constructor(camera: PerspectiveCamera, raycast: ArmRaycast) {
		this.camera = camera;
		this.raycast = raycast;
		this.arm = this.distance;
	}

	/** Current (possibly pulled-in) arm length. */
	get armLength(): number {
		return this.arm;
	}

	update(target: Vector3, dt: number): void {
		if (!this.enabled) return;
		if (this.pitch < PITCH_MIN) this.pitch = PITCH_MIN;
		else if (this.pitch > PITCH_MAX) this.pitch = PITCH_MAX;
		const cp = Math.cos(this.pitch);
		// target -> camera = -(look direction)
		this.dir.set(
			Math.sin(this.yaw) * cp,
			-Math.sin(this.pitch),
			Math.cos(this.yaw) * cp,
		);
		const want = springArmDistance(
			this.distance,
			this.raycast(target, this.dir, this.distance),
		);
		if (want < this.arm) this.arm = want;
		else this.arm += (want - this.arm) * (1 - Math.exp(-ARM_RETURN_RATE * dt));
		this.camera.position.copy(target).addScaledVector(this.dir, this.arm);
		this.camera.lookAt(target);
		this.camera.updateMatrixWorld();
	}

	/** Pointer lock on click; locked mouse movement drives yaw and pitch. */
	connect(dom: HTMLElement): void {
		this.disconnect();
		this.dom = dom;
		dom.addEventListener("click", this.onClick);
		dom.ownerDocument.addEventListener("mousemove", this.onMouseMove);
	}

	disconnect(): void {
		if (!this.dom) return;
		this.dom.removeEventListener("click", this.onClick);
		this.dom.ownerDocument.removeEventListener("mousemove", this.onMouseMove);
		this.dom = null;
	}

	dispose(): void {
		this.disconnect();
	}

	private readonly onClick = (): void => {
		if (this.enabled && this.dom && document.pointerLockElement !== this.dom)
			void this.dom.requestPointerLock()?.catch?.(() => {});
	};

	private readonly onMouseMove = (e: MouseEvent): void => {
		if (!this.enabled || !this.dom || document.pointerLockElement !== this.dom)
			return;
		this.yaw -= e.movementX * MOUSE_SENSITIVITY;
		this.pitch -= e.movementY * MOUSE_SENSITIVITY;
		if (this.pitch < PITCH_MIN) this.pitch = PITCH_MIN;
		else if (this.pitch > PITCH_MAX) this.pitch = PITCH_MAX;
	};
}
