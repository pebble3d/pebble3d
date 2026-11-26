import {
	CompressedTexture,
	DataTexture,
	Group,
	Mesh,
	MeshStandardMaterial,
	PlaneGeometry,
	RGBA_ASTC_4x4_Format,
	RGBAFormat,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import { estimateTextureBytes } from "../src/gltf/texture-memory.ts";

const rgba = (n: number) => {
	const t = new DataTexture(new Uint8Array(n * n * 4), n, n, RGBAFormat);
	t.generateMipmaps = true;
	return t;
};

describe("estimateTextureBytes", () => {
	it("counts an RGBA texture with mipmaps at 4 B/px x 1.33", () => {
		const root = new Mesh(
			new PlaneGeometry(),
			new MeshStandardMaterial({ map: rgba(1024) }),
		);
		expect(estimateTextureBytes(root)).toBeCloseTo(1024 * 1024 * 4 * 1.33, 0);
	});

	it("counts a texture shared by two materials once", () => {
		const tex = rgba(1024);
		const root = new Group();
		root.add(
			new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ map: tex })),
			new Mesh(
				new PlaneGeometry(),
				new MeshStandardMaterial({ normalMap: tex }),
			),
		);
		expect(estimateTextureBytes(root)).toBeCloseTo(1024 * 1024 * 4 * 1.33, 0);
	});

	it("counts a compressed texture at 1 B/px x 1.33", () => {
		const n = 2048;
		const mips = [{ data: new Uint8Array(16), width: n, height: n }];
		const tex = new CompressedTexture(mips, n, n, RGBA_ASTC_4x4_Format);
		const root = new Mesh(
			new PlaneGeometry(),
			new MeshStandardMaterial({ map: tex }),
		);
		expect(estimateTextureBytes(root)).toBeCloseTo(n * n * 1 * 1.33, 0);
	});

	it("counts a KTX2 RGBA fallback (CompressedTexture, RGBAFormat) at 4 B/px", () => {
		const n = 2048;
		const mips = [{ data: new Uint8Array(16), width: n, height: n }];
		const tex = new CompressedTexture(mips, n, n, RGBA_ASTC_4x4_Format);
		// three types `format` as compressed-only; a KTX2 RGBA fallback sets RGBAFormat at runtime.
		(tex as unknown as { format: number }).format = RGBAFormat;
		const root = new Mesh(
			new PlaneGeometry(),
			new MeshStandardMaterial({ map: tex }),
		);
		expect(estimateTextureBytes(root)).toBeCloseTo(n * n * 4 * 1.33, 0);
	});

	it("is 0 for a mesh without textures", () => {
		const root = new Mesh(new PlaneGeometry(), new MeshStandardMaterial());
		expect(estimateTextureBytes(root)).toBe(0);
	});
});
