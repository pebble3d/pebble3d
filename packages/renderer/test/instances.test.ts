import {
	BoxGeometry,
	Color,
	Matrix4,
	MeshStandardNodeMaterial,
	Quaternion,
	Scene,
	Vector3,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
	ACTIVE,
	InstanceRegistry,
	NO_INTERP,
} from "../src/dynamics/instances.ts";

const STRIDE = 8;

function buffers(slots: number) {
	const prev = new Float32Array(slots * STRIDE);
	const curr = new Float32Array(slots * STRIDE);
	for (let s = 0; s < slots; s++) {
		prev[s * STRIDE + 6] = 1; // qw
		curr[s * STRIDE + 6] = 1;
		curr[s * STRIDE + 7] = ACTIVE;
	}
	return { prev, curr };
}

function setup(slots: number) {
	const scene = new Scene();
	const reg = new InstanceRegistry(scene);
	const geo = new BoxGeometry(1, 1, 1);
	const mat = new MeshStandardNodeMaterial();
	for (let s = 0; s < slots; s++) reg.add("box", geo, mat, s);
	return { scene, reg, geo, mat, ...buffers(slots) };
}

const m = new Matrix4();
const p = new Vector3();
const q = new Quaternion();
const sc = new Vector3();

function translationAt(reg: InstanceRegistry, index: number): Vector3 {
	const mesh = reg.meshes()[0];
	if (!mesh) throw new Error("no mesh");
	mesh.getMatrixAt(index, m);
	m.decompose(p, q, sc);
	return p.clone();
}

describe("InstanceRegistry", () => {
	it("groups slots under one InstancedMesh per key", () => {
		const { reg, scene } = setup(3);
		expect(reg.meshes()).toHaveLength(1);
		expect(reg.meshes()[0]?.count).toBe(3);
		expect(scene.children).toContain(reg.meshes()[0]);
	});

	it("interpolates position between prev and curr by alpha", () => {
		const { reg, prev, curr } = setup(3);
		prev[1 * STRIDE] = 0;
		curr[1 * STRIDE] = 2;
		reg.sync(prev, curr, 0.5);
		expect(translationAt(reg, 1).x).toBeCloseTo(1, 5);
	});

	it("slerps rotation", () => {
		const { reg, prev, curr } = setup(1);
		// curr: 90 degrees about Y
		const s = Math.SQRT1_2;
		curr[4] = s;
		curr[6] = s;
		reg.sync(prev, curr, 0.5);
		reg.meshes()[0]?.getMatrixAt(0, m);
		m.decompose(p, q, sc);
		const expected = new Quaternion().setFromAxisAngle(
			new Vector3(0, 1, 0),
			Math.PI / 4,
		);
		expect(q.angleTo(expected)).toBeLessThan(1e-4);
	});

	it("snaps to curr when NO_INTERP is set", () => {
		const { reg, prev, curr } = setup(3);
		curr[1 * STRIDE] = 2;
		curr[1 * STRIDE + 7] = ACTIVE | NO_INTERP;
		reg.sync(prev, curr, 0.5);
		expect(translationAt(reg, 1).x).toBeCloseTo(2, 5);
	});

	it("removeSlot swaps the last instance into the freed index", () => {
		const { reg, prev, curr } = setup(3);
		for (let s = 0; s < 3; s++) {
			prev[s * STRIDE] = s * 10;
			curr[s * STRIDE] = s * 10;
		}
		reg.removeSlot(1);
		expect(reg.meshes()[0]?.count).toBe(2);
		reg.sync(prev, curr, 1);
		expect(translationAt(reg, 0).x).toBeCloseTo(0, 5);
		expect(translationAt(reg, 1).x).toBeCloseTo(20, 5);
		// removing an unknown slot is a no-op
		reg.removeSlot(1);
		reg.removeSlot(99);
		expect(reg.meshes()[0]?.count).toBe(2);
	});

	it("moves the per-instance color along with a swapped instance", () => {
		const scene = new Scene();
		const reg = new InstanceRegistry(scene);
		const geo = new BoxGeometry();
		const mat = new MeshStandardNodeMaterial();
		reg.add("box", geo, mat, 0, new Color(1, 0, 0));
		reg.add("box", geo, mat, 1, new Color(0, 1, 0));
		reg.add("box", geo, mat, 2, new Color(0, 0, 1));
		reg.removeSlot(0);
		const c = new Color();
		reg.meshes()[0]?.getColorAt(0, c);
		expect([c.r, c.g, c.b]).toEqual([0, 0, 1]);
	});

	it("skips slots without the ACTIVE flag", () => {
		const { reg, prev, curr } = setup(3);
		curr[2 * STRIDE] = 2;
		prev[2 * STRIDE] = 2;
		reg.sync(prev, curr, 1);
		expect(translationAt(reg, 2).x).toBeCloseTo(2, 5);
		curr[2 * STRIDE] = 5;
		prev[2 * STRIDE] = 5;
		curr[2 * STRIDE + 7] = 0;
		reg.sync(prev, curr, 1);
		expect(translationAt(reg, 2).x).toBeCloseTo(2, 5);
	});

	it("grows past the initial capacity of 64 and keeps existing transforms", () => {
		const { reg, geo, mat } = setup(0);
		const total = 164;
		const { prev, curr } = buffers(total);
		for (let s = 0; s < 64; s++) reg.add("box", geo, mat, s);
		expect(reg.meshes()[0]?.instanceMatrix.count).toBe(64);
		for (let s = 0; s < 64; s++) {
			prev[s * STRIDE] = s;
			curr[s * STRIDE] = s;
		}
		reg.sync(prev, curr, 1);
		for (let s = 64; s < total; s++) reg.add("box", geo, mat, s);
		const mesh = reg.meshes()[0];
		expect(reg.meshes()).toHaveLength(1);
		expect(mesh?.count).toBe(total);
		expect(mesh?.instanceMatrix.count).toBeGreaterThanOrEqual(total);
		// existing transforms survive the grow, before any further sync
		for (const s of [0, 1, 33, 63]) {
			expect(translationAt(reg, s).x).toBeCloseTo(s, 5);
		}
	});

	it("keeps distinct keys in distinct meshes", () => {
		const { reg, geo, mat } = setup(2);
		reg.add("sphere", geo, mat, 5);
		expect(reg.meshes()).toHaveLength(2);
	});
});
