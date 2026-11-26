import {
	BoxGeometry,
	Color,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshPhysicalMaterial,
	MeshStandardMaterial,
	MeshStandardNodeMaterial,
	Texture,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import { posterize, unitTint } from "../src/style/splat-grade.ts";
import {
	bandOf,
	setToonUniforms,
	stylizeToon,
	TOON,
	TOON_DEFAULTS,
	ToonNodeMaterial,
	toonMaterialFrom,
} from "../src/style/toon.ts";

describe("toon bands", () => {
	it("quantises N.L into n tones from 0 to 1", () => {
		expect([0, 0.2, 0.4, 0.6, 0.7, 1].map((x) => bandOf(x, 3))).toEqual([
			0, 0, 0.5, 0.5, 1, 1,
		]);
		expect(bandOf(-1, 4)).toBe(0);
		expect(bandOf(0.99, 2)).toBe(1);
	});

	it("pushes settings into the shared uniforms (bands clamped to >= 2)", () => {
		setToonUniforms({ ...TOON_DEFAULTS, bands: 1, rim: 0.9 });
		expect(TOON.bands.value).toBe(2);
		expect(TOON.rim.value).toBe(0.9);
		setToonUniforms(TOON_DEFAULTS);
		expect(TOON.bands.value).toBe(3);
	});
});

describe("toonMaterialFrom", () => {
	it("converts a classic standard material, keeping maps and colours", () => {
		const map = new Texture();
		const src = new MeshStandardMaterial({
			color: 0x884422,
			map,
			roughness: 0.3,
		});
		const out = toonMaterialFrom(src) as ToonNodeMaterial;
		expect(out).toBeInstanceOf(ToonNodeMaterial);
		expect(out.map).toBe(map);
		expect(out.roughness).toBe(0.3);
		expect(out.color.getHex()).toBe(0x884422);
		expect(out.color).not.toBe(src.color);
	});

	it("converts a node standard material with its nodes", () => {
		const src = new MeshStandardNodeMaterial({ color: new Color(1, 0, 0) });
		const out = toonMaterialFrom(src) as ToonNodeMaterial;
		expect(out.isToonNodeMaterial).toBe(true);
		expect(out.color.r).toBe(1);
	});

	it("leaves glass (transmission) as physical PBR", () => {
		const glass = new MeshPhysicalMaterial({ transmission: 1 });
		expect(toonMaterialFrom(glass)).toBe(glass);
	});

	it("leaves unlit and already-toon materials alone", () => {
		const basic = new MeshBasicMaterial();
		expect(toonMaterialFrom(basic)).toBe(basic);
		const toon = new ToonNodeMaterial();
		expect(toonMaterialFrom(toon)).toBe(toon);
	});

	it("keeps the class and per-material strengths through clone()", () => {
		const m = new ToonNodeMaterial();
		m.toonRim = 2;
		m.toonSpecular = 0.5;
		const c = m.clone();
		expect(c).toBeInstanceOf(ToonNodeMaterial);
		expect(c.toonRim).toBe(2);
		expect(c.toonSpecular).toBe(0.5);
		expect(c.type).toBe("ToonNodeMaterial");
	});
});

describe("stylizeToon", () => {
	it("swaps lit materials once per source, keeping sharing", () => {
		const root = new Group();
		const shared = new MeshStandardMaterial();
		const basic = new MeshBasicMaterial();
		const a = new Mesh(new BoxGeometry(), shared);
		const b = new Mesh(new BoxGeometry(), shared);
		const c = new Mesh(new BoxGeometry(), basic);
		root.add(a, b, c);
		stylizeToon(root);
		expect(a.material).toBeInstanceOf(ToonNodeMaterial);
		expect(a.material).toBe(b.material);
		expect(c.material).toBe(basic);
	});
});

describe("splat grade and outline helpers", () => {
	it("posterizes lightness into levels", () => {
		expect(posterize(0.49, 4)).toBe(0.375);
		expect(posterize(0.1, 4)).toBe(0.125);
		expect(posterize(2, 4)).toBe(0.875);
	});

	it("unit tints have luminance 1", () => {
		const t = unitTint("#3a4466");
		expect(0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b).toBeCloseTo(1, 5);
		expect(t.b).toBeGreaterThan(t.r);
	});
});
