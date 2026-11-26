// Writes apps/chain-reaction/level.schema.json: the level JSON Schema as authors (and agents)
// write it (input view: defaulted fields stay optional). `scene` is a partial
// packages/sdk/scene.schema.json scene merged over levels/base.json.
import { writeFileSync } from "node:fs";
import { levelJsonSchema } from "../puzzle/level.ts";

const out = new URL("../../level.schema.json", import.meta.url);
writeFileSync(out, levelJsonSchema());
console.log(`wrote ${out.pathname}`);
