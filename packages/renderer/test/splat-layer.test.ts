import { BufferAttribute, BufferGeometry } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
	loadSplat,
	loadSplatGeometry,
	SPLAT_LOADERS,
	type SplatFormat,
	SplatLoadError,
	type SplatLoaderFactories,
	splatFormatOf,
} from "../src/splat/splat-layer.ts";

/** Stub loaders that record which format was asked for and resolve or reject per `behave`. */
function stubLoaders(behave: (url: string) => Promise<BufferGeometry>): {
	loaders: SplatLoaderFactories;
	used: SplatFormat[];
} {
	const used: SplatFormat[] = [];
	const make = (f: SplatFormat) => () => ({
		loadAsync: (url: string) => {
			used.push(f);
			return behave(url);
		},
	});
	return {
		used,
		loaders: {
			spz: make("spz"),
			splat: make("splat"),
			ksplat: make("ksplat"),
			ply: make("ply"),
		},
	};
}

/** A one-splat geometry with the attributes GaussianSplat reads. */
function oneSplat(): BufferGeometry {
	const g = new BufferGeometry();
	g.setAttribute("position", new BufferAttribute(new Float32Array(3), 3));
	g.setAttribute(
		"covariance",
		new BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 1]), 6),
	);
	g.setAttribute(
		"color",
		new BufferAttribute(new Uint8Array([255, 255, 255, 255]), 4, true),
	);
	return g;
}

const cfg = (url: string) => ({
	url,
	position: [1, 2, 3] as [number, number, number],
	rotation: [1, 0, 0, 0] as [number, number, number, number],
	scale: 2,
	envFromSplat: false,
	floorY: 0,
});

describe("splatFormatOf", () => {
	it("maps each supported extension, case-insensitive, ignoring query and hash", () => {
		expect(splatFormatOf("/a/b.spz")).toBe("spz");
		expect(splatFormatOf("/a/b.SPLAT")).toBe("splat");
		expect(splatFormatOf("https://x.y/c.ksplat?v=2")).toBe("ksplat");
		expect(splatFormatOf("c.ply#frag")).toBe("ply");
	});
	it("returns null for unknown or missing extensions", () => {
		expect(splatFormatOf("/a/b.glb")).toBeNull();
		expect(splatFormatOf("/a.dir/b")).toBeNull();
		expect(splatFormatOf("")).toBeNull();
	});
	it("has a real three loader for every format", () => {
		for (const f of ["spz", "splat", "ksplat", "ply"] as const)
			expect(typeof SPLAT_LOADERS[f]().loadAsync).toBe("function");
	});
});

describe("loadSplatGeometry", () => {
	it("uses the loader chosen by extension", async () => {
		const g = oneSplat();
		const { loaders, used } = stubLoaders(async () => g);
		await expect(loadSplatGeometry("/s.ksplat", loaders)).resolves.toBe(g);
		await loadSplatGeometry("/s.spz", loaders);
		await loadSplatGeometry("/s.splat", loaders);
		await loadSplatGeometry("/s.ply", loaders);
		expect(used).toEqual(["ksplat", "spz", "splat", "ply"]);
	});

	it("wraps network/parse failures as SplatLoadError with the url", async () => {
		const cause = new Error("HTTP 404");
		const { loaders } = stubLoaders(() => Promise.reject(cause));
		const err = await loadSplatGeometry("/assets/missing.spz", loaders).catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(SplatLoadError);
		expect((err as SplatLoadError).message).toBe(
			"SplatLoadError: /assets/missing.spz",
		);
		expect((err as SplatLoadError).url).toBe("/assets/missing.spz");
		expect((err as SplatLoadError).cause).toBe(cause);
	});

	it("rejects an unsupported extension without calling any loader", async () => {
		const { loaders, used } = stubLoaders(async () => oneSplat());
		await expect(loadSplatGeometry("/s.glb", loaders)).rejects.toThrow(
			/^SplatLoadError: \/s\.glb$/,
		);
		expect(used).toEqual([]);
	});

	it("treats a loader result without positions as a load error", async () => {
		const { loaders } = stubLoaders(async () => new BufferGeometry());
		await expect(loadSplatGeometry("/s.spz", loaders)).rejects.toBeInstanceOf(
			SplatLoadError,
		);
	});
});

describe("loadSplat", () => {
	it("builds a GaussianSplat with the authored transform and counts splats", async () => {
		const { loaders } = stubLoaders(async () => oneSplat());
		const { object, count } = await loadSplat(cfg("/s.spz"), loaders);
		expect(count).toBe(1);
		expect((object as { isGaussianSplat?: boolean }).isGaussianSplat).toBe(
			true,
		);
		expect(object.position.toArray()).toEqual([1, 2, 3]);
		expect(object.quaternion.toArray()).toEqual([1, 0, 0, 0]);
		expect(object.scale.toArray()).toEqual([2, 2, 2]);
		expect(object.layers.mask).toBe(1 << 1);
	});

	it("exposes live colour controls seeded from the config (tint starts white)", async () => {
		const { loaders } = stubLoaders(async () => oneSplat());
		const { color } = await loadSplat(
			{ ...cfg("/s.spz"), exposure: 0.8, saturation: 1.1 },
			loaders,
		);
		expect(color.exposure.value).toBe(0.8);
		expect(color.saturation.value).toBe(1.1);
		expect(color.tint.value.toArray()).toEqual([1, 1, 1]);
	});

	it("propagates SplatLoadError", async () => {
		const { loaders } = stubLoaders(() => Promise.reject(new Error("parse")));
		await expect(loadSplat(cfg("/bad.ply"), loaders)).rejects.toThrow(
			"SplatLoadError: /bad.ply",
		);
	});
});
