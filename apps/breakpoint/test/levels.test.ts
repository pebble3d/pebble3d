import { describe, expect, it } from "vitest";
import { KINDS } from "../src/game/blocks.ts";
import { LEVELS } from "../src/game/levels.ts";

/** Axis-aligned overlap test for yaw 0 / 90 degree boxes (all generated blocks but drums). */
function aabb(b: {
	kind: number;
	x: number;
	y: number;
	z: number;
	yaw: number;
}) {
	const h = (KINDS[b.kind] as { half: number[] }).half as [
		number,
		number,
		number,
	];
	const q = Math.abs(Math.sin(b.yaw)) > 0.7;
	const hx = q ? h[2] : h[0];
	const hz = q ? h[0] : h[2];
	return [b.x - hx, b.y - h[1], b.z - hz, b.x + hx, b.y + h[1], b.z + hz];
}

describe("levels", () => {
	it("are deterministic per seed and differ across seeds", () => {
		for (const l of LEVELS) {
			expect(l.build(5)).toEqual(l.build(5));
			expect(l.build(5)).not.toEqual(l.build(6));
		}
	});

	it("every level has 800+ blocks and the run has 3000+", () => {
		let total = 0;
		for (const l of LEVELS) {
			const n = l.build(1).length;
			expect(n).toBeGreaterThanOrEqual(800);
			total += n;
		}
		expect(total).toBeGreaterThanOrEqual(3000);
		expect(LEVELS[0]?.build(1).length).toBeGreaterThanOrEqual(1000);
	});

	it("no two blocks interpenetrate and none sits below the ground", () => {
		for (const l of LEVELS) {
			const bs = l.build(3).filter((b) => Math.abs(Math.sin(b.yaw * 2)) < 1e-6);
			const boxes = bs.map(aabb);
			for (const b of boxes) expect(b[1]).toBeGreaterThanOrEqual(-1e-6);
			for (let i = 0; i < boxes.length; i++)
				for (let j = i + 1; j < boxes.length; j++) {
					const a = boxes[i] as number[];
					const c = boxes[j] as number[];
					const ox =
						Math.min(a[3] as number, c[3] as number) -
						Math.max(a[0] as number, c[0] as number);
					const oy =
						Math.min(a[4] as number, c[4] as number) -
						Math.max(a[1] as number, c[1] as number);
					const oz =
						Math.min(a[5] as number, c[5] as number) -
						Math.max(a[2] as number, c[2] as number);
					const overlap = ox > 1e-4 && oy > 1e-4 && oz > 1e-4;
					if (overlap) throw new Error(`${l.id}: blocks ${i} and ${j} overlap`);
				}
		}
	});
});
