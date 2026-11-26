import { describe, expect, it } from "vitest";
import { type ComboContext, ComboMachine } from "../src/game/combat/combo.ts";
import { parseMoves, type RawMoveFile } from "../src/game/combat/moves.ts";
import { MOVES } from "../src/game/config.ts";
import {
	BUFFER_FRAMES,
	FOCUS_HOLD_FRAMES,
	LINGER_FRAMES,
} from "../src/game/constants.ts";
import { BTN } from "../src/game/input.ts";

const ground: ComboContext = {
	grounded: true,
	focusFull: false,
	dodgeReady: true,
};
const air: ComboContext = {
	grounded: false,
	focusFull: false,
	dodgeReady: true,
};
const id = (name: string) => MOVES.byId.get(name) as number;

/** Drives the machine: `script[f]` = [pressed, held] for frame f (missing = nothing). */
function run(
	m: ComboMachine,
	frames: number,
	at: (f: number) => [number, number] = () => [0, 0],
	ctx: ComboContext = ground,
	start = 1,
): { started: [number, string][] } {
	const started: [number, string][] = [];
	for (let f = start; f < start + frames; f++) {
		const [p, h] = at(f);
		const s = m.update(p, h | p, f, ctx);
		if (s >= 0) started.push([f, MOVES.moves[s]?.id ?? "?"]);
	}
	return { started };
}

