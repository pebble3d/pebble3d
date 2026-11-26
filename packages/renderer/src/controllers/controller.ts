import type { Vector3 } from "three/webgpu";

/** Common shape of the camera controllers. `update` must not allocate. */
export interface CameraController {
	update(dt: number): void;
	/** Place the camera at `position` looking at `target` (used by camera presets). */
	setPose(position: Vector3, target: Vector3): void;
	enabled: boolean;
	dispose(): void;
}
