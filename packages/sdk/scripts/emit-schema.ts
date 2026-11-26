// Writes packages/sdk/scene.schema.json (see scene-json-schema.ts).
import { writeFileSync } from "node:fs";
import { sceneJsonSchemaText } from "./scene-json-schema.ts";

const out = new URL("../scene.schema.json", import.meta.url);
writeFileSync(out, sceneJsonSchemaText());
console.log(`wrote ${out.pathname}`);
