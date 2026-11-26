import {
	BoxGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	type MeshStandardNodeMaterial,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import { applyLook } from "../src/gltf/look.ts";

const twoMeshes = () => {
	const root = new Group();
	const shared = new MeshStandardMaterial({ color: 0x884422 });
	const a = new Mesh(new BoxGeometry(), shared);
	const b = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
	root.add(a, b);
	return { root, a, b, shared };
};
const std = (m: Mesh) => m.material as MeshStandardMaterial;

describe("applyLook", () => {
	it("sets envMapIntensity on every mesh material", () => {
		const { root, a, b } = twoMeshes();
		applyLook(root, { envIntensity: 0.7 });
		expect(std(a).envMapIntensity).toBe(0.7);
		expect(std(b).envMapIntensity).toBe(0.7);
	});

	it("is a no-op for an undefined look", () => {
		const { root, a, b, shared } = twoMeshes();
		const bMat = b.material;
		applyLook(root, undefined);
		expect(a.material).toBe(shared);
		expect(b.material).toBe(bMat);
		expect(shared.envMapIntensity).toBe(1);
	});

	it("sets a colorNode for saturation != 1", () => {
		const { root, a, b } = twoMeshes();
		applyLook(root, { saturation: 0.9 });
		for (const m of [a, b]) {
			const mat = m.material as unknown as MeshStandardNodeMaterial;
			expect(mat.colorNode).not.toBeNull();
			expect(mat.colorNode).toBeDefined();
		}
	});

	it("does not mutate a material shared with another root", () => {
		const { root, a, shared } = twoMeshes();
		const other = new Mesh(new BoxGeometry(), shared);
		applyLook(root, { envIntensity: 0.3, saturation: 0.5 });
		expect(other.material).toBe(shared);
		expect(shared.envMapIntensity).toBe(1);
		expect(a.material).not.toBe(shared);
	});

	it("keeps sharing within one root (one clone per source material)", () => {
		const root = new Group();
		const shared = new MeshStandardMaterial();
		const a = new Mesh(new BoxGeometry(), shared);
		const b = new Mesh(new BoxGeometry(), shared);
		root.add(a, b);
		applyLook(root, { saturation: 0.8 });
		expect(a.material).toBe(b.material);
	});

	it("does not throw on a MeshBasicMaterial with no maps", () => {
		const root = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
		expect(() =>
			applyLook(root, { envIntensity: 0.5, saturation: 0.9 }),
		).not.toThrow();
	});
});
