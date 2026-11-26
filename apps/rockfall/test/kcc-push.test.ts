import { describe, expect, it } from "vitest";
import { nodeFactory } from "./helpers.ts";

describe("engine KCC", () => {
	it("pushes the dynamic rocks it walks into", async () => {
		const h = (await nodeFactory())(1);
		const w = h.world;
		w.spawn(
			JSON.stringify({
				body: { type: "static", collider: { shape: "plane" } },
			}),
		);
		const player = w.spawn(
			JSON.stringify({
				position: [0, 0.95, 0],
				body: {
					type: "kinematic",
					mass: 110,
					collider: { shape: "capsule", halfHeight: 0.55, radius: 0.38 },
				},
				character: { speed: 5 },
			}),
		);
		const rocks: number[] = [];
		for (let i = 0; i < 6; i++)
			rocks.push(
				w.spawn(
					JSON.stringify({
						position: [1.5 + i * 0.45, 0.25, (i % 2) * 0.3 - 0.15],
						body: {
							type: "dynamic",
							mass: 2,
							collider: { shape: "sphere", radius: 0.2 },
						},
					}),
				),
			);
		w.step(30);
		const x0 = rocks.map((id) => w.transformOf(id)?.[0] ?? 0);
		for (let t = 0; t < 90; t++) {
			w.setCharacterInput(player, 1, 0, false, false);
			w.step(1);
		}
		const moved = rocks.filter(
			(id, i) => (w.transformOf(id)?.[0] ?? 0) - (x0[i] as number) > 0.3,
		);
		expect(moved.length).toBeGreaterThanOrEqual(3);
		expect(w.transformOf(player)?.[0] ?? 0).toBeGreaterThan(3);
		w.free();
	});
});
