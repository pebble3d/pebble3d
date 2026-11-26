import { AnimationClip, NumberKeyframeTrack, Object3D } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { CharacterView } from "../src/character/character-view.ts";
import type { CharacterFrame } from "../src/types.ts";

const mk = (name: string) =>
	new AnimationClip(name, 1, [
		new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
	]);
const clips = () => [mk("Idle"), mk("Walk"), mk("Run")];
const fr = (speed: number): CharacterFrame => ({
	grounded: true,
	vx: speed,
	vz: 0,
	vy: 0,
	sprintSpeed: 5.5,
});
const scale = (v: CharacterView, c: AnimationClip) =>
	v.mixer.clipAction(c).timeScale;

describe("CharacterView speed matching", () => {
	const cs = clips();
	const [c0, c1, c2] = cs as [AnimationClip, AnimationClip, AnimationClip];
	const map = {
		idle: { clip: "Idle" },
		walk: { clip: "Walk", speed: 1.0 },
		run: { clip: "Run", speed: 5.8 },
	};
	it("scales walk by ground speed", () => {
		const v = new CharacterView(new Object3D(), cs, map);
		v.update(fr(1.5), 1 / 60);
		expect(scale(v, c1)).toBeCloseTo(1.5);
	});
	it("idle is 1", () => {
		const v = new CharacterView(new Object3D(), cs, map);
		v.update(fr(0), 1 / 60);
		expect(scale(v, c0)).toBe(1);
	});
	it("scales run", () => {
		const v = new CharacterView(new Object3D(), cs, map);
		v.update(fr(5.5), 1 / 60);
		expect(scale(v, c2)).toBeCloseTo(0.948, 3);
	});
	it("no speed -> 1 everywhere", () => {
		const v = new CharacterView(new Object3D(), cs, {
			idle: { clip: "Idle" },
			walk: { clip: "Walk" },
			run: { clip: "Run" },
		});
		for (const s of [0, 1.5, 5.5]) {
			v.update(fr(s), 1 / 60);
			for (const c of cs) expect(scale(v, c)).toBe(1);
		}
	});
	it("run sharing walk's action uses that clip's speed", () => {
		const v = new CharacterView(new Object3D(), cs, {
			idle: { clip: "Idle" },
			walk: { clip: "Walk", speed: 1.0 },
		});
		v.update(fr(5.5), 1 / 60);
		expect(scale(v, c1)).toBe(1.6);
	});
});
