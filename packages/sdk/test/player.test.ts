// Task 9 automated stand-ins for the manual play checks: in the showcase scene the player
// cannot leave the bounds and pushes the crates, and the third-person spring arm (static-only
// rays, as wired in game.ts) ignores dynamic bodies but pulls in for static ones.
import { readFileSync } from "node:fs";
import { ThirdPersonController } from "@pebble3d/renderer";
import { PerspectiveCamera, Vector3 } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { expandScene } from "../src/expand.ts";
import { parseScene } from "../src/schema.ts";
import { loadSim, type SimHandle, StateViews } from "../src/sim.ts";
import type { EntityDescJson } from "../src/types.ts";

const bytes = readFileSync(
	new URL("../wasm/det/engine_core_det_bg.wasm", import.meta.url),
);
const showcase = () =>
	parseScene(
		JSON.parse(
			readFileSync(
				new URL(
					"../../../apps/playground/scenes/showcase.json",
					import.meta.url,
				),
				"utf8",
			),
		),
	);

async function showcaseSim() {
	const s = showcase();
	const x = expandScene(s);
	expect(x.pendingHulls).toEqual([]);
	const h = await loadSim("deterministic", bytes, {
		seed: s.sim.seed,
		gravity: s.sim.gravity,
	});
	const ids = h.spawnScene(x.sim);
	const player = ids.get("player") as number;
	return { s, h, ids, player };
}

const pos = (h: SimHandle, id: number) =>
	h.world.transformOf(id) as Float32Array;

/** Hold a world-space XZ direction (normalised by the sim) for `ticks` ticks. */
function hold(
	h: SimHandle,
	id: number,
	dx: number,
	dz: number,
	ticks: number,
	sprint = false,
) {
	for (let i = 0; i < ticks; i++) {
		h.world.setCharacterInput(id, dx, dz, false, sprint);
		h.world.step(1);
	}
}

describe("showcase player (sim)", () => {
	it("cannot leave the bounds: sprinting at each wall stops at wall - radius", async () => {
		const { s, h, player } = await showcaseSim();
		const r = 0.3;
		const [minX, minZ] = s.bounds?.min ?? [0, 0];
		const [maxX, maxZ] = s.bounds?.max ?? [0, 0];
		hold(h, player, -1, 0, 300, true); // along z=13.4 to the -X wall
		let p = pos(h, player);
		expect(p[0]).toBeGreaterThanOrEqual(minX + r - 0.001);
		expect(p[0]).toBeLessThan(minX + r + 0.05);
		hold(h, player, 0, 1, 120, true); // +Z wall
		p = pos(h, player);
		expect(p[2]).toBeLessThanOrEqual(maxZ - r + 0.001);
		expect(p[2]).toBeGreaterThan(maxZ - r - 0.05);
		hold(h, player, 0, -1, 200, true); // -Z wall
		p = pos(h, player);
		expect(p[2]).toBeGreaterThanOrEqual(minZ + r - 0.001);
		expect(p[2]).toBeLessThan(minZ + r + 0.05);
		hold(h, player, 1, 0, 400, true); // +X wall, past everything
		p = pos(h, player);
		expect(p[0]).toBeLessThanOrEqual(maxX - r + 0.001);
		// still on the ground, not climbed over anything
		expect(p[1]).toBeLessThan(1);
		h.world.free();
	});

	it("pushes the crates it walks into", async () => {
		const { h, ids, player } = await showcaseSim();
		const crate = ids.get("crate-00") as number;
		const before = Array.from(pos(h, crate));
		const p0 = pos(h, player);
		// toward the crate stacks, as the playground's `walk-into-crates` script; the human
		// walks at 1.5 m/s, so ~6.5 m takes ~260 ticks before the push starts
		hold(h, player, 8.3 - (p0[0] as number), 7.9 - (p0[2] as number), 360);
		const after = pos(h, crate);
		const moved = Math.hypot(
			(after[0] as number) - (before[0] as number),
			(after[2] as number) - (before[2] as number),
		);
		expect(moved).toBeGreaterThan(0.3);
		h.world.free();
	});
});

describe("third-person spring arm over the wasm raycast (static-only)", () => {
	const ball = (x: number, y: number, z: number, type: "dynamic" | "static") =>
		({
			name: `ball-${type}`,
			position: [x, y, z],
			rotation: [0, 0, 0, 1],
			body: {
				type,
				friction: 0.5,
				restitution: 0,
				linearDamping: 0,
				angularDamping: 0,
				ccd: false,
				collider: { shape: "sphere", radius: 0.4 },
			},
		}) satisfies EntityDescJson;

	async function arm(type: "dynamic" | "static") {
		const h = await loadSim("deterministic", bytes, { gravity: 0 });
		const v = new StateViews(h);
		const cam = new PerspectiveCamera(50, 1, 0.1, 100);
		const tpc = new ThirdPersonController(cam, (o, d, max) =>
			h.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, 1, 0)
				? (v.scratch[0] as number)
				: null,
		);
		tpc.yaw = 0;
		tpc.pitch = 0;
		// a ball on the arm, 2.5 m behind the pivot (camera side is +Z at yaw 0)
		h.spawnScene([{ sceneId: "ball", desc: ball(0, 1, 2.5, type) }]);
		h.world.step(1); // raycasts see the broad-phase as of the last step
		const target = new Vector3(0, 1, 0);
		tpc.update(target, 1 / 60);
		const d = cam.position.distanceTo(target);
		h.world.free();
		return { d, full: tpc.distance };
	}

	it("a dynamic ball on the arm does not pop the camera", async () => {
		const { d, full } = await arm("dynamic");
		expect(d).toBeCloseTo(full, 5);
	});

	it("a static ball on the arm pulls it in (2.5 - 0.4 - 0.2 padding)", async () => {
		const { d } = await arm("static");
		expect(d).toBeCloseTo(1.9, 3);
	});
});
