import { BTN, type TickInput } from "./sim.ts";

/** Keyboard -> TickInput. Screen up (W) is world -z: the camera looks north. */
export class LiveInput {
	private readonly down = new Set<string>();
	/** Set on N; main reloads into the next keep. */
	newKeep = false;

	constructor() {
		window.addEventListener("keydown", (e) => {
			this.down.add(e.code);
			if (e.code === "KeyN") this.newKeep = true;
			if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
		});
		window.addEventListener("keyup", (e) => this.down.delete(e.code));
		window.addEventListener("blur", () => this.down.clear());
	}

	private has(a: string, b: string, c = ""): boolean {
		const d = this.down;
		return d.has(a) || d.has(b) || (c !== "" && d.has(c));
	}

	sample(out: TickInput): void {
		let x = 0;
		let z = 0;
		if (this.has("KeyW", "ArrowUp")) z -= 1;
		if (this.has("KeyS", "ArrowDown")) z += 1;
		if (this.has("KeyA", "ArrowLeft")) x -= 1;
		if (this.has("KeyD", "ArrowRight")) x += 1;
		const len = Math.hypot(x, z) || 1;
		out.mx = Math.round((x / len) * 127);
		out.mz = Math.round((z / len) * 127);
		out.buttons = 0;
		if (this.has("ShiftLeft", "ShiftRight")) out.buttons |= BTN.SPRINT;
		if (this.has("Enter", "NumpadEnter", "Space")) out.buttons |= BTN.START;
	}
}
