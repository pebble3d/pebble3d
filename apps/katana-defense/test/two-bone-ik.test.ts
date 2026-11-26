import { Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { solveTwoBone } from "../src/game/view/two-bone-ik.ts";

const out = () => ({
	upperDir: new Vector3(),
	foreDir: new Vector3(),
	hinge: new Vector3(),
	elbow: new Vector3(),
});

describe("two-bone IK", () => {
	const root = new Vector3(0, 1.4, 0);
	it("reaches a reachable target with both segment lengths kept", () => {
		const t = new Vector3(0.2, 1.1, 0.3);
		const r = solveTwoBone(root, t, new Vector3(0, -1, 0), 0.28, 0.26, out());
		expect(r.elbow.distanceTo(root)).toBeCloseTo(0.28, 5);
		const wrist = r.elbow.clone().addScaledVector(r.foreDir, 0.26);
		expect(wrist.distanceTo(t)).toBeLessThan(1e-4);
	});
	it("bends the elbow toward the pole", () => {
		const t = new Vector3(0, 1.4, 0.4); // straight ahead
		const down = solveTwoBone(
			root,
			t,
			new Vector3(0, -1, 0),
			0.28,
			0.26,
			out(),
		);
		expect(down.elbow.y).toBeLessThan(1.4 - 0.05);
		const side = solveTwoBone(
			root,
			t,
			new Vector3(-1, 0, 0),
			0.28,
			0.26,
			out(),
		);
		expect(side.elbow.x).toBeLessThan(-0.05);
	});
	it("hinge is shared by both segments: foreDir x upperDir is along it", () => {
		const r = solveTwoBone(
			root,
			new Vector3(-0.1, 1.2, 0.35),
			new Vector3(-0.7, -0.7, 0),
			0.28,
			0.26,
			out(),
		);
		const c = new Vector3().crossVectors(r.upperDir, r.foreDir).normalize();
		// the bend rotates the upper direction into the fore direction about the hinge
		expect(c.dot(r.hinge)).toBeCloseTo(-1, 4);
		expect(r.hinge.dot(r.upperDir)).toBeCloseTo(0, 5);
		expect(r.hinge.dot(r.foreDir)).toBeCloseTo(0, 5);
	});
	it("clamps out-of-reach targets to a near-straight arm along the reach", () => {
		const t = new Vector3(0, 1.4, 2);
		const r = solveTwoBone(root, t, new Vector3(0, -1, 0), 0.28, 0.26, out());
		expect(r.upperDir.z).toBeGreaterThan(0.99);
		expect(r.foreDir.z).toBeGreaterThan(0.99);
	});
	it("survives a pole parallel to the reach and a target at the root", () => {
		const r = solveTwoBone(
			root,
			new Vector3(0, 1.0, 0),
			new Vector3(0, -1, 0),
			0.28,
			0.26,
			out(),
		);
		expect(Number.isFinite(r.elbow.x)).toBe(true);
		expect(r.hinge.length()).toBeCloseTo(1, 5);
		const z = solveTwoBone(
			root,
			root.clone(),
			new Vector3(0, -1, 0),
			0.28,
			0.26,
			out(),
		);
		expect(Number.isFinite(z.foreDir.x)).toBe(true);
	});
});
