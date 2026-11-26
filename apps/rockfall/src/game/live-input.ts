import { BTN, type TickInput } from "./input.ts";

/**
 * Keyboard (and click-to-start) input. The camera never yaws, so WASD maps straight onto
 * world axes: W = -Z (up the screen), D = +X. Held state is sampled once per tick.
 */
export class LiveInput {
	private readonly keys = new Set<string>();
	private click = false;

	constructor(canvas: HTMLCanvasElement) {
		window.addEventListener("keydown", (e) => {
			if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
			this.keys.add(e.code);
		});
		window.addEventListener("keyup", (e) => this.keys.delete(e.code));
		window.addEventListener("blur", () => this.keys.clear());
		canvas.addEventListener("pointerdown", () => {
			this.click = true;
		});
	}

	private down(...codes: string[]): boolean {
		for (const c of codes) if (this.keys.has(c)) return true;
		return false;
	}

	/** Writes this tick's input. `menu`: Space/Enter/click start a run instead of jumping. */
	sample(out: TickInput, menu: boolean): void {
		let x = 0;
		let z = 0;
		if (this.down("KeyW", "ArrowUp")) z -= 1;
		if (this.down("KeyS", "ArrowDown")) z += 1;
		if (this.down("KeyA", "ArrowLeft")) x -= 1;
		if (this.down("KeyD", "ArrowRight")) x += 1;
		const l = Math.hypot(x, z);
		out.mx = l > 0 ? x / l : 0;
		out.mz = l > 0 ? z / l : 0;
		let b = 0;
		const space = this.down("Space");
		if (menu) {
			if (space || this.down("Enter", "NumpadEnter") || this.click)
				b |= BTN.START;
		} else if (space) b |= BTN.JUMP;
		if (this.down("ShiftLeft", "ShiftRight")) b |= BTN.SPRINT;
		this.click = false;
		out.buttons = b;
	}
}
