import { describe, expect, it } from "vitest";
import { expandScene } from "../src/expand.ts";
import { parseScene, type SceneInput } from "../src/schema.ts";

const expand = (input: SceneInput) => expandScene(parseScene(input));

describe("expandScene", () => {
	it("deep-merges prefabs: entity overrides, prefab fields are kept", () => {
		const x = expand({
			prefabs: {
				crate: {
					mesh: {
						primitive: "box",
						material: { color: "#ff0000", roughness: 0.2 },
					},
					body: { type: "dynamic", mass: 2 },
				},
			},
			entities: [
				{ id: "c1", prefab: "crate", mesh: { material: { color: "#00ff00" } } },
			],
		});
		const r = x.render.find((e) => e.sceneId === "c1");
		expect(r?.material.color).toBe("#00ff00");
		expect(r?.material.roughness).toBe(0.2);
		expect(r?.mesh).toEqual({
			kind: "primitive",
			primitive: "box",
			size: [1, 1, 1],
		});
		const s = x.sim.find((e) => e.sceneId === "c1");
		expect(s?.desc.body?.mass).toBe(2);
		expect(s?.desc.body?.type).toBe("dynamic");
	});

	it("resolves collider:'auto' from the primitive and scale", () => {
		const x = expand({
			entities: [
				{
					id: "box",
					mesh: { primitive: "box" },
					transform: { scale: [2, 1, 4] },
					body: {},
				},
				{
					id: "ball",
					mesh: { primitive: "sphere" },
					transform: { scale: [0.6, 0.6, 0.6] },
					body: {},
				},
				{
					id: "pill",
					mesh: { primitive: "capsule" },
					transform: { scale: [0.6, 1.6, 0.6] },
					body: {},
				},
			],
		});
		const col = (id: string) =>
			x.sim.find((e) => e.sceneId === id)?.desc.body?.collider;
		expect(col("box")).toEqual({ shape: "box", halfExtents: [1, 0.5, 2] });
		expect(col("ball")).toEqual({ shape: "sphere", radius: 0.3 });
		const pill = col("pill");
		expect(pill?.shape).toBe("capsule");
		if (pill?.shape !== "capsule") throw new Error("capsule");
		expect(pill.halfHeight).toBeCloseTo(0.8 - 0.3);
		expect(pill.radius).toBeCloseTo(0.3);
	});

	it("turns bounds into 4 static box sims and no render entities", () => {
		const x = expand({ bounds: { min: [-5, -3], max: [5, 3] } });
		expect(x.sim).toHaveLength(4);
		expect(x.render).toHaveLength(0);
		for (const s of x.sim) {
			expect(s.desc.body?.type).toBe("static");
			expect(s.desc.body?.collider.shape).toBe("box");
		}
		// The walls enclose the area: one wall's inner face sits on each edge.
		const inner = x.sim.map((s) => {
			const c = s.desc.body?.collider;
			if (c?.shape !== "box") throw new Error("box");
			return [s.desc.position, c.halfExtents] as const;
		});
		const minX = Math.min(...inner.map(([p, h]) => p[0] + h[0]));
		const maxX = Math.max(...inner.map(([p, h]) => p[0] - h[0]));
		expect(minX).toBeCloseTo(-5);
		expect(maxX).toBeCloseTo(5);
		expect(
			inner.every(([p, h]) => Math.abs(p[1] - h[1]) < 1e-9 && h[1] === 2),
		).toBe(true);
	});

	it("expands a spawner into one sim with a template and a template render entity", () => {
		const x = expand({
			sim: { seed: 10 },
			prefabs: {
				ball: {
					mesh: { primitive: "sphere", material: { color: "#3366ff" } },
					transform: { scale: [0.5, 0.5, 0.5] },
					body: { type: "dynamic", restitution: 0.4 },
				},
			},
			entities: [
				{ id: "floor", mesh: { primitive: "box" }, body: { type: "static" } },
				{
					id: "rain",
					spawner: {
						prefab: "ball",
						rate: 4,
						count: 60,
						area: { min: [-2, 6, -2], max: [2, 8, 2] },
					},
				},
			],
		});
		const sims = x.sim.filter((e) => e.sceneId === "rain");
		expect(sims).toHaveLength(1);
		const sp = sims[0]?.desc.spawner;
		expect(sp).toBeTruthy();
		expect(sp?.rate).toBe(4);
		expect(sp?.count).toBe(60);
		expect(sp?.areaMin).toEqual([-2, 6, -2]);
		expect(sp?.areaMax).toEqual([2, 8, 2]);
		expect(sp?.seed).toBe(11); // sim.seed + entity index
		expect(sp?.template.body?.collider).toEqual({
			shape: "sphere",
			radius: 0.25,
		});
		expect(sp?.template.body?.restitution).toBe(0.4);
		expect(sims[0]?.desc.body).toBeUndefined();

		const tpl = x.render.filter((e) => e.templateKey === "rain");
		expect(tpl).toHaveLength(1);
		expect(tpl[0]?.simId).toBeUndefined();
		expect(tpl[0]?.dynamic).toBe(true);
		expect(tpl[0]?.material.color).toBe("#3366ff");
	});

	it("honours an explicit spawner seed", () => {
		const x = expand({
			prefabs: { ball: { mesh: { primitive: "sphere" }, body: {} } },
			entities: [
				{
					id: "r",
					spawner: {
						prefab: "ball",
						rate: 1,
						count: 1,
						seed: 99,
						area: { min: [0, 0, 0], max: [0, 0, 0] },
					},
				},
			],
		});
		expect(x.sim[0]?.desc.spawner?.seed).toBe(99);
	});

	it("offsets a character visual by -(halfHeight+radius)", () => {
		const x = expand({
			entities: [
				{
					id: "hero",
					mesh: {
						gltf: { url: "/assets/hero.glb", animations: { idle: "Idle" } },
					},
					body: {
						type: "kinematic",
						collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
					},
					character: {},
				},
			],
		});
		const r = x.render[0];
		expect(r?.character).toBe(true);
		expect(r?.dynamic).toBe(true);
		expect(r?.visualOffset).toEqual([0, -0.8, 0]);
		expect(r?.mesh).toEqual({
			kind: "gltf",
			url: "/assets/hero.glb",
			animations: { idle: { clip: "Idle" } },
		});
		expect(x.sim[0]?.desc.character).toEqual({
			speed: 4,
			sprintSpeed: 7,
			jumpSpeed: 5.5,
			maxSlopeDeg: 45,
			stepHeight: 0.35,
			snap: 0.3,
			accel: 0,
		});
		expect(x.pendingHulls).toEqual([]);
	});

	it("passes character.ridePlatforms only when it is on", () => {
		const desc = (character: Record<string, unknown>) =>
			expand({
				entities: [
					{
						id: "hero",
						mesh: { primitive: "capsule" },
						body: {
							type: "kinematic",
							collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
						},
						character,
					},
				],
			}).sim[0]?.desc.character;
		expect(desc({ ridePlatforms: true })?.ridePlatforms).toBe(true);
		expect(desc({})).not.toHaveProperty("ridePlatforms");
		expect(desc({ ridePlatforms: false })).not.toHaveProperty("ridePlatforms");
	});

	describe("gltf animation entries and look", () => {
		const hero = (gltf: Record<string, unknown>) =>
			expand({
				entities: [
					{
						id: "hero",
						mesh: { gltf: { url: "/assets/hero.glb", ...gltf } },
						body: {
							type: "kinematic",
							collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
						},
						character: {},
					},
				],
			}).render[0]?.mesh as { animations?: unknown; look?: unknown };

		it("normalizes string animation entries", () => {
			const m = hero({ animations: { walk: "Walk" } });
			expect(m.animations).toEqual({ walk: { clip: "Walk" } });
			expect("speed" in (m.animations as { walk: object }).walk).toBe(false);
		});
		it("keeps object entries", () => {
			const m = hero({ animations: { walk: { clip: "Walk", speed: 1.0 } } });
			expect(m.animations).toEqual({ walk: { clip: "Walk", speed: 1.0 } });
		});
		it("passes look", () => {
			const m = hero({ look: { envIntensity: 0.8, saturation: 0.9 } });
			expect(m.look).toEqual({ envIntensity: 0.8, saturation: 0.9 });
		});
	});

	it("leaves a glTF collider:'auto' as an empty convex hull pending in JS", () => {
		const x = expand({
			entities: [
				{
					id: "statue",
					mesh: { gltf: { url: "/assets/statue.glb" } },
					body: { type: "dynamic" },
				},
			],
		});
		expect(x.sim[0]?.desc.body?.collider).toEqual({
			shape: "convexHull",
			points: [],
		});
		expect(x.pendingHulls).toEqual(["statue"]);
	});

	it("maps scene settings into RenderSettings", () => {
		const x = expand({
			environment: { preset: "studio" },
			camera: { controller: "fly", presets: { hero: { position: [0, 2, 6] } } },
		});
		expect(x.settings.preset).toBe("studio");
		expect(x.settings.toneMapping).toBe("agx");
		expect(x.settings.bloom).toEqual({
			enabled: true,
			strength: 0.3,
			threshold: 2,
		});
		expect(x.settings.controller).toBe("fly");
		expect(x.settings.cameraPresets.hero?.position).toEqual([0, 2, 6]);
		expect(x.settings.cameraPresets.hero?.target).toEqual([0, 0, 0]);
		expect(x.settings.splat).toBeUndefined();
	});

	it("resolves fog and backdrop defaults per preset", () => {
		const studio = expand({ environment: { preset: "studio" } }).settings;
		expect(studio.fog).toEqual({ near: 14, far: 42 });
		expect(studio.backdrop).toEqual({ horizon: "#55504a", zenith: "#141416" });
		const outdoor = expand({ environment: { preset: "outdoor" } }).settings;
		expect(outdoor.fog).toEqual({ near: 25, far: 110 });
		// a partial fog override keeps the preset's other default
		const partial = expand({
			environment: { preset: "studio", fog: { far: 80, color: "#202020" } },
		}).settings;
		expect(partial.fog).toEqual({ near: 14, far: 80, color: "#202020" });
		const bd = expand({
			environment: { preset: "studio", backdrop: { zenith: "#000000" } },
		}).settings;
		expect(bd.backdrop).toEqual({ horizon: "#55504a", zenith: "#000000" });
	});

	it("passes fog: false through to RenderSettings", () => {
		const x = expand({ environment: { preset: "studio", fog: false } });
		expect(x.settings.fog).toBe(false);
	});

	it("gives static decor no simId and dynamic=false", () => {
		const x = expand({
			entities: [{ id: "rock", mesh: { primitive: "sphere" } }],
		});
		expect(x.sim).toHaveLength(0);
		expect(x.render[0]).toMatchObject({
			sceneId: "rock",
			dynamic: false,
			character: false,
			castShadow: true,
		});
		expect(x.render[0]?.simId).toBeUndefined();
	});

	it("carries position and rotation on body-less mesh entities only", () => {
		const x = expand({
			entities: [
				{
					id: "pillar",
					mesh: { primitive: "box" },
					transform: { position: [5, 1, 3] },
				},
				{
					id: "crate",
					mesh: { primitive: "box" },
					body: {},
					transform: { position: [1, 2, 3] },
				},
			],
		});
		const pillar = x.render.find((r) => r.sceneId === "pillar");
		expect(pillar?.position).toEqual([5, 1, 3]);
		expect(pillar?.rotation).toEqual([0, 0, 0, 1]);
		const crate = x.render.find((r) => r.sceneId === "crate");
		expect(crate?.position).toBeUndefined();
		expect(crate?.rotation).toBeUndefined();
	});

	it("gives a primitive-mesh character a zero visual offset", () => {
		const x = expand({
			entities: [
				{
					id: "cap",
					mesh: { primitive: "capsule" },
					body: {
						type: "kinematic",
						collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
					},
					character: {},
				},
			],
		});
		expect(x.render[0]?.visualOffset).toEqual([0, 0, 0]);
	});

	it("entity collider replaces the prefab collider wholesale", () => {
		const x = expand({
			prefabs: {
				p: {
					mesh: { primitive: "box" },
					body: { collider: { shape: "box", halfExtents: [1, 1, 1] } },
				},
			},
			entities: [
				{
					id: "a",
					prefab: "p",
					body: { collider: { shape: "sphere", radius: 0.5 } },
				},
			],
		});
		expect(x.sim[0]?.desc.body?.collider).toEqual({
			shape: "sphere",
			radius: 0.5,
		});
	});

	it("entity gltf overrides a prefab primitive", () => {
		const x = expand({
			prefabs: {
				p: {
					mesh: { primitive: "box" },
					body: { collider: { shape: "box", halfExtents: [1, 1, 1] } },
				},
			},
			entities: [{ id: "a", prefab: "p", mesh: { gltf: { url: "/m.glb" } } }],
		});
		expect(x.render[0]?.mesh).toEqual({ kind: "gltf", url: "/m.glb" });
	});
});

describe("post.style", () => {
	it("defaults to pbr: no toon settings reach the renderer", () => {
		const x = expand({ version: 1 });
		expect(x.settings.toon).toBeUndefined();
		expect("toon" in x.settings).toBe(false);
	});

	it("pbr ignores authored toon options", () => {
		const x = expand({ version: 1, post: { toon: { bands: 4 } } });
		expect(x.settings.toon).toBeUndefined();
	});

	it("toon fills the defaults and keeps authored options", () => {
		const x = expand({
			version: 1,
			post: { style: "toon", toon: { bands: 4, outline: { width: 2 } } },
		});
		expect(x.settings.toon?.bands).toBe(4);
		expect(x.settings.toon?.outline).toMatchObject({ enabled: true, width: 2 });
		expect(x.settings.toon?.splat.levels).toBe(5);
	});

	it("rejects out-of-range options", () => {
		expect(() =>
			parseScene({ version: 1, post: { style: "toon", toon: { bands: 1 } } }),
		).toThrow(/post\.toon\.bands/);
		expect(() => parseScene({ version: 1, post: { style: "cel" } })).toThrow(
			/post\.style/,
		);
	});
});
