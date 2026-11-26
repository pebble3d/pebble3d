import {
	type AnimationAction,
	AnimationClip,
	NumberKeyframeTrack,
	Object3D,
	Vector3,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import { locomotionTimeScale, pickAnimState } from "../src/character/anim.ts";
import { CharacterView } from "../src/character/character-view.ts";
import type { CharacterFrame } from "../src/types.ts";

const frame = (
	grounded: boolean,
	vx: number,
	vz: number,
	vy: number,
): CharacterFrame => ({ grounded, vx, vz, vy, sprintSpeed: 7 });

describe("pickAnimState (sprintSpeed 7)", () => {
	it("grounded, speed 0 -> idle", () => {
		expect(pickAnimState(frame(true, 0, 0, 0))).toBe("idle");
	});
	it("grounded, speed 3 -> walk", () => {
		expect(pickAnimState(frame(true, 3, 0, 0))).toBe("walk");
	});
	it("grounded, speed 6.5 -> run", () => {
		expect(pickAnimState(frame(true, 0, 6.5, 0))).toBe("run");
	});
	it("uses the XZ speed magnitude", () => {
		// |(3,4)| = 5 < 0.75 * 7 = 5.25 -> walk; |(4,4)| ~ 5.66 -> run
		expect(pickAnimState(frame(true, 3, 4, 0))).toBe("walk");
		expect(pickAnimState(frame(true, 4, 4, 0))).toBe("run");
	});
	it("airborne, vy 2 -> jump", () => {
		expect(pickAnimState(frame(false, 3, 0, 2))).toBe("jump");
	});
	it("airborne, vy -2 -> fall", () => {
		expect(pickAnimState(frame(false, 0, 0, -2))).toBe("fall");
	});
});

describe("CharacterView", () => {
	const setup = () => {
		const root = new Object3D();
		const bone = new Object3D();
		bone.name = "b";
		root.add(bone);
		const clip = (name: string) =>
			new AnimationClip(name, 1, [
				new NumberKeyframeTrack("b.position[x]", [0, 1], [0, 1]),
			]);
		const clips = ["Idle", "Walk", "Jump"].map(clip);
		const view = new CharacterView(root, clips, {
			idle: { clip: "Idle" },
			walk: { clip: "Walk" },
			jump: { clip: "Jump" },
			fall: { clip: "Jump" },
		});
		root.animations = clips;
		return { root, view };
	};
	const act = (view: CharacterView, name: string) =>
		view.mixer.existingAction(
			AnimationClip.findByName(
				view.mixer.getRoot() as Object3D & { animations: AnimationClip[] },
				name,
			) as AnimationClip,
		) as AnimationAction;

	it("cross-fades over 0.2 s, only when the state changes", () => {
		const { view } = setup();
		const idle = act(view, "Idle");
		const walk = act(view, "Walk");
		view.update(frame(true, 0, 0, 0), 1 / 60);
		expect(view.animState).toBe("idle");
		expect(idle.isRunning()).toBe(true);
		view.update(frame(true, 3, 0, 0), 1 / 60);
		expect(view.animState).toBe("walk");
		expect(walk.isRunning()).toBe(true);
		// mid-fade both contribute; after 0.2 s idle is out
		expect(idle.getEffectiveWeight()).toBeGreaterThan(0);
		expect(idle.getEffectiveWeight()).toBeLessThan(1);
		const walkTime = walk.time;
		for (let i = 0; i < 12; i++) view.update(frame(true, 3, 0, 0), 1 / 60);
		expect(idle.getEffectiveWeight()).toBe(0);
		expect(walk.getEffectiveWeight()).toBe(1);
		// staying in walk never resets the clip
		expect(walk.time).toBeGreaterThan(walkTime);
	});

	it("jump and fall share one clip without a re-fade", () => {
		const { view } = setup();
		view.update(frame(false, 0, 0, 3), 1 / 60);
		const jump = act(view, "Jump");
		for (let i = 0; i < 20; i++) view.update(frame(false, 0, 0, 3), 1 / 60);
		const t = jump.time;
		view.update(frame(false, 0, 0, -1), 1 / 60);
		expect(view.animState).toBe("fall");
		expect(jump.time).toBeGreaterThanOrEqual(t); // not reset
	});

	it("faces the velocity direction, and keeps facing when idle", () => {
		const { root, view } = setup();
		for (let i = 0; i < 120; i++) view.update(frame(true, -3, 0, 0), 1 / 60);
		const fwd = new Vector3(0, 0, 1).applyQuaternion(root.quaternion);
		expect(fwd.x).toBeCloseTo(-1, 3);
		for (let i = 0; i < 10; i++) view.update(frame(true, 0, 0, 0), 1 / 60);
		fwd.set(0, 0, 1).applyQuaternion(root.quaternion);
		expect(fwd.x).toBeCloseTo(-1, 3);
	});
});

describe("locomotionTimeScale", () => {
	it("scales and clamps", () => {
		expect(locomotionTimeScale(1.5, 1.0)).toBeCloseTo(1.5);
		expect(locomotionTimeScale(1.0, 1.0)).toBe(1);
		expect(locomotionTimeScale(5.5, 5.8)).toBeCloseTo(0.948, 3);
		expect(locomotionTimeScale(0.05, 1.0)).toBe(0.6);
		expect(locomotionTimeScale(9, 1.0)).toBe(1.6);
		expect(locomotionTimeScale(3, undefined)).toBe(1);
	});
});
