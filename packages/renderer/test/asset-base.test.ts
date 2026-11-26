import { describe, expect, it } from "vitest";
import {
	defaultAssetBase,
	defaultWebglFallback,
	resolveAssetUrl,
} from "../src/asset-base.ts";

describe("resolveAssetUrl", () => {
	it("leaves every url unchanged without a base (the default)", () => {
		for (const base of [undefined, "", "/"])
			expect(resolveAssetUrl("/assets/a.glb", base)).toBe("/assets/a.glb");
	});

	it("prefixes root-absolute urls with the base, with or without a trailing slash", () => {
		expect(resolveAssetUrl("/assets/a.glb", "/pebble3d/")).toBe(
			"/pebble3d/assets/a.glb",
		);
		expect(resolveAssetUrl("/basis/", "/pebble3d")).toBe("/pebble3d/basis/");
		expect(resolveAssetUrl("/assets/x.spz", "https://cdn.example/p/")).toBe(
			"https://cdn.example/p/assets/x.spz",
		);
	});

	it("leaves relative, protocol-relative and schemed urls alone", () => {
		for (const url of [
			"assets/a.glb",
			"./a.glb",
			"//cdn.example/a.glb",
			"https://x.example/a.glb",
			"data:application/octet-stream;base64,AA==",
			"blob:http://x/1",
		])
			expect(resolveAssetUrl(url, "/pebble3d/")).toBe(url);
	});

	it("does not prefix a url twice", () => {
		expect(resolveAssetUrl("/pebble3d/assets/a.glb", "/pebble3d/")).toBe(
			"/pebble3d/assets/a.glb",
		);
	});
});

describe("defaultAssetBase", () => {
	it('is "/" when no Vite base or override is set (vitest BASE_URL is "/")', () => {
		expect(defaultAssetBase()).toBe("/");
	});
});

describe("defaultWebglFallback", () => {
	it("is off by default, so a missing WebGPU still fails loudly", () => {
		expect(defaultWebglFallback(undefined)).toBe(false);
		expect(defaultWebglFallback("")).toBe(false);
		expect(defaultWebglFallback("?backend=webgpu")).toBe(false);
		expect(defaultWebglFallback("?webglFallback=0")).toBe(false);
	});

	it("turns on with ?webglFallback=1", () => {
		expect(defaultWebglFallback("?webglFallback=1")).toBe(true);
		expect(defaultWebglFallback("?demo=1&webglFallback=1")).toBe(true);
	});
});
