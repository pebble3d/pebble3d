import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sceneJsonSchemaText } from "../scripts/scene-json-schema.ts";

// scene.schema.json (and docs/scene-reference.md, generated from it) must match schema.ts.
describe("scene.schema.json", () => {
	it("is current with SceneSchema (run `pnpm --filter @pebble3d/sdk schema`)", () => {
		const committed = readFileSync(
			new URL("../scene.schema.json", import.meta.url),
			"utf8",
		);
		expect(committed).toBe(sceneJsonSchemaText());
	});
});
