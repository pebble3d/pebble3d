import { TUNE } from "./constants.ts";
import { quantize, type TickInput } from "./input.ts";
import { PressQueue } from "./keys.ts";

/** Throttle that hovers in acro (thrust = weight). */
export const ACRO_HOVER = 2 / TUNE.twr - 1;

function dz(v: number): number {
	return Math.abs(v) < 0.08 ? 0 : v;
}

function approach(v: number, target: number, rate: number): number {
	return v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
}

/**
 * Keyboard and gamepad to sticks. Keyboard axes ease in and out over about a tenth of a second
 * so taps give small corrections. Acro throttle on the keyboard is a lever: W/S move it and it
 * stays where you leave it (it starts at hover). A gamepad (standard mapping, "mode 2") is read
 * as analogue sticks: left = throttle / yaw, right = pitch / roll. Edge-triggered menu keys
 * are queued for the app (`presses`).
 */
export class LiveInput {
	private readonly down = new Set<string>();
	/** Edge-triggered presses, consumed per frame by `screenActions`. */
	readonly presses = new PressQueue();
	private ax = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
	acroThrottle = ACRO_HOVER;
	/** Last source used, for the HUD hint. */
	source: "keyboard" | "gamepad" = "keyboard";
	private padStart = false;

	constructor() {
		window.addEventListener("keydown", (e) => {
			if (e.repeat) return;
			if (
				[
					"ArrowUp",
					"ArrowDown",
					"ArrowLeft",
					"ArrowRight",
					"Space",
					"Tab",
				].includes(e.code)
			)
				e.preventDefault();
			this.down.add(e.code);
			this.presses.add(e.code);
			this.source = "keyboard";
		});
		window.addEventListener("keyup", (e) => this.down.delete(e.code));
		window.addEventListener("blur", () => this.down.clear());
	}

	/** Gamepad Start as an Enter press (menus call this every frame; sample() covers races). */
	pollPad(): void {
		if (typeof navigator.getGamepads !== "function") return;
		for (const p of navigator.getGamepads()) {
			if (!p) continue;
			const start = p.buttons[9]?.pressed === true;
			if (start && !this.padStart) this.presses.add("Enter");
			this.padStart = start;
			return;
		}
	}

	resetSticks(acro: boolean): void {
		this.ax.throttle = acro ? ACRO_HOVER : 0;
		this.ax.yaw = 0;
		this.ax.pitch = 0;
		this.ax.roll = 0;
		this.acroThrottle = ACRO_HOVER;
	}

	private key(a: string, b: string): number {
		return (this.down.has(a) ? 1 : 0) - (this.down.has(b) ? 1 : 0);
	}

	/** Samples one tick of sticks into `out` (quantised). */
	sample(out: TickInput, acro: boolean, dt: number): void {
		const r = dt * 9;
		const ax = this.ax;
		ax.yaw = approach(ax.yaw, this.key("KeyD", "KeyA"), r);
		ax.pitch = approach(
			ax.pitch,
			this.key("ArrowUp", "ArrowDown") || this.key("KeyI", "KeyK"),
			r,
		);
		ax.roll = approach(
			ax.roll,
			this.key("ArrowRight", "ArrowLeft") || this.key("KeyL", "KeyJ"),
			r,
		);
		const thr = this.key("KeyW", "KeyS");
		if (acro) {
			this.acroThrottle = Math.max(
				-1,
				Math.min(1, this.acroThrottle + thr * dt * 1.1),
			);
			if (this.down.has("Space"))
				this.acroThrottle = approach(this.acroThrottle, ACRO_HOVER, dt * 3);
			ax.throttle = this.acroThrottle;
		} else ax.throttle = approach(ax.throttle, thr, r);
		let throttle = ax.throttle;
		let yaw = ax.yaw;
		let pitch = ax.pitch;
		let roll = ax.roll;
		const pads =
			typeof navigator.getGamepads === "function"
				? navigator.getGamepads()
				: [];
		for (const p of pads) {
			if (!p || p.axes.length < 4) continue;
			const lx = dz(p.axes[0] ?? 0);
			const ly = dz(p.axes[1] ?? 0);
			const rx = dz(p.axes[2] ?? 0);
			const ry = dz(p.axes[3] ?? 0);
			if (lx || ly || rx || ry) this.source = "gamepad";
			// once the pad is in use it owns all four axes (keys switch back to the keyboard), so
			// a centred stick reads as centred rather than falling back to the keyboard lever
			if (this.source === "gamepad") {
				const t = -ly;
				// acro: stick centre = hover thrust; assisted: centre = hold altitude
				throttle = !acro
					? t
					: t >= 0
						? ACRO_HOVER + t * (1 - ACRO_HOVER)
						: ACRO_HOVER + t * (1 + ACRO_HOVER);
				yaw = lx;
				roll = rx;
				pitch = -ry;
			}
			const start = p.buttons[9]?.pressed === true;
			if (start && !this.padStart) this.presses.add("Enter");
			this.padStart = start;
			break;
		}
		out.throttle = quantize(throttle);
		out.yaw = quantize(yaw);
		out.pitch = quantize(pitch);
		out.roll = quantize(roll);
	}
}
