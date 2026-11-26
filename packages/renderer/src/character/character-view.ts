import {
	type AnimationAction,
	type AnimationClip,
	AnimationMixer,
	LoopOnce,
	LoopRepeat,
	type Object3D,
	Quaternion,
	Vector3,
} from "three/webgpu";
import type { AnimClipSpec, AnimState, CharacterFrame } from "../types.ts";
import { IDLE_SPEED, locomotionTimeScale, pickAnimState } from "./anim.ts";

/** Cross-fade length between animation states, seconds. */
export const CROSSFADE_SECONDS = 0.2;
/** Facing slerp rate toward the velocity direction, 1/s. */
const TURN_RATE = 12;

const STATES: readonly AnimState[] = ["idle", "walk", "run", "jump", "fall"];
/** Used when a state has no clip of its own (first mapped one wins). */
const FALLBACKS: Record<AnimState, readonly AnimState[]> = {
	idle: [],
	walk: ["idle"],
	run: ["walk", "idle"],
	jump: ["fall", "idle"],
	fall: ["jump", "idle"],
};

const UP = new Vector3(0, 1, 0);
const _target = new Quaternion();

/**
 * Drives one character's visuals from its sim state: a state machine over the mapped clips
 * (0.2 s cross-fades, only on a state change) and a facing that slerps toward
 * `atan2(vx, vz)` while moving faster than 0.1 m/s (the model faces +Z at yaw 0).
 * The sim never rotates a character, so the facing is kept here and written to
 * `root.quaternion` after each sync. `update` does not allocate.
 */
export class CharacterView {
	readonly root: Object3D;
	readonly mixer: AnimationMixer;
	private readonly actions = new Map<AnimState, AnimationAction>();
	/** Authored ground speed per action (not per state), so shared actions stay consistent. */
	private readonly authored = new Map<AnimationAction, number | undefined>();
	private state: AnimState = "idle";
	private current: AnimationAction | null = null;
	private readonly facing = new Quaternion();
	private facingInit = false;

	constructor(
		root: Object3D,
		clips: AnimationClip[],
		clipMap: Partial<Record<AnimState, AnimClipSpec>>,
	) {
		this.root = root;
		this.mixer = new AnimationMixer(root);
		const byClip = new Map<string, AnimationAction>();
		const own = (s: AnimState): AnimationAction | undefined => {
			const name = clipMap[s]?.clip;
			if (name === undefined) return undefined;
			let a = byClip.get(name);
			if (!a) {
				const clip = clips.find((c) => c.name === name);
				if (!clip) return undefined;
				a = this.mixer.clipAction(clip);
				byClip.set(name, a);
			}
			return a;
		};
		for (const s of STATES) {
			let a = own(s);
			for (const f of FALLBACKS[s]) a ??= own(f);
			if (a) {
				this.actions.set(s, a);
				if (!this.authored.has(a)) {
					const owner = [s, ...FALLBACKS[s]].find((k) => own(k) === a);
					this.authored.set(a, owner && clipMap[owner]?.speed);
				}
			}
		}
		// Jump (and whatever it shares a clip with) plays once and holds its last pose.
		const once = this.actions.get("jump");
		for (const a of byClip.values()) {
			const isOnce = a === once;
			a.setLoop(isOnce ? LoopOnce : LoopRepeat, Number.POSITIVE_INFINITY);
			a.clampWhenFinished = isOnce;
		}
		const first = this.actions.get("idle") ?? null;
		if (first) {
			first.play();
			this.current = first;
		}
	}

	/** The state picked on the last update. */
	get animState(): AnimState {
		return this.state;
	}

	update(f: CharacterFrame, dt: number): void {
		const next = pickAnimState(f);
		if (next !== this.state) {
			this.state = next;
			const a = this.actions.get(next) ?? null;
			if (a && a !== this.current) {
				a.reset();
				a.play();
				if (this.current)
					a.crossFadeFrom(this.current, CROSSFADE_SECONDS, false);
				this.current = a;
			}
		}

		if (this.current) {
			this.current.timeScale =
				this.state === "walk" || this.state === "run"
					? locomotionTimeScale(
							Math.hypot(f.vx, f.vz),
							this.authored.get(this.current),
						)
					: 1;
		}

		if (!this.facingInit) {
			this.facing.copy(this.root.quaternion);
			this.facingInit = true;
		}
		if (Math.hypot(f.vx, f.vz) > IDLE_SPEED) {
			_target.setFromAxisAngle(UP, Math.atan2(f.vx, f.vz));
			this.facing.slerp(_target, 1 - Math.exp(-TURN_RATE * dt));
		}
		this.root.quaternion.copy(this.facing);
		this.mixer.update(dt);
	}

	dispose(): void {
		this.mixer.stopAllAction();
		this.mixer.uncacheRoot(this.root);
	}
}
