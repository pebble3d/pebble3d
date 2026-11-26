import { Object3D } from "three";
import { expect, it } from "vitest";
import { placeStatic } from "../src/place.ts";

it("places a slot-less entity at its carried transform", () => {
	const o = new Object3D();
	const s = Math.SQRT1_2;
	placeStatic(o, { position: [5, 1, 3], rotation: [0, s, 0, s] });
	expect(o.position.toArray()).toEqual([5, 1, 3]);
	expect(o.quaternion.y).toBeCloseTo(s);
	expect(o.quaternion.w).toBeCloseTo(s);
});

it("leaves the object untouched without a transform", () => {
	const o = new Object3D();
	placeStatic(o, {});
	expect(o.position.toArray()).toEqual([0, 0, 0]);
	expect(o.quaternion.w).toBe(1);
});
