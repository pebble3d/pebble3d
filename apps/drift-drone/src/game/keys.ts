/** Edge-triggered key presses (DOM-free, so the screen rules are testable in Node). */
export class PressQueue {
	private readonly codes = new Set<string>();

	add(code: string): void {
		this.codes.add(code);
	}

	/** True once per press of `code`. */
	took(code: string): boolean {
		return this.codes.delete(code);
	}

	clear(): void {
		this.codes.clear();
	}

	get size(): number {
		return this.codes.size;
	}
}

export type Screen = "title" | "race" | "photo" | "results";

export type KeyAction =
	| "camera"
	| "nextTrack"
	| "prevTrack"
	| "toggleMode"
	| "start"
	| "title"
	| "restart"
	| "skip";

/**
 * This frame's menu actions on `screen`, written into `out`. Every press the screen does not
 * use is dropped (the queue is always empty afterwards), so a key pressed during a race (Space
 * eases the acro throttle, Enter is the pad's Start) can never act later on the photo finish or
 * the results screen.
 */
export function screenActions(
	screen: Screen,
	q: PressQueue,
	out: KeyAction[],
): KeyAction[] {
	out.length = 0;
	if (q.took("KeyC")) out.push("camera");
	if (screen === "title") {
		if (q.took("Tab") || q.took("ArrowRight")) out.push("nextTrack");
		if (q.took("ArrowLeft")) out.push("prevTrack");
		if (q.took("KeyM") || q.took("ArrowUp") || q.took("ArrowDown"))
			out.push("toggleMode");
		if (q.took("Enter") || q.took("Space")) out.push("start");
	} else if (q.took("Escape")) out.push("title");
	else if (q.took("KeyR")) out.push("restart");
	else if (screen === "results" && (q.took("Enter") || q.took("Space")))
		out.push("start");
	else if (screen === "photo" && q.took("Enter")) out.push("skip");
	q.clear();
	return out;
}
