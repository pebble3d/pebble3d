import { describe, expect, it } from "vitest";
import {
	aimAt,
	compositionScore,
	emptyScore,
	exposureScore,
	fillScore,
	focusScore,
	type PhotoCam,
	project,
	scorePhoto,
} from "../src/game/photo.ts";

function cam(over: Partial<PhotoCam> = {}): PhotoCam {
	return {
		x: 0,
		y: 1.5,
		z: 0,
		yaw: 0,
		pitch: 0,
		fovDeg: 50,
		focus: 4,
		ev: 0,
		...over,
	};
}

describe("project", () => {
	it("a point straight ahead lands in the frame centre at its distance", () => {
		const p = { u: 0, v: 0, depth: 0 };
		expect(project(cam(), 0, 1.5, -4, p)).toBe(true);
		expect(p.u).toBeCloseTo(0.5);
		expect(p.v).toBeCloseTo(0.5);
		expect(p.depth).toBeCloseTo(4);
	});
	it("right is +u, up is -v (yaw 0 looks down -Z)", () => {
		const p = { u: 0, v: 0, depth: 0 };
		project(cam(), 1, 2, -4, p);
		expect(p.u).toBeGreaterThan(0.5);
		expect(p.v).toBeLessThan(0.5);
	});
	it("follows yaw and pitch: aimAt centres any point", () => {
		const c = cam({ x: 2, z: 3 });
		const aim = { yaw: 0, pitch: 0 };
		aimAt(c.x, c.y, c.z, -1, 0.4, 7, aim);
		c.yaw = aim.yaw;
		c.pitch = aim.pitch;
		const p = { u: 0, v: 0, depth: 0 };
		expect(project(c, -1, 0.4, 7, p)).toBe(true);
		expect(p.u).toBeCloseTo(0.5);
		expect(p.v).toBeCloseTo(0.5);
		expect(p.depth).toBeCloseTo(Math.hypot(3, 1.1, 4));
	});
	it("points behind the camera are rejected", () => {
		expect(project(cam(), 0, 1.5, 3, { u: 0, v: 0, depth: 0 })).toBe(false);
	});
});

describe("criteria", () => {
	it("composition rewards thirds over centre over edges", () => {
		const thirds = compositionScore(1 / 3, 1 / 3);
		const centre = compositionScore(0.5, 0.5);
		const edge = compositionScore(0.03, 0.95);
		expect(thirds).toBeCloseTo(1);
		expect(centre).toBeGreaterThan(0.45);
		expect(centre).toBeLessThan(thirds);
		expect(edge).toBeLessThan(0.2);
	});
	it("fill peaks between a fifth and a half of the frame", () => {
		expect(fillScore(0.35)).toBe(1);
		expect(fillScore(0.02)).toBe(0);
		expect(fillScore(1.2)).toBe(0);
		expect(fillScore(0.12)).toBeGreaterThan(0);
		expect(fillScore(0.12)).toBeLessThan(1);
	});
	it("focus is forgiving within tolerance and harsh far off", () => {
		expect(focusScore(4.1, 4)).toBe(1);
		expect(focusScore(8, 4)).toBe(0);
	});
	it("exposure wants the subject's ideal", () => {
		expect(exposureScore(-2 / 3, -2 / 3)).toBe(1);
		expect(exposureScore(2, -2 / 3)).toBe(0);
	});
});

describe("scorePhoto", () => {
	const subject = { x: 0, y: 1.5, z: -4, r: 0.5, idealEv: 0 };
	it("a well-made photo scores three stars", () => {
		// Aim so the subject sits on the upper-left power point, zoomed to fill ~35%.
		const c = cam({ fovDeg: 40, focus: 4 });
		const tanH = Math.tan((c.fovDeg * Math.PI) / 360);
		c.yaw = -Math.atan(((1 / 3) * tanH * 16) / 9); // subject left of centre: look right
		c.pitch = -Math.atan((1 / 3) * tanH); // subject above centre: look down
		const s = scorePhoto(c, subject, false, emptyScore());
		expect(s.inFrame).toBe(true);
		expect(s.composition).toBeGreaterThan(0.9);
		expect(s.stars).toBe(3);
	});
	it("occlusion costs most of the score", () => {
		const c = cam({ fovDeg: 40 });
		const clear = scorePhoto(c, subject, false, emptyScore()).total;
		const hidden = scorePhoto(c, subject, true, emptyScore()).total;
		expect(hidden).toBeLessThan(clear * 0.5);
	});
	it("a subject outside the frame scores nothing", () => {
		const s = scorePhoto(cam({ yaw: Math.PI }), subject, false, emptyScore());
		expect(s.inFrame).toBe(false);
		expect(s.total).toBe(0);
	});
	it("a blurry, badly exposed snapshot rates lower than a careful one", () => {
		const sloppy = scorePhoto(
			cam({ focus: 15, ev: 2, fovDeg: 72 }),
			subject,
			false,
			emptyScore(),
		);
		expect(sloppy.stars).toBeLessThan(2);
	});
});