describe("ComboMachine", () => {
	it("light from idle starts light1 on the press frame", () => {
		const m = new ComboMachine(MOVES);
		const r = run(m, 3, (f) => (f === 1 ? [BTN.LIGHT, 0] : [0, 0]));
		expect(r.started).toEqual([[1, "light1"]]);
		expect(m.frame).toBe(2);
	});

	it("light x3 chains through light2 and light3 when pressed in the cancel windows", () => {
		const m = new ComboMachine(MOVES);
		const l1 = MOVES.moves[id("light1")];
		const c0 = l1?.cancel?.[0] ?? 0;
		// press light at frame 1, then again exactly when each cancel window opens
		const presses = new Set([1, 1 + c0, 1 + 2 * c0]);
		const r = run(m, 60, (f) => (presses.has(f) ? [BTN.LIGHT, 0] : [0, 0]));
		expect(r.started.map((s) => s[1])).toEqual(["light1", "light2", "light3"]);
	});

	it("a press before the cancel window is buffered and fires when the window opens", () => {
		const m = new ComboMachine(MOVES);
		const c0 = MOVES.moves[id("light1")]?.cancel?.[0] ?? 0;
		const early = 1 + c0 - 5; // 5 frames early: inside the 9-frame buffer
		const r = run(m, 40, (f) =>
			f === 1 || f === early ? [BTN.LIGHT, 0] : [0, 0],
		);
		expect(r.started).toEqual([
			[1, "light1"],
			[1 + c0, "light2"],
		]);
	});

	it("a press older than the buffer is dropped", () => {
		const m = new ComboMachine(MOVES);
		const c0 = MOVES.moves[id("heavy")]?.cancel?.[0] ?? 0;
		const tooEarly = 1 + c0 - (BUFFER_FRAMES + 1);
		expect(tooEarly).toBeGreaterThan(1);
		const r = run(m, 40, (f) =>
			f === 1 ? [BTN.HEAVY, 0] : f === tooEarly ? [BTN.LIGHT, 0] : [0, 0],
		);
		expect(r.started).toEqual([[1, "heavy"]]);
		const m2 = new ComboMachine(MOVES);
		const r2 = run(m2, 40, (f) =>
			f === 1 ? [BTN.HEAVY, 0] : f === tooEarly + 2 ? [BTN.LIGHT, 0] : [0, 0],
		);
		expect(r2.started.map((s) => s[1])).toEqual(["heavy", "light1"]);
	});

	it("L, L, H routes into the launcher", () => {
		const m = new ComboMachine(MOVES);
		const c0 = MOVES.moves[id("light1")]?.cancel?.[0] ?? 0;
		const r = run(m, 60, (f) => {
			if (f === 1 || f === 1 + c0) return [BTN.LIGHT, 0];
			if (f === 1 + 2 * c0) return [BTN.HEAVY, 0];
			return [0, 0];
		});
		expect(r.started.map((s) => s[1])).toEqual([
			"light1",
			"light2",
			"launcher",
		]);
	});

	it("a heavy press during light1 outside the window does nothing", () => {
		const m = new ComboMachine(MOVES);
		const r = run(m, 8, (f) =>
			f === 1 ? [BTN.LIGHT, 0] : f === 3 ? [BTN.HEAVY, 0] : [0, 0],
		);
		expect(r.started).toEqual([[1, "light1"]]);
	});

	it("after a move ends its follow-ups stay open for the linger window", () => {
		const m = new ComboMachine(MOVES);
		const total = MOVES.moves[id("light1")]?.total ?? 0;
		const late = 1 + total + LINGER_FRAMES - 2;
		const r = run(m, 80, (f) =>
			f === 1 || f === late ? [BTN.LIGHT, 0] : [0, 0],
		);
		expect(r.started.map((s) => s[1])).toEqual(["light1", "light2"]);
		const m2 = new ComboMachine(MOVES);
		const tooLate = 1 + total + LINGER_FRAMES + 3;
		const r2 = run(m2, 90, (f) =>
			f === 1 || f === tooLate ? [BTN.LIGHT, 0] : [0, 0],
		);
		expect(r2.started.map((s) => s[1])).toEqual(["light1", "light1"]);
	});

	it("a tapped heavy plays the normal cleave; a held heavy charges into the charged cleave", () => {
		const tap = new ComboMachine(MOVES);
		const r1 = run(tap, 50, (f) => (f === 1 ? [BTN.HEAVY, 0] : [0, 0]));
		expect(r1.started.map((s) => s[1])).toEqual(["heavy"]);

		const hold = new ComboMachine(MOVES);
		const ch = MOVES.moves[id("heavy")]?.charge;
		const releaseAt = 1 + (ch?.at ?? 0) + (ch?.min ?? 0) + 2;
		const r2 = run(hold, 80, (f) =>
			f === 1 ? [BTN.HEAVY, 0] : f < releaseAt ? [0, BTN.HEAVY] : [0, 0],
		);
		expect(r2.started.map((s) => s[1])).toEqual(["heavy", "heavyCharged"]);
	});

	it("a heavy held past max charge releases automatically", () => {
		const m = new ComboMachine(MOVES);
		const r = run(m, 120, (f) => (f === 1 ? [BTN.HEAVY, 0] : [0, BTN.HEAVY]));
		expect(r.started.map((s) => s[1])).toEqual(["heavy", "heavyCharged"]);
	});

	it("heavy while airborne is the plunge, which holds its frame until grounded", () => {
		const m = new ComboMachine(MOVES);
		const r = run(m, 30, (f) => (f === 1 ? [BTN.HEAVY, 0] : [0, 0]), air);
		expect(r.started.map((s) => s[1])).toEqual(["plunge"]);
		const holdAt = MOVES.moves[id("plunge")]?.hold?.at;
		expect(m.frame).toBe(holdAt);
		run(m, 3, undefined, ground, 40);
		expect(m.frame).toBe((holdAt ?? 0) + 3);
	});

	it("dodge then light is the dash-slash", () => {
		const m = new ComboMachine(MOVES);
		const c0 = MOVES.moves[id("dodge")]?.cancel?.[0] ?? 0;
		const r = run(m, 30, (f) =>
			f === 1 ? [BTN.DODGE, 0] : f === 1 + c0 ? [BTN.LIGHT, 0] : [0, 0],
		);
		expect(r.started.map((s) => s[1])).toEqual(["dodge", "dashSlash"]);
	});

	it("dodge waits for the move's dodge-cancel frame and respects the cooldown flag", () => {
		const m = new ComboMachine(MOVES);
		const dc = MOVES.moves[id("light1")]?.dodgeCancel ?? 0;
		const r = run(m, 30, (f) =>
			f === 1 ? [BTN.LIGHT, 0] : f === 3 ? [BTN.DODGE, 0] : [0, 0],
		);
		// pressed at frame 3 (light1 frame 2): buffered until frame dc if that is within the buffer
		const expectAt = 1 + dc;
		if (expectAt - 3 <= BUFFER_FRAMES)
			expect(r.started).toEqual([
				[1, "light1"],
				[expectAt, "dodge"],
			]);
		const cd = new ComboMachine(MOVES);
		const r2 = run(cd, 10, (f) => (f === 1 ? [BTN.DODGE, 0] : [0, 0]), {
			...ground,
			dodgeReady: false,
		});
		expect(r2.started).toEqual([]);
	});

	it("dodge frames are invulnerable, then vulnerable", () => {
		const m = new ComboMachine(MOVES);
		const iv = MOVES.moves[id("dodge")]?.iframes ?? [0, 0];
		run(m, 1, () => [BTN.DODGE, 0]);
		const seen: boolean[] = [];
		for (let f = 2; f < 25; f++) {
			seen.push(m.invulnerable());
			m.update(0, 0, f, ground);
		}
		// frame 0 at f=1, so seen[k] is move frame k+... after the first update the frame is 1
		expect(seen.slice(0, iv[1] - 1).every(Boolean)).toBe(true);
		expect(seen.slice(iv[1]).some(Boolean)).toBe(false);
	});

	it("holding focus at full Focus starts Spin Storm, and not before the hold time", () => {
		const m = new ComboMachine(MOVES);
		const full = { ...ground, focusFull: true };
		const r = run(m, FOCUS_HOLD_FRAMES - 1, () => [0, BTN.FOCUS], full);
		expect(r.started).toEqual([]);
		const r2 = run(m, 2, () => [0, BTN.FOCUS], full, 50);
		expect(r2.started.map((s) => s[1])).toEqual(["spinStorm"]);
		const empty = new ComboMachine(MOVES);
		const r3 = run(empty, 30, () => [0, BTN.FOCUS], ground);
		expect(r3.started).toEqual([]);
	});

	it("interrupt clears the move and the buffer", () => {
		const m = new ComboMachine(MOVES);
		run(m, 3, (f) =>
			f === 1 ? [BTN.LIGHT, 0] : f === 2 ? [BTN.LIGHT, 0] : [0, 0],
		);
		expect(m.buffered).toBe(1);
		m.interrupt();
		expect(m.move).toBe(-1);
		expect(m.buffered).toBe(0);
	});
});

describe("parseMoves", () => {
	it("rejects unknown follow-up references", () => {
		const raw = {
			rest: [0, 0, 0, 0],
			moves: {
				light1: {
					name: "a",
					total: 10,
					hits: [],
					pose: [[0, 0, 0, 0, 0]],
					next: { light: "nope" },
				},
			},
		} as unknown as RawMoveFile;
		expect(() => parseMoves(raw)).toThrow(/unknown move "nope"/);
	});

	it("rejects hit windows outside the move", () => {
		const raw = {
			rest: [0, 0, 0, 0],
			moves: {
				light1: {
					name: "a",
					total: 10,
					hits: [{ at: 9, len: 5, shape: "circle", damage: 1 }],
					pose: [[0, 0, 0, 0, 0]],
				},
			},
		} as unknown as RawMoveFile;
		expect(() => parseMoves(raw)).toThrow(/hit window/);
	});

	it("the shipped move list has every required move", () => {
		for (const k of [
			"light1",
			"light2",
			"light3",
			"heavy",
			"heavyCharged",
			"launcher",
			"dashSlash",
			"plunge",
			"spinStorm",
			"dodge",
		])
			expect(MOVES.byId.has(k)).toBe(true);
	});
});
