import { describe, expect, it } from "vitest";
import { DOF_DEFAULTS, floorProxyViewZ } from "../src/index.ts";

describe("floorProxyViewZ (depth-of-field proxy for depthless splat pixels)", () => {
	it("a ray looking down hits the floor at its true view distance", () => {
		// Camera 1.5 m above the floor looking straight ahead, ray 45 degrees down:
		// view ray (0, -1, -1) in view space, world y -1. Hit after 1.5 m forward.
		expect(floorProxyViewZ(-1, -1, 1.5, 0, 30)).toBeCloseTo(-1.5);
	});
	it("a ray at or above the horizon gets the backdrop distance", () => {
		expect(floorProxyViewZ(-1, 0, 1.5, 0, 30)).toBe(-30);
		expect(floorProxyViewZ(-1, 0.2, 1.5, 0, 30)).toBe(-30);
	});
	it("a floor hit beyond the backdrop clamps to the backdrop", () => {
		expect(floorProxyViewZ(-1, -0.01, 1.5, 0, 30)).toBe(-30);
	});
	it("a camera below the floor never hits it", () => {
		expect(floorProxyViewZ(-1, -1, -0.5, 0, 30)).toBe(-30);
	});
	it("defaults are sane", () => {
		expect(DOF_DEFAULTS.backdrop).toBeGreaterThan(DOF_DEFAULTS.focus);
	});
});
