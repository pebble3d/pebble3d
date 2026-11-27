/** Keyboard state: held keys and presses since the last `took`. */
import { IN } from "./input.ts";

const P1: Record<string, number> = {
	KeyW: IN.UP,
	KeyA: IN.LEFT,
	KeyS: IN.DOWN,
	KeyD: IN.RIGHT,
	KeyJ: IN.GRIP,
	KeyK: IN.BREATHE,
	KeyL: IN.POSTURE,
};
const P2: Record<string, number> = {
	ArrowUp: IN.UP,
	ArrowLeft: IN.LEFT,
	ArrowDown: IN.DOWN,
	ArrowRight: IN.RIGHT,
	Numpad1: IN.GRIP,
	Numpad2: IN.BREATHE,
	Numpad3: IN.POSTURE,
	// laptops without a numpad
	Comma: IN.GRIP,
	Period: IN.BREATHE,
	Slash: IN.POSTURE,
};

export class Keys {
	private readonly held = new Set<string>();
	private readonly pressed = new Set<string>();
	/** Set by the app while a roll (or the tutorial) is on screen. */
	rollOn = false;

	constructor() {
		window.addEventListener("keydown", (e) => {
			// during a roll, every key either player uses is the game's (`/` would open
			// Firefox's quick find, arrows would scroll)
			if (this.rollOn && (e.code in P1 || e.code in P2)) e.preventDefault();
			else if (e.code.startsWith("Arrow") || e.code === "Space")
				e.preventDefault();
			if (e.repeat) return;
			this.held.add(e.code);
			this.pressed.add(e.code);
		});
		window.addEventListener("keyup", (e) => this.held.delete(e.code));
		window.addEventListener("blur", () => this.held.clear());
	}

	/** The input byte for player 1 (WASD JKL) or player 2 (arrows, numpad 1/2/3). */
	sample(player: 1 | 2): number {
		const map = player === 1 ? P1 : P2;
		let b = 0;
		for (const code of this.held) b |= map[code] ?? 0;
		// a press shorter than a frame still counts for one tick
		for (const code of this.pressed) b |= map[code] ?? 0;
		return b;
	}

	took(code: string): boolean {
		if (!this.pressed.has(code)) return false;
		this.pressed.delete(code);
		return true;
	}

	/** Called once per frame after input is consumed. */
	endFrame(): void {
		this.pressed.clear();
	}
}
