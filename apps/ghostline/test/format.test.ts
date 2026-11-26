import { describe, expect, it } from "vitest";
import { fmtDelta, fmtTime } from "../src/game/ui/hud.ts";

describe("HUD formatting", () => {
	it("formats clock times as m:ss.cc", () => {
		expect(fmtTime(0)).toBe("0:00.00");
		expect(fmtTime(30.539)).toBe("0:30.53");
		expect(fmtTime(61.005)).toBe("1:01.00");
		expect(fmtTime(-1)).toBe("--:--.--");
	});
	it("signs deltas and never prints a negative zero", () => {
		expect(fmtDelta(-0.4)).toBe("−0.40");
		expect(fmtDelta(0.031)).toBe("+0.03");
		expect(fmtDelta(-0.004)).toBe("±0.00");
		expect(fmtDelta(0.004)).toBe("±0.00");
	});
});
