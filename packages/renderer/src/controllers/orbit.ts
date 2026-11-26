import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PerspectiveCamera, Vector3 } from "three/webgpu";
import type { CameraController } from "./controller.ts";

export class OrbitController implements CameraController {
	readonly controls: OrbitControls;
	private readonly camera: PerspectiveCamera;

	constructor(camera: PerspectiveCamera, dom: HTMLElement) {
		this.camera = camera;
		this.controls = new OrbitControls(camera, dom);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.maxPolarAngle = Math.PI * 0.495;
	}

	get enabled(): boolean {
		return this.controls.enabled;
	}

	set enabled(v: boolean) {
		this.controls.enabled = v;
	}

	update(dt: number): void {
		if (this.controls.enabled) this.controls.update(dt);
	}

	setPose(position: Vector3, target: Vector3): void {
		this.camera.position.copy(position);
		this.controls.target.copy(target);
		this.camera.lookAt(target);
		this.controls.update();
	}

	dispose(): void {
		this.controls.dispose();
	}
}
