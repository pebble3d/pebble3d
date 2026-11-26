import { describe, expect, it } from "vitest";
import { parseScene, SceneError, type SceneInput } from "../src/schema.ts";

function pathOf(input: unknown): string {
	try {
		parseScene(input);
	} catch (e) {
		expect(e).toBeInstanceOf(SceneError);
		return (e as SceneError).path;
	}
	throw new Error("expected parseScene to throw");
}

describe("parseScene", () => {
	it("fills defaults for a minimal scene", () => {
		const s = parseScene({
			version: 1,
			entities: [{ id: "a", mesh: { primitive: "box" } }],
		});
		expect(s.environment.preset).toBe("outdoor");
		expect(s.sim.build).toBe("deterministic");
		expect(s.sim.seed).toBe(1);
		expect(s.sim.gravity).toBe(-9.81);
		expect(s.post.toneMapping).toBe("agx");
		expect(s.post.bloom.strength).toBe(0.3);
		expect(s.post.bloom.threshold).toBe(2);
		expect(s.post.ao.enabled).toBe(true);
		expect(s.prefabs).toEqual({});
		expect(s.entities).toHaveLength(1);
	});

	it("fills bounds defaults", () => {
		const s = parseScene({ bounds: { min: [-5, -5], max: [5, 5] } });
		expect(s.bounds).toEqual({
			min: [-5, -5],
			max: [5, 5],
			height: 4,
			thickness: 0.5,
		});
	});

	it("reports an unknown prefab", () => {
		expect(pathOf({ entities: [{ id: "a", prefab: "nope" }] })).toBe(
			"entities[0].prefab",
		);
	});

	it("reports a duplicate id at the second occurrence", () => {
		const input: SceneInput = {
			entities: [
				{ id: "a", mesh: { primitive: "box" } },
				{ id: "a", mesh: { primitive: "sphere" } },
			],
		};
		expect(pathOf(input)).toBe("entities[1].id");
	});

	it("reports a character on a box", () => {
		const input: SceneInput = {
			entities: [
				{
					id: "hero",
					mesh: { primitive: "box" },
					body: { type: "kinematic" },
					character: {},
				},
			],
		};
		expect(pathOf(input)).toBe("entities[0].character");
	});

	it("reports a character whose box comes from a prefab", () => {
		const input: SceneInput = {
			prefabs: {
				crate: { mesh: { primitive: "box" }, body: { type: "kinematic" } },
			},
			entities: [{ id: "hero", prefab: "crate", character: {} }],
		};
		expect(pathOf(input)).toBe("entities[0].character");
	});

	it("accepts a character on a kinematic capsule (explicit or auto)", () => {
		expect(() =>
			parseScene({
				entities: [
					{
						id: "a",
						character: {},
						body: {
							type: "kinematic",
							collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
						},
					},
					{
						id: "b",
						character: {},
						mesh: { primitive: "capsule" },
						transform: { scale: [0.6, 1.6, 0.6] },
						body: {},
					},
				],
			}),
		).not.toThrow();
	});

	it("reports a spawner with an unknown prefab", () => {
		const input: SceneInput = {
			entities: [
				{
					id: "rain",
					spawner: {
						prefab: "ball",
						rate: 4,
						count: 10,
						area: { min: [0, 5, 0], max: [1, 6, 1] },
					},
				},
			],
		};
		expect(pathOf(input)).toBe("entities[0].spawner.prefab");
	});

	it("maps plain zod errors to a SceneError path", () => {
		expect(
			pathOf({ entities: [{ id: "a", mesh: { primitive: "cone" } }] }),
		).toBe("entities[0].mesh.primitive");
		expect(pathOf({ sim: { build: "turbo" } })).toBe("sim.build");
	});

	it("SceneError carries the path in its message", () => {
		try {
			parseScene({ entities: [{ id: "a", prefab: "nope" }] });
		} catch (e) {
			expect(e).toBeInstanceOf(Error);
			expect((e as Error).name).toBe("SceneError");
			expect((e as Error).message).toContain("entities[0].prefab");
		}
	});

	it("rejects seeds above 2^32-1 with the seed path", () => {
		expect(pathOf({ sim: { seed: 2 ** 32 } })).toBe("sim.seed");
		expect(
			pathOf({
				prefabs: { p: { mesh: { primitive: "sphere" }, body: {} } },
				entities: [
					{
						id: "s",
						spawner: {
							prefab: "p",
							rate: 1,
							count: 1,
							area: { min: [0, 0, 0], max: [1, 1, 1] },
							seed: 2 ** 32,
						},
					},
				],
			}),
		).toBe("entities[0].spawner.seed");
	});
});

describe("gltf animation entries and look", () => {
	const scene = (gltf: Record<string, unknown>) => ({
		entities: [{ id: "h", mesh: { gltf: { url: "/a.glb", ...gltf } } }],
	});
	it("rejects bad entries", () => {
		expect(pathOf(scene({ animations: { walk: { clip: "" } } }))).toMatch(
			/^entities\[0\]\.mesh\.gltf\.animations/,
		);
		expect(() =>
			parseScene(scene({ animations: { walk: { clip: "W", speed: 0 } } })),
		).toThrow();
		expect(() => parseScene(scene({ look: { saturation: 3 } }))).toThrow();
	});
	it("accepts string and object entries and look", () => {
		expect(() =>
			parseScene(
				scene({
					animations: { idle: "I", walk: { clip: "W", speed: 1 } },
					look: { envIntensity: 0.5, saturation: 1 },
				}),
			),
		).not.toThrow();
	});
});
