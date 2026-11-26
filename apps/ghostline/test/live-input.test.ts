import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveInput } from "../src/game/live-input.ts";

/** Minimal window stand-in: LiveInput only adds key/blur listeners. */
class FakeWindow extends EventTarget {}

function key(type: "keydown" | "keyup", code: string): Event {
	const e = new Event(type) as Event & { code: string; repeat: boolean };
	e.code = code;
	e.repeat = false;
	return e;
}

describe("LiveInput one-shot keys", () => {
	const g = globalThis as { window?: unknown };
	let saved: unknown;
	beforeEach(() => {
		saved = g.window;
		g.window = new FakeWindow();
	});
	afterEach(() => {
		g.window = saved;
	});

	it("keys pressed in a race do not leak into the next screen once cleared", () => {
		const w = g.window as FakeWindow;
		const live = new LiveInput();
		for (const c of ["KeyW", "KeyD", "Space", "ArrowRight"]) {
			w.dispatchEvent(key("keydown", c));
			w.dispatchEvent(key("keyup", c));
		}
		// toTitle()/finishRun() clear the queue (I1); the title then sees nothing pending
		live.clearPressed();
		for (const c of ["KeyW", "KeyD", "Space", "ArrowRight", "Enter"])
			expect(live.took(c)).toBe(false);
		// a key pressed after the switch is still seen, exactly once
		w.dispatchEvent(key("keydown", "Enter"));
		expect(live.took("Enter")).toBe(true);
		expect(live.took("Enter")).toBe(false);
	});
});
