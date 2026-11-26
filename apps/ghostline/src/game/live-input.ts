import { BTN, quantize, type TickInput } from "./input.ts";

const RAMP = 7; // 1/s: keys ease to full tilt in ~0.14 s

/**
 * Keyboard + gamepad -> a camera-relative stick, turned into a WORLD-space tilt vector before
 * it reaches the sim (and the log). The sim never sees the camera.
 */
export class LiveInput {
	private readonly down = new Set<string>();
	private sx = 0;
	private sy = 0;
	/** Last stick (for camera roll), -1..1. */
	steer = 0;
	/** One-shot actions polled by the app (consumed on read). */
	private pressed = new Set<string>();

	constructor() {
		window.addEventListener("keydown", (e) => {
			if (e.repeat) return;
			this.down.add(e.code);
			this.pressed.add(e.code);
			if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
		});
		window.addEventListener("keyup", (e) => this.down.delete(e.code));
		window.addEventListener("blur", () => this.down.clear());
	}

	/** True once per key press. */
	took(code: string): boolean {
		return this.pressed.delete(code);
	}

	clearPressed(): void {
		this.pressed.clear();
	}

	private key(...codes: string[]): boolean {
		for (const c of codes) if (this.down.has(c)) return true;
		return false;
	}

	/** Samples one tick. `fx, fz`: camera forward on the ground plane (normalised). */
	sample(out: TickInput, fx: number, fz: number, dt: number): TickInput {
		let tx =
			(this.key("KeyD", "ArrowRight") ? 1 : 0) -
			(this.key("KeyA", "ArrowLeft") ? 1 : 0);
		let ty =
			(this.key("KeyW", "ArrowUp") ? 1 : 0) -
			(this.key("KeyS", "ArrowDown") ? 1 : 0);
		let jump = this.key("Space");
		let brake = this.key("ShiftLeft", "ShiftRight");
		const pads =
			typeof navigator.getGamepads === "function"
				? navigator.getGamepads()
				: [];
		for (const p of pads) {
			if (!p) continue;
			const ax = p.axes[0] ?? 0;
			const ay = p.axes[1] ?? 0;
			if (Math.hypot(ax, ay) > 0.15) {
				tx = ax;
				ty = -ay;
			}
			if (p.buttons[0]?.pressed) jump = true;
			if (p.buttons[6]?.pressed || p.buttons[1]?.pressed) brake = true;
			break;
		}
		const k = Math.min(1, RAMP * dt);
		this.sx += (tx - this.sx) * k;
		this.sy += (ty - this.sy) * k;
		this.steer = this.sx;
		// camera right = forward x up (on the ground plane)
		const rx = -fz;
		const rz = fx;
		let wx = fx * this.sy + rx * this.sx;
		let wz = fz * this.sy + rz * this.sx;
		const l = Math.hypot(wx, wz);
		if (l > 1) {
			wx /= l;
			wz /= l;
		}
		out.x = quantize(wx);
		out.z = quantize(wz);
		out.buttons = (jump ? BTN.JUMP : 0) | (brake ? BTN.BRAKE : 0);
		return out;
	}
}
