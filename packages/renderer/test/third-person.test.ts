import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
	springArmDistance,
	ThirdPersonController,
} from "../src/controllers/third-person.ts";

describe("springArmDistance", () => {
	it("no hit keeps the desired distance", () => {
		expect(springArmDistance(4, null)).toBe(4);
	});
	it("a hit pulls in to the hit minus padding", () => {
		expect(springArmDistance(4, 2)).toBeCloseTo(1.8, 10);
	});
	it("never goes below the minimum", () => {
		expect(springArmDistance(4, 0.3)).toBe(0.5);
	});
	it("a hit beyond the desired distance changes nothing", () => {
		expect(springArmDistance(4, 9)).toBe(4);
	});
});

describe("ThirdPersonController", () => {
	it("pulls the camera in to the stub raycast hit (1.0 -> 0.8)", () => {
		const cam = new PerspectiveCamera(50, 1, 0.1, 100);
		const tpc = new ThirdPersonController(cam, () => 1.0);
		const target = new Vector3(2, 1, -3);
		tpc.update(target, 1 / 60);
		expect(cam.position.distanceTo(target)).toBeCloseTo(0.8, 5);
	});

	it("without a hit sits at the full arm length, looking at the target", () => {
		const cam = new PerspectiveCamera(50, 1, 0.1, 100);
		const tpc = new ThirdPersonController(cam, () => null);
		const target = new Vector3(0, 1, 0);
		tpc.update(target, 1 / 60);
		expect(cam.position.distanceTo(target)).toBeCloseTo(tpc.distance, 5);
		const fwd = cam.getWorldDirection(new Vector3());
		const toTarget = target.clone().sub(cam.position).normalize();
		expect(fwd.dot(toTarget)).toBeCloseTo(1, 5);
	});

	it("yaw 0 puts the camera on +Z of the target (looking down -Z)", () => {
		const cam = new PerspectiveCamera(50, 1, 0.1, 100);
		const tpc = new ThirdPersonController(cam, () => null);
		tpc.yaw = 0;
		tpc.update(new Vector3(), 1 / 60);
		expect(cam.position.z).toBeGreaterThan(0);
		expect(Math.abs(cam.position.x)).toBeLessThan(1e-6);
	});

	it("casts from the target toward the camera, max = arm length", () => {
		const cam = new PerspectiveCamera(50, 1, 0.1, 100);
		const calls: { o: Vector3; d: Vector3; max: number }[] = [];
		const tpc = new ThirdPersonController(cam, (o, d, max) => {
			calls.push({ o: o.clone(), d: d.clone(), max });
			return null;
		});
		const target = new Vector3(1, 2, 3);
		tpc.update(target, 1 / 60);
		expect(calls).toHaveLength(1);
		const c = calls[0];
		expect(c?.o.distanceTo(target)).toBeCloseTo(0, 6);
		expect(c?.d.length()).toBeCloseTo(1, 6);
		expect(c?.max).toBeCloseTo(tpc.distance, 6);
		const toCam = cam.position.clone().sub(target).normalize();
		expect(c?.d.dot(toCam)).toBeCloseTo(1, 6);
	});

	it("clamps pitch", () => {
		const cam = new PerspectiveCamera(50, 1, 0.1, 100);
		const tpc = new ThirdPersonController(cam, () => null);
		tpc.pitch = -10;
		tpc.update(new Vector3(), 1 / 60);
		expect(tpc.pitch).toBeGreaterThan(-Math.PI / 2);
		tpc.pitch = 10;
		tpc.update(new Vector3(), 1 / 60);
		expect(tpc.pitch).toBeLessThan(Math.PI / 2);
	});
});
