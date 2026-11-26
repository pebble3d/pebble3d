import { describe, expect, it } from "vitest";
import { DEFAULT_REACH, poseDir, samplePose } from "../src/game/combat/pose.ts";
import { MOVES } from "../src/game/config.ts";

describe("sword pose", () => {
	const keys = [
		[0, 0, 0, 0, 0],
		[10, 100, 50, -20, 40],
	];
	it("hits keys exactly and eases between them", () => {
		const out = new Float32Array(6);
		samplePose(keys, 10, out, null);
		expect(Array.from(out, (v) => Math.round(v * 1e4) / 1e4)).toEqual([
			100,
			50,
			-20,
			40,
			DEFAULT_REACH,
			1,
		]);
		samplePose(keys, 5, out, null);
		expect(out[0]).toBeCloseTo(50, 5);
		samplePose(keys, 2, out, null);
		expect(out[0]).toBeLessThan(20); // smoothstep starts slow
	});
	it("starts from the given pose instead of the first key", () => {
		const out = new Float32Array(6);
		const from = new Float32Array([40, 40, 40, 40, 0.3, 0]);
		samplePose(keys, 0, out, from);
		expect(Array.from(out, (v) => Math.round(v * 1e4) / 1e4)).toEqual([
			40, 40, 40, 40, 0.3, 0,
		]);
	});
	it("eases the optional reach and grip channels, defaulting missing ones", () => {
		const out = new Float32Array(6);
		const k = [
			[0, 0, 0, 0, 0, 0.3, 0],
			[10, 0, 0, 0, 0],
		];
		samplePose(k, 5, out, null);
		expect(out[4]).toBeCloseTo((0.3 + DEFAULT_REACH) / 2, 5);
		expect(out[5]).toBeCloseTo(0.5, 5);
	});
	it("yaw + turns toward the character's right (-X facing +Z), pitch + is up", () => {
		const d = { x: 0, y: 0, z: 0 };
		poseDir(90, 0, d);
		expect(d.x).toBeCloseTo(-1, 5);
		poseDir(0, 90, d);
		expect(d.y).toBeCloseTo(1, 5);
	});
	it("every shipped move's pose keys are frame-ordered within the move", () => {
		for (const m of MOVES.moves) {
			let prev = -1;
			for (const k of m.pose) {
				expect(k.length).toBeGreaterThanOrEqual(5);
				expect(k.length).toBeLessThanOrEqual(7);
				if (k[5] !== undefined) expect(k[5]).toBeGreaterThan(0.1);
				if (k[6] !== undefined) {
					expect(k[6]).toBeGreaterThanOrEqual(0);
					expect(k[6]).toBeLessThanOrEqual(1);
				}
				expect(k[0] as number).toBeGreaterThan(prev);
				expect(k[0] as number).toBeLessThanOrEqual(m.total);
				prev = k[0] as number;
			}
		}
	});
});
