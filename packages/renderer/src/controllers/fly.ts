import { Euler, type PerspectiveCamera, Vector3 } from "three/webgpu";
import type { CameraController } from "./controller.ts";

const _move = new Vector3();

/**
 * Fly camera: WASD to move, Q/E (or Space/C) down/up, Shift to go fast, drag with a mouse
 * button to look. No allocation in `update` or the input handlers.
 */
export class FlyController implements CameraController {
	enabled = true;
	speed = 6;
	fastMultiplier = 4;
	lookSensitivity = 0.0025;

	private readonly camera: PerspectiveCamera;
	private readonly dom: HTMLElement;
	private readonly euler = new Euler(0, 0, 0, "YXZ");
	private readonly keys = {
		f: false,
		b: false,
		l: false,
		r: false,
		u: false,
		d: false,
		fast: false,
	};
	private dragging = false;

	constructor(camera: PerspectiveCamera, dom: HTMLElement) {
		this.camera = camera;
		this.dom = dom;
		this.euler.setFromQuaternion(camera.quaternion);
		window.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("keyup", this.onKeyUp);
		window.addEventListener("blur", this.onBlur);
		dom.addEventListener("pointerdown", this.onPointerDown);
		window.addEventListener("pointerup", this.onPointerUp);
		window.addEventListener("pointermove", this.onPointerMove);
		dom.addEventListener("contextmenu", this.onContextMenu);
	}

	update(dt: number): void {
		if (!this.enabled) return;
		const k = this.keys;
		_move.set(
			(k.r ? 1 : 0) - (k.l ? 1 : 0),
			(k.u ? 1 : 0) - (k.d ? 1 : 0),
			(k.b ? 1 : 0) - (k.f ? 1 : 0),
		);
		if (_move.lengthSq() === 0) return;
		_move
			.normalize()
			.multiplyScalar(this.speed * (k.fast ? this.fastMultiplier : 1) * dt);
		// x/z in camera space, y in world space
		const y = _move.y;
		_move.y = 0;
		_move.applyQuaternion(this.camera.quaternion);
		_move.y += y;
		this.camera.position.add(_move);
	}

	setPose(position: Vector3, target: Vector3): void {
		this.camera.position.copy(position);
		this.camera.lookAt(target);
		this.euler.setFromQuaternion(this.camera.quaternion);
	}

	dispose(): void {
		window.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("keyup", this.onKeyUp);
		window.removeEventListener("blur", this.onBlur);
		this.dom.removeEventListener("pointerdown", this.onPointerDown);
		window.removeEventListener("pointerup", this.onPointerUp);
		window.removeEventListener("pointermove", this.onPointerMove);
		this.dom.removeEventListener("contextmenu", this.onContextMenu);
	}

	private setKey(code: string, down: boolean): void {
		const k = this.keys;
		switch (code) {
			case "KeyW":
			case "ArrowUp":
				k.f = down;
				break;
			case "KeyS":
			case "ArrowDown":
				k.b = down;
				break;
			case "KeyA":
			case "ArrowLeft":
				k.l = down;
				break;
			case "KeyD":
			case "ArrowRight":
				k.r = down;
				break;
			case "KeyE":
			case "Space":
				k.u = down;
				break;
			case "KeyQ":
			case "KeyC":
				k.d = down;
				break;
			case "ShiftLeft":
			case "ShiftRight":
				k.fast = down;
				break;
		}
	}

	private readonly onKeyDown = (e: KeyboardEvent): void => {
		this.setKey(e.code, true);
	};

	private readonly onKeyUp = (e: KeyboardEvent): void => {
		this.setKey(e.code, false);
	};

	private readonly onBlur = (): void => {
		const k = this.keys;
		k.f = k.b = k.l = k.r = k.u = k.d = k.fast = false;
		this.dragging = false;
	};

	private readonly onPointerDown = (): void => {
		this.dragging = true;
	};

	private readonly onPointerUp = (): void => {
		this.dragging = false;
	};

	private readonly onContextMenu = (e: Event): void => {
		e.preventDefault();
	};

	private readonly onPointerMove = (e: PointerEvent): void => {
		if (!this.enabled || !this.dragging) return;
		this.euler.y -= e.movementX * this.lookSensitivity;
		this.euler.x -= e.movementY * this.lookSensitivity;
		const lim = Math.PI / 2 - 0.01;
		if (this.euler.x > lim) this.euler.x = lim;
		if (this.euler.x < -lim) this.euler.x = -lim;
		this.camera.quaternion.setFromEuler(this.euler);
	};
}
