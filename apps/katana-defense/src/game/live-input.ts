import { cameraRelativeInput, type MoveKeys } from "@pebble3d/sdk/input";
import { BTN, type TickInput } from "./input.ts";

const KEY_BTN: Record<string, number> = {
	KeyJ: BTN.LIGHT,
	KeyK: BTN.HEAVY,
	KeyQ: BTN.DODGE,
	KeyL: BTN.DODGE,
	Space: BTN.JUMP,
	KeyE: BTN.FOCUS,
	ShiftLeft: BTN.SPRINT,
	ShiftRight: BTN.SPRINT,
	Enter: BTN.START,
	NumpadEnter: BTN.START,
	Digit1: BTN.PICK1,
	Digit2: BTN.PICK2,
	Digit3: BTN.PICK3,
};
const KEY_MOVE: Record<string, keyof MoveKeys> = {
	KeyW: "f",
	ArrowUp: "f",
	KeyS: "b",
	ArrowDown: "b",
	KeyA: "l",
	ArrowLeft: "l",
	KeyD: "r",
	ArrowRight: "r",
};
/** A second press of the same direction within this many ms is a dodge. */
const DOUBLE_TAP_MS = 230;
const PAD_DEADZONE = 0.22;
const PAD_LOOK_SPEED = 2.6;

/**
 * Keyboard, mouse and gamepad -> TickInput. Held state is sampled each tick; presses that
 * start and end between two ticks are latched for one tick so taps are never lost. Mouse:
 * left = light, right = heavy. Double-tapping a direction dodges.
 */
export class LiveInput {
	private held = 0;
	private latched = 0;
	private readonly keys: MoveKeys = { f: false, b: false, l: false, r: false };
	private readonly lastTap: Record<string, number> = {};
	private readonly dir = new Float32Array(2);
	/** Extra one-tick presses injected by UI (clicking an upgrade card). */
	inject = 0;
	/** Gamepad right-stick look delta for the camera (radians this tick). */
	lookYaw = 0;
	lookPitch = 0;

	constructor(target: HTMLElement) {
		const down = (bit: number): void => {
			this.held |= bit;
			this.latched |= bit;
		};
		window.addEventListener("keydown", (e) => {
			if (e.repeat) return;
			const m = KEY_MOVE[e.code];
			if (m) {
				this.keys[m] = true;
				const now = performance.now();
				const last = this.lastTap[m] ?? -1e9;
				if (now - last < DOUBLE_TAP_MS) {
					this.latched |= BTN.DODGE;
					this.lastTap[m] = -1e9;
				} else this.lastTap[m] = now;
			}
			const b = KEY_BTN[e.code];
			if (b) {
				down(b);
				if (e.code === "Space") e.preventDefault();
			}
		});
		window.addEventListener("keyup", (e) => {
			const m = KEY_MOVE[e.code];
			if (m) this.keys[m] = false;
			const b = KEY_BTN[e.code];
			if (b) this.held &= ~b;
		});
		window.addEventListener("blur", () => {
			this.held = 0;
			this.keys.f = this.keys.b = this.keys.l = this.keys.r = false;
		});
		target.addEventListener("mousedown", (e) => {
			if (e.button === 0) down(BTN.LIGHT);
			else if (e.button === 2) down(BTN.HEAVY);
		});
		window.addEventListener("mouseup", (e) => {
			if (e.button === 0) this.held &= ~BTN.LIGHT;
			else if (e.button === 2) this.held &= ~BTN.HEAVY;
		});
		target.addEventListener("contextmenu", (e) => e.preventDefault());
	}

	/** Builds this tick's input; `yaw` is the camera yaw (move keys are camera-relative). */
	sample(out: TickInput, yaw: number, dt: number): void {
		cameraRelativeInput(this.keys, yaw, this.dir);
		let mx = this.dir[0] as number;
		let mz = this.dir[1] as number;
		let buttons = this.held | this.latched | this.inject;
		this.latched = 0;
		this.inject = 0;
		this.lookYaw = 0;
		this.lookPitch = 0;
		const pads = navigator.getGamepads?.();
		const pad = pads?.[0];
		if (pad) {
			const ax = pad.axes[0] ?? 0;
			const ay = pad.axes[1] ?? 0;
			if (Math.hypot(ax, ay) > PAD_DEADZONE) {
				// stick up = camera forward
				const s = Math.sin(yaw);
				const c = Math.cos(yaw);
				mx = -s * -ay + c * ax;
				mz = -c * -ay - s * ax;
				const l = Math.hypot(mx, mz);
				if (l > 1) {
					mx /= l;
					mz /= l;
				}
			}
			const rx = pad.axes[2] ?? 0;
			const ry = pad.axes[3] ?? 0;
			if (Math.abs(rx) > PAD_DEADZONE) this.lookYaw = -rx * PAD_LOOK_SPEED * dt;
			if (Math.abs(ry) > PAD_DEADZONE)
				this.lookPitch = -ry * PAD_LOOK_SPEED * dt;
			const b = pad.buttons;
			const on = (i: number): boolean => b[i]?.pressed === true;
			if (on(0)) buttons |= BTN.JUMP;
			if (on(2)) buttons |= BTN.LIGHT;
			if (on(3)) buttons |= BTN.HEAVY;
			if (on(1)) buttons |= BTN.DODGE;
			if (on(5)) buttons |= BTN.FOCUS;
			if (on(4) || on(6)) buttons |= BTN.SPRINT;
			if (on(9)) buttons |= BTN.START;
			if (on(14)) buttons |= BTN.PICK1;
			if (on(12)) buttons |= BTN.PICK2;
			if (on(15)) buttons |= BTN.PICK3;
		}
		out.mx = mx;
		out.mz = mz;
		out.buttons = buttons;
	}
}
