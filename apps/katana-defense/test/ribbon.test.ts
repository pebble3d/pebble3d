import { MeshBasicMaterial, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { Ribbon, type RibbonOptions } from "../src/game/view/ribbon.ts";

const OPTS: RibbonOptions = {
	segments: 8,
	length: 0.5,
	width: 0.05,
	tipWidth: 0.03,
	gravity: 9,
	damping: 0.97,
	rootStiffness: 0.12,
	flutter: 0,
	flutterHz: 1,
};
const tip = (r: Ribbon): Vector3 => {
	const p = (r as unknown as { pos: Float32Array }).pos;
	const n = p.length / 3 - 1;
	return new Vector3(p[n * 3], p[n * 3 + 1], p[n * 3 + 2]);
};

describe("Ribbon", () => {
	it("hangs below a still anchor and keeps its length", () => {
		const r = new Ribbon(new MeshBasicMaterial(), OPTS);
		const a = new Vector3(0, 1, 0);
		const side = new Vector3(1, 0, 0);
		const dir = new Vector3(0, 0, -1);
		for (let i = 0; i < 240; i++) r.update(1 / 60, a, side, dir);
		const t = tip(r);
		expect(t.y).toBeLessThan(a.y - 0.4);
		expect(t.distanceTo(a)).toBeLessThanOrEqual(0.5 + 1e-3);
	});

	it("trails behind a moving anchor", () => {
		const r = new Ribbon(new MeshBasicMaterial(), OPTS);
		const a = new Vector3(0, 1, 0);
		const side = new Vector3(0, 0, 1);
		const down = new Vector3(0, -1, 0);
		for (let i = 0; i < 60; i++) {
			a.x += 4 / 60;
			r.update(1 / 60, a, side, down);
		}
		expect(tip(r).x).toBeLessThan(a.x - 0.1);
	});

	it("stays outside colliders", () => {
		const r = new Ribbon(new MeshBasicMaterial(), OPTS);
		const c = { center: new Vector3(0, 0.7, 0.02), radius: 0.15 };
		r.colliders = [c];
		const a = new Vector3(0, 1, 0);
		for (let i = 0; i < 240; i++)
			r.update(1 / 60, a, new Vector3(1, 0, 0), new Vector3(0, -1, 0));
		const p = (r as unknown as { pos: Float32Array }).pos;
		for (let i = 1; i < p.length / 3; i++) {
			const q = new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
			expect(q.distanceTo(c.center)).toBeGreaterThan(0.15 - 0.02);
		}
		expect(tip(r).y).toBeLessThan(0.75);
	});
});

describe("Ribbon frame-rate independence", () => {
	const rootStretch = (hz: number, speed: number): number => {
		const r = new Ribbon(new MeshBasicMaterial(), OPTS);
		const a = new Vector3(0, 1, 0);
		const side = new Vector3(0, 0, 1);
		const down = new Vector3(0, -1, 0);
		const p = (r as unknown as { pos: Float32Array }).pos;
		let worst = 0;
		for (let i = 0; i < hz * 2; i++) {
			a.x += speed / hz;
			r.update(1 / hz, a, side, down);
			const d = Math.hypot(
				(p[3] as number) - (p[0] as number),
				(p[4] as number) - (p[1] as number),
				(p[5] as number) - (p[2] as number),
			);
			worst = Math.max(worst, d / (OPTS.length / OPTS.segments));
		}
		return worst;
	};

	it("keeps the root segment near its length at 144 Hz and at 30 Hz", () => {
		expect(rootStretch(144, 4.2)).toBeLessThan(1.1);
		expect(rootStretch(30, 13)).toBeLessThan(1.1);
	});

	it("a 13 m/s dash at 20 fps is motion, not a teleport", () => {
		const r = new Ribbon(new MeshBasicMaterial(), OPTS);
		const a = new Vector3(0, 1, 0);
		const s = new Vector3(0, 0, 1);
		const d = new Vector3(0, -1, 0);
		for (let i = 0; i < 20; i++) r.update(1 / 20, a, s, d);
		const t0 = (r as unknown as { time: number }).time;
		a.x += 13 / 20;
		r.update(1 / 20, a, s, d);
		// a reset would add 90 settle steps (0.75 s) to the cloth clock (frames clamp at 1/30 s)
		expect((r as unknown as { time: number }).time - t0).toBeLessThan(0.06);
		expect(tip(r).x).toBeLessThan(a.x);
	});
});
