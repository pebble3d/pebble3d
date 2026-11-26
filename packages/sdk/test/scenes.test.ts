import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandScene } from "../src/expand.ts";
import { parseScene } from "../src/schema.ts";
import { loadSim } from "../src/sim.ts";

const scenesDir = new URL("../../../apps/playground/scenes/", import.meta.url);
const readJson = (u: URL): unknown => JSON.parse(readFileSync(u, "utf8"));
const scene = (name: string) =>
	parseScene(readJson(new URL(`${name}.json`, scenesDir)));
const fixture = () =>
	parseScene(readJson(new URL("./fixtures/det-scene.json", import.meta.url)));

describe("playground scenes", () => {
	it("every scene parses and expands", () => {
		const names = readdirSync(scenesDir).filter((f) => f.endsWith(".json"));
		expect(names.sort()).toEqual(
			expect.arrayContaining(["det.json", "outdoor.json", "studio.json"]),
		);
		for (const f of names) expandScene(scene(f.replace(/\.json$/, "")));
	});

	it("studio: 5x3 swatch grid, 64 crates from 3 m, hero + close presets", () => {
		const s = scene("studio");
		expect(s.environment.preset).toBe("studio");
		const swatches = s.entities.filter((e) => e.id.startsWith("swatch-"));
		expect(swatches).toHaveLength(15);
		const crates = s.entities.filter((e) => e.id.startsWith("crate-"));
		expect(crates).toHaveLength(64);
		const minY = Math.min(
			...crates.map((c) => c.transform?.position?.[1] ?? 0),
		);
		expect(minY).toBeGreaterThanOrEqual(3);
		expect(Object.keys(s.camera.presets).sort()).toEqual(["close", "hero"]);
	});

	it("outdoor: outdoor preset with an HDRI and a hero preset", () => {
		const s = scene("outdoor");
		expect(s.environment.preset).toBe("outdoor");
		expect(s.environment.hdri).toMatch(/\.hdr$/);
		expect(s.camera.presets.hero).toBeDefined();
	});

	it("showcase: aligned splat with env-from-splat, 3x4 crates, spawner, ramps, human character", () => {
		const s = scene("showcase");
		const splat = s.environment.splat;
		expect(splat?.url).toBe("/assets/knock-community-hall-800k.spz");
		expect(splat?.envFromSplat).toBe(true);
		expect(splat?.floorY).toBe(0);
		expect(s.bounds).toBeDefined();
		expect(s.entities.filter((e) => e.id.startsWith("crate-"))).toHaveLength(
			12,
		);
		const spawner = s.entities.find((e) => e.spawner)?.spawner;
		expect(spawner?.count).toBe(60);
		expect(spawner?.rate).toBe(4);
		expect(s.entities.filter((e) => e.id.startsWith("ramp-"))).toHaveLength(2);
		const player = s.entities.find((e) => e.id === "player");
		expect(player?.body?.type).toBe("kinematic");
		expect(player?.body?.collider).toEqual({
			shape: "capsule",
			halfHeight: 0.5,
			radius: 0.3,
		});
		expect(player?.character).toEqual({ speed: 1.5, sprintSpeed: 5.5 });
		expect(player?.mesh?.gltf?.url).toBe("/assets/rocketbox-male-adult-16.glb");
		// Authored ground speeds at the built 1.75 m scale (Task 4 measurement).
		expect(player?.mesh?.gltf?.animations).toEqual({
			idle: "Idle",
			walk: { clip: "Walk", speed: 0.979 },
			run: { clip: "Run", speed: 5.649 },
			jump: "Jump",
			fall: "Fall",
		});
		expect(player?.mesh?.gltf?.look).toEqual({
			envIntensity: 1.2,
			saturation: 0.85,
		});
		expect(player?.transform?.scale).toEqual([1, 1, 1]);
		expect(s.camera.controller).toBe("thirdPerson");
		expect(Object.keys(s.camera.presets).sort()).toEqual([
			"close",
			"hero",
			"overhead",
		]);
		const x = expandScene(s);
		expect(x.settings.splat?.exposure).toBe(splat?.exposure);
		expect(x.render.find((r) => r.sceneId === "player")?.visualOffset).toEqual([
			0, -0.8, 0,
		]);
	});

	it("showcase-robot is showcase with the robot as the character", () => {
		const human = scene("showcase");
		const robot = scene("showcase-robot");
		const withoutPlayer = (x: typeof human) => ({
			...x,
			entities: x.entities.filter((e) => e.id !== "player"),
		});
		expect(withoutPlayer(robot)).toEqual(withoutPlayer(human));
		const hp = human.entities.find((e) => e.id === "player");
		const rp = robot.entities.find((e) => e.id === "player");
		expect(rp?.character).toEqual({});
		expect(rp?.mesh?.gltf?.url).toBe("/assets/RobotExpressive.glb");
		expect(rp?.transform?.scale).toEqual([0.38, 0.38, 0.38]);
		expect({ ...rp, character: {}, mesh: {}, transform: {} }).toEqual({
			...hp,
			character: {},
			mesh: {},
			transform: {},
		});
		expect(rp?.transform?.position).toEqual(hp?.transform?.position);
		expect(rp?.transform?.rotation).toEqual(hp?.transform?.rotation);
	});

	it("showcase-toon is showcase in the toon style", () => {
		const pbr = scene("showcase");
		const toon = scene("showcase-toon");
		expect(toon.post.style).toBe("toon");
		expect({ ...toon, post: { ...toon.post, style: "pbr" } }).toEqual(pbr);
	});

	it("showcase-badsplat is showcase-robot with a missing splat url", () => {
		const good = scene("showcase-robot");
		const bad = scene("showcase-badsplat");
		expect(bad.environment.splat?.url).toBe("/assets/missing.spz");
		expect({
			...bad,
			environment: { ...bad.environment, splat: undefined },
		}).toEqual({
			...good,
			environment: { ...good.environment, splat: undefined },
		});
		expect({ ...bad.environment.splat, url: "" }).toEqual({
			...good.environment.splat,
			url: "",
		});
	});

	it("det.json has the same sim content as the det fixture", () => {
		const a = scene("det");
		const b = fixture();
		expect(a.sim).toEqual(b.sim);
		expect(expandScene(a).sim).toEqual(expandScene(b).sim);
		expect(expandScene(a).pendingHulls).toEqual([]);
		expect(a.camera.presets.hero).toBeDefined();
	});

	it("det.json reproduces det-hash.txt after 1000 ticks", async () => {
		const s = scene("det");
		const x = expandScene(s);
		const bytes = readFileSync(
			new URL("../wasm/det/engine_core_det_bg.wasm", import.meta.url),
		);
		const h = await loadSim("deterministic", bytes, {
			seed: s.sim.seed,
			gravity: s.sim.gravity,
		});
		h.spawnScene(x.sim);
		h.world.step(1000);
		const want = readFileSync(
			new URL("./fixtures/det-hash.txt", import.meta.url),
			"utf8",
		).trim();
		expect(h.world.stateHash()).toBe(want);
	});
});
