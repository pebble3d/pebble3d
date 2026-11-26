import { describe, expect, it } from "vitest";
import { cameraRelativeInput } from "../src/input.ts";

const none = { f: false, b: false, l: false, r: false };

describe("cameraRelativeInput", () => {
	it("forward at yaw 0 is -Z", () => {
		const out = new Float32Array(2);
		cameraRelativeInput({ ...none, f: true }, 0, out);
		expect(out[0]).toBeCloseTo(0, 6);
		expect(out[1]).toBeCloseTo(-1, 6);
	});

	it("forward at yaw pi/2 is -X", () => {
		const out = new Float32Array(2);
		cameraRelativeInput({ ...none, f: true }, Math.PI / 2, out);
		expect(out[0]).toBeCloseTo(-1, 6);
		expect(out[1]).toBeCloseTo(0, 6);
	});

	it("diagonal forward+right is normalised to length 1", () => {
		const out = new Float32Array(2);
		cameraRelativeInput({ ...none, f: true, r: true }, 0.7, out);
		expect(Math.hypot(out[0] ?? 0, out[1] ?? 0)).toBeCloseTo(1, 6);
		cameraRelativeInput({ ...none, f: true, r: true }, 0, out);
		expect(out[0]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(out[1]).toBeCloseTo(-Math.SQRT1_2, 6);
	});

	it("no keys (or opposing keys) gives [0,0]", () => {
		const out = new Float32Array([5, 5]);
		cameraRelativeInput(none, 1.2, out);
		expect(out[0]).toBe(0);
		expect(out[1]).toBe(0);
		cameraRelativeInput({ f: true, b: true, l: true, r: true }, 1.2, out);
		expect(out[0]).toBe(0);
		expect(out[1]).toBe(0);
	});
});
