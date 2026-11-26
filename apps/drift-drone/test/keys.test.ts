import { describe, expect, it } from "vitest";
import { quantize } from "../src/game/input.ts";
import { type KeyAction, PressQueue, screenActions } from "../src/game/keys.ts";

describe("menu keys", () => {
	it("a press made during the race never acts on the photo finish or results", () => {
		const q = new PressQueue();
		const out: KeyAction[] = [];
		// acro pilots tap Space (ease to hover); a pad's Start arrives as Enter
		q.add("Space");
		q.add("Enter");
		expect(screenActions("race", q, out)).toEqual([]);
		expect(q.size).toBe(0);
		expect(screenActions("photo", q, out)).toEqual([]);
		expect(screenActions("results", q, out)).toEqual([]);
		// a fresh press on the results screen does start the next race
		q.add("Enter");
		expect(screenActions("results", q, out)).toEqual(["start"]);
	});

	it("each screen takes only its own keys", () => {
		const q = new PressQueue();
		const out: KeyAction[] = [];
		q.add("Tab");
		q.add("KeyM");
		q.add("Enter");
		expect(screenActions("title", q, out)).toEqual([
			"nextTrack",
			"toggleMode",
			"start",
		]);
		q.add("Enter");
		expect(screenActions("photo", q, out)).toEqual(["skip"]);
		q.add("KeyR");
		q.add("KeyC");
		expect(screenActions("race", q, out)).toEqual(["camera", "restart"]);
		q.add("Tab");
		expect(screenActions("race", q, out)).toEqual([]);
		expect(q.size).toBe(0);
	});
});

describe("quantize", () => {
	it("clamps to int8 and maps NaN (a faulty pad axis) to 0", () => {
		expect(quantize(2)).toBe(127);
		expect(quantize(-2)).toBe(-127);
		expect(quantize(0.5)).toBe(64);
		expect(quantize(Number.NaN)).toBe(0);
	});
});
