import { BTN, type PlayerInput, setStick } from "./input.ts";

const P1 = {
	up: ["KeyW"],
	down: ["KeyS"],
	left: ["KeyA"],
	right: ["KeyD"],
	dash: ["Space", "ShiftLeft"],
};
const P2 = {
	up: ["ArrowUp"],
	down: ["ArrowDown"],
	left: ["ArrowLeft"],
	right: ["ArrowRight"],
	dash: ["Enter", "NumpadEnter", "ShiftRight", "Slash", "Numpad0"],
};
type Layout = typeof P1;

/**
 * One shared keyboard, two players. The arena camera never turns, so a key maps to a fixed
 * WORLD direction (W / Up = away from the camera = -z). Gameplay keys never scroll the page.
 */
export class Keys {
	private readonly down = new Set<string>();
	private readonly pressed = new Set<string>();

	constructor() {
		window.addEventListener("keydown", (e) => {
			if (
				e.code === "Space" ||
				e.code.startsWith("Arrow") ||
				e.code === "Slash"
			)
				e.preventDefault();
			if (e.repeat) return;
			this.down.add(e.code);
			this.pressed.add(e.code);
		});
		window.addEventListener("keyup", (e) => this.down.delete(e.code));
		window.addEventListener("blur", () => this.down.clear());
	}

	/** True once per press. */
	took(code: string): boolean {
		return this.pressed.delete(code);
	}

	clearPressed(): void {
		this.pressed.clear();
	}

	private any(codes: string[]): boolean {
		for (const c of codes) if (this.down.has(c)) return true;
		return false;
	}

	sample(player: 1 | 2, out: PlayerInput): void {
		const L: Layout = player === 1 ? P1 : P2;
		const x = (this.any(L.right) ? 1 : 0) - (this.any(L.left) ? 1 : 0);
		const z = (this.any(L.down) ? 1 : 0) - (this.any(L.up) ? 1 : 0);
		setStick(out, x, z);
		out.buttons = this.any(L.dash) ? BTN.DASH : 0;
	}
}
