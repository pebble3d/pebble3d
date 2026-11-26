// Headless keep export: `pnpm --filter lanternfall gen -- --seed 7 [--layout] [--out file.json]`.
// Writes the same schema-validated scene JSON that ?dumpScene=1 shows in the browser (with
// --layout, `{ scene, layout }`). The scene loads anywhere a Pebble3D scene does, e.g. copied
// into apps/playground/scenes/ and opened with /?scene=<name>.
import { writeFileSync } from "node:fs";
import { parseScene } from "@pebble3d/sdk/schema";
import { generateKeep } from "../gen/generate.ts";

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => {
	const i = args.indexOf(k);
	return i >= 0 ? args[i + 1] : undefined;
};
const seed = Number(arg("--seed") ?? 7);
if (!Number.isInteger(seed) || seed < 0)
	throw new Error(`bad --seed ${arg("--seed")}`);
const keep = generateKeep(seed);
parseScene(keep.scene);
const data = args.includes("--layout") ? keep : keep.scene;
const text = `${JSON.stringify(data, null, "\t")}\n`;
const out = arg("--out");
if (out) {
	writeFileSync(out, text);
	console.error(
		`keep ${seed}: ${keep.scene.entities?.length} entities -> ${out}`,
	);
} else process.stdout.write(text);
