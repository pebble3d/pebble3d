// The scene JSON Schema as authors (and agents) write it: the input view, so every field
// with a default stays optional. Shared by emit-schema.ts and its freshness test.
import { z } from "zod";
import { SceneSchema } from "../src/schema.ts";

export function sceneJsonSchemaText(): string {
	const schema = z.toJSONSchema(SceneSchema, { io: "input" });
	return `${JSON.stringify({ title: "Pebble3D scene", ...schema }, null, "\t")}\n`;
}
