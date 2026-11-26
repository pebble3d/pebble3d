// Usage: node --experimental-strip-types test/determinism.mjs [--write] [--expect <hash>]
import { readFileSync, writeFileSync } from "node:fs";
import { expandScene } from "../src/expand.ts";
import { parseScene } from "../src/schema.ts";
import { loadSim } from "../src/sim.ts";

const bytes = readFileSync(
	new URL("../wasm/det/engine_core_det_bg.wasm", import.meta.url),
);
const sceneJson = JSON.parse(
	readFileSync(new URL("./fixtures/det-scene.json", import.meta.url), "utf8"),
);
const scene = parseScene(sceneJson);
const x = expandScene(scene);
const h = await loadSim("deterministic", bytes, {
	seed: scene.sim.seed,
	gravity: scene.sim.gravity,
});
h.spawnScene(x.sim);
h.world.step(1000);
const hash = h.world.stateHash();
console.log(JSON.stringify({ hash }));

const args = process.argv.slice(2);
if (args.includes("--write")) {
	writeFileSync(
		new URL("./fixtures/det-hash.txt", import.meta.url),
		`${hash}\n`,
	);
}
const i = args.indexOf("--expect");
if (i >= 0 && args[i + 1]?.trim() !== hash) {
	console.error(`determinism mismatch: expected ${args[i + 1]}, got ${hash}`);
	process.exit(1);
}
