import { describe, expect, it } from "vitest";
import { importText, locatePaths } from "../src/garden/validate.ts";

describe("import validation", () => {
	it("reports a JSON syntax error with a line and column", () => {
		const r = importText('{\n  "version": 1,\n  "entities": [,]\n}');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.stage).toBe("json");
		expect(r.issues[0]?.line).toBe(3);
		expect(r.issues[0]?.message).toMatch(/not valid JSON/);
	});

	it("hints at trailing commas", () => {
		const r = importText('{"version": 1, "entities": [],}');
		expect(!r.ok && r.issues[0]?.hint).toMatch(/trailing comma/);
	});

	it("lists every schema problem with its field path, line and a suggestion", () => {
		const text = `{
  "version": 1,
  "entities": [
    { "id": "a", "mesh": { "primitive": "cube" } },
    {
      "id": "b",
      "mesh": { "primitive": "box", "material": { "colour": "#fff", "roughness": 3 } },
      "body": { "type": "dyn" }
    }
  ]
}`;
		const r = importText(text);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		const byPath = new Map(r.issues.map((i) => [i.path, i]));
		expect(byPath.get("entities[0].mesh.primitive")?.message).toBe(
			'must be one of "box", "sphere", "capsule", "plane", "cylinder"; got "cube"',
		);
		expect(byPath.get("entities[0].mesh.primitive")?.line).toBe(4);
		const colour = byPath.get("entities[1].mesh.material.colour");
		expect(colour?.message).toBe('unknown field "colour" on a material');
		expect(colour?.hint).toBe('did you mean "color"?');
		expect(colour?.line).toBe(7);
		expect(byPath.get("entities[1].mesh.material.roughness")?.message).toBe(
			"must be <= 1, got 3",
		);
		expect(byPath.get("entities[1].body.type")?.line).toBe(8);
	});

	it("reports cross-field problems (duplicate ids, unknown prefabs)", () => {
		const r = importText(
			JSON.stringify({
				entities: [
					{ id: "a", mesh: { primitive: "box" } },
					{ id: "a", prefab: "nope" },
				],
			}),
		);
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.issues.map((i) => i.path)).toEqual([
			"entities[1].id",
			"entities[1].prefab",
		]);
	});

	it("rejects non-objects readably", () => {
		const r = importText("[1, 2]");
		expect(!r.ok && r.issues[0]?.message).toMatch(/must be a JSON object/);
		const e = importText("   ");
		expect(!e.ok && e.issues[0]?.message).toMatch(/empty/);
	});

	it("accepts unsupported-but-valid scenes with warnings and keeps them verbatim", () => {
		const scene = {
			version: 1,
			entities: [
				{
					id: "bot",
					mesh: { gltf: { url: "/assets/robot.glb" } },
					body: {
						type: "kinematic",
						collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
					},
					character: {},
				},
				{ id: "box", mesh: { primitive: "box" }, body: {} },
			],
		};
		const r = importText(JSON.stringify(scene));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.warnings.join(" ")).toMatch(/glTF/);
		expect(r.warnings.join(" ")).toMatch(/character/);
		expect(r.doc).toEqual(scene);
	});

	it("locates nested paths to lines", () => {
		const m = locatePaths('{\n"a": [\n 1,\n {"b": 2}\n]\n}');
		expect(m.get("a")).toBe(2);
		expect(m.get("a[0]")).toBe(3);
		expect(m.get("a[1].b")).toBe(4);
	});
});
