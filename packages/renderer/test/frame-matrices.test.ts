import { Object3D, Scene } from "three";
import { expect, it } from "vitest";
import { renderWithFrozenMatrices } from "../src/frame-matrices.ts";

it("updates world matrices once and suspends auto-update during the render", () => {
	const scene = new Scene();
	const o = new Object3D();
	scene.add(o);
	o.position.set(1, 2, 3);
	let autoDuring = true;
	renderWithFrozenMatrices(scene, () => {
		autoDuring = scene.matrixWorldAutoUpdate;
		expect(o.matrixWorld.elements[12]).toBe(1);
	});
	expect(autoDuring).toBe(false);
	expect(scene.matrixWorldAutoUpdate).toBe(true);
});

it("restores matrixWorldAutoUpdate when the render throws", () => {
	const scene = new Scene();
	expect(() =>
		renderWithFrozenMatrices(scene, () => {
			throw new Error("boom");
		}),
	).toThrow("boom");
	expect(scene.matrixWorldAutoUpdate).toBe(true);
});

it("leaves a scene with auto-update off alone", () => {
	const scene = new Scene();
	scene.matrixWorldAutoUpdate = false;
	const o = new Object3D();
	scene.add(o);
	o.position.set(1, 0, 0);
	renderWithFrozenMatrices(scene, () => {});
	expect(o.matrixWorld.elements[12]).toBe(0);
	expect(scene.matrixWorldAutoUpdate).toBe(false);
});
