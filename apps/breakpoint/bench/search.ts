// Headless aim search: fires one shot at each candidate target on a settled level (after the
// given prior shots) and ranks targets by mass knocked below the line. Used to script the bot.
// Usage: node --experimental-strip-types bench/search.ts <level> [prior "x,y,z,v;..."]
import { readFileSync } from "node:fs";
import { loadSim } from "@pebble3d/sdk/sim";
import { aimVelocity } from "../src/game/aim.ts";
import { LEVELS } from "../src/game/levels.ts";
import { Site } from "../src/game/site.ts";

const bytes = readFileSync(
	new URL(
		"../../../packages/sdk/wasm/det/engine_core_det_bg.wasm",
		import.meta.url,
	),
);
const h = await loadSim("deterministic", bytes);
const Ctor = h.world.constructor as new (
	seed: number,
	g: number,
) => typeof h.world;
const src = { make: () => new Ctor(1, -9.81), memory: h.memory };
const li = Number(process.argv[2] ?? 0);
const level = LEVELS[li];
if (!level) throw new Error("bad level");
const prior = (process.argv[3] ?? "")
	.split(";")
	.filter(Boolean)
	.map((s) => s.split(",").map(Number));
const speeds = [40, 52];
const seed = (7 * 7919 + li * 104729) >>> 0;

function run(target: [number, number, number], speed: number): number {
	const site = new Site(src, level as (typeof LEVELS)[number], seed);
	site.settle();
	const fire = (t: [number, number, number], v: number) => {
		const vel = aimVelocity(site.level.launcher, t, v);
		site.fire({ tick: site.tick, vx: vel[0], vy: vel[1], vz: vel[2] });
		for (let i = 0; i < 420; i++) {
			site.step();
			if (i > 150 && i % 10 === 0 && site.awakeBlocks() < 6) break;
		}
	};
	for (const p of prior)
		fire([p[0], p[1], p[2]] as [number, number, number], p[3] as number);
	const before = site.knockedMass();
	fire(target, speed);
	const kg = site.knockedMass() - before;
	site.free();
	return kg / site.aboveMass;
}

let zFront = -Infinity;
let x0 = Infinity;
let x1 = -Infinity;
for (const b of level.build(seed)) {
	zFront = Math.max(zFront, b.z);
	x0 = Math.min(x0, b.x);
	x1 = Math.max(x1, b.x);
}
const results: [number, string][] = [];
for (let x = Math.ceil(x0); x <= x1; x += Math.max(1.5, (x1 - x0) / 7))
	for (const y of [1.2, 2.6, 4.2])
		for (const v of speeds) {
			const t: [number, number, number] = [
				Number(x.toFixed(1)),
				y,
				Number(zFront.toFixed(1)),
			];
			const f = run(t, v);
			results.push([f, `[${t.join(", ")}] @${v}`]);
			console.log(`${(f * 100).toFixed(1)}%  ${t.join(",")} @${v}`);
		}
results.sort((a, b) => b[0] - a[0]);
console.log("best:");
for (const r of results.slice(0, 6))
	console.log(`  ${(r[0] * 100).toFixed(1)}% ${r[1]}`);
