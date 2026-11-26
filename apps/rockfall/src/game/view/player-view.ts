import { readSlot } from "@pebble3d/renderer";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
	cameraPosition,
	float,
	length,
	normalWorld,
	positionLocal,
	positionWorld,
	smoothstep,
	time,
	uniform,
	vec3,
} from "three/tsl";
import {
	AdditiveBlending,
	type AnimationAction,
	AnimationMixer,
	CircleGeometry,
	Color,
	LoopOnce,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	type MeshStandardMaterial,
	Object3D,
	Quaternion,
	type Scene,
	SphereGeometry,
	Vector3,
} from "three/webgpu";
import { PLAYER_CENTER_Y } from "../constants.ts";
import { PHASE } from "../phase.ts";
import type { RockfallSim } from "../sim.ts";

export const ROBOT_URL = "/assets/RobotExpressive.glb";
const SCALE = 0.4;
const TURN_RATE = 14;
const _q = new Quaternion();
const _target = new Quaternion();
const _pos = new Vector3();
const UP = new Vector3(0, 1, 0);

type Clip = "Idle" | "Running" | "Walking" | "Jump" | "Death";

/**
 * The player: the CC0 expressive robot driven from the KCC body's interpolated slot pose,
 * with locomotion clips picked from the sim's movement, a hit flash, an invulnerability
 * blink, a fresnel shield bubble and a bright ground ring so it reads amid the rubble.
 */
export class PlayerView {
	readonly root = new Object3D();
	private readonly model: Object3D;
	private readonly mixer: AnimationMixer;
	private readonly actions = new Map<Clip, AnimationAction>();
	private current: AnimationAction | null = null;
	private state: Clip | "" = "";
	private readonly facing = new Quaternion();
	private readonly flashMats: MeshStandardMaterial[] = [];
	private flash = 0;
	private readonly shield: Mesh;
	private readonly shieldOn = uniform(0);
	private readonly ring: Mesh;
	private readonly sim: RockfallSim;
	private lastX = 0;
	private lastZ = 0;

	constructor(scene: Scene, gltf: GLTF, sim: RockfallSim) {
		this.sim = sim;
		this.model = cloneSkinned(gltf.scene);
		this.model.scale.setScalar(SCALE);
		this.model.traverse((o) => {
			const m = o as Mesh;
			if (!m.isMesh) return;
			m.castShadow = true;
			m.receiveShadow = true;
			const mats = Array.isArray(m.material) ? m.material : [m.material];
			const cloned = mats.map((x: Material) => {
				const c = x.clone() as MeshStandardMaterial;
				// Teal body: the complement of the warm quarry, so the player always pops.
				if (c.name === "Main") c.color.set(0x1fb5cf);
				if (c.emissive) this.flashMats.push(c);
				return c;
			});
			m.material = Array.isArray(m.material) ? cloned : (cloned[0] as Material);
		});
		this.root.add(this.model);
		scene.add(this.root);
		this.mixer = new AnimationMixer(this.model);
		for (const clip of gltf.animations) {
			const name = clip.name as Clip;
			if (!["Idle", "Running", "Walking", "Jump", "Death"].includes(name))
				continue;
			const a = this.mixer.clipAction(clip);
			if (name === "Death" || name === "Jump") {
				a.setLoop(LoopOnce, 1);
				a.clampWhenFinished = true;
			}
			this.actions.set(name, a);
		}

		// Shield: fresnel bubble, additive.
		const sm = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		const view = cameraPosition.sub(positionWorld).normalize();
		const fres = float(1).sub(normalWorld.dot(view).abs()).pow(2.2);
		const hex = positionLocal.y
			.mul(18)
			.add(time.mul(3))
			.sin()
			.mul(0.5)
			.add(0.5);
		sm.colorNode = vec3(0.35, 0.85, 1.6)
			.mul(fres.mul(1.6).add(hex.mul(0.08)))
			.mul(this.shieldOn);
		this.shield = new Mesh(new SphereGeometry(1.05, 32, 20), sm);
		this.shield.position.y = 0.95;
		this.shield.visible = false;
		this.root.add(this.shield);

		// Ground ring: always-on locator.
		const rm = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		const r = length(positionLocal.xz);
		rm.colorNode = vec3(0.5, 2.2, 2.8).mul(
			smoothstep(0.78, 0.92, r).mul(float(1).sub(smoothstep(0.92, 1, r))),
		);
		const rg = new CircleGeometry(0.85, 48);
		rg.rotateX(-Math.PI / 2);
		this.ring = new Mesh(rg, rm);
		this.ring.position.y = 0.05;
		this.ring.renderOrder = 4;
		this.root.add(this.ring);
		this.play("Idle");
	}

	hit(): void {
		this.flash = 1;
	}

	/** World reset: snap the facing. */
	reset(): void {
		this.state = "";
		this.mixer.stopAllAction();
		this.current = null;
		this.play("Idle");
	}

	update(dt: number, alpha: number): void {
		const sim = this.sim;
		const v = sim.views;
		if (readSlot(v.prev, v.curr, sim.playerSlot, alpha, _pos, _q)) {
			this.root.position.set(_pos.x, _pos.y - PLAYER_CENTER_Y + 0.02, _pos.z);
		}
		const dx = this.root.position.x - this.lastX;
		const dz = this.root.position.z - this.lastZ;
		this.lastX = this.root.position.x;
		this.lastZ = this.root.position.z;
		const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;

		let want: Clip = "Idle";
		if (sim.phase === PHASE.OVER) want = "Death";
		else if (!sim.grounded) want = "Jump";
		else if (speed > 5.6) want = "Running";
		else if (speed > 0.6) want = "Walking";
		this.play(want);
		const run = this.actions.get("Running");
		if (run) run.timeScale = Math.max(0.8, speed / 6.2);
		const walk = this.actions.get("Walking");
		if (walk) walk.timeScale = Math.max(0.7, speed / 2.6);

		// Face the input direction (knockback faces away from the hit: it is the input too).
		if (
			sim.phase !== PHASE.OVER &&
			sim.moveX * sim.moveX + sim.moveZ * sim.moveZ > 0.04
		)
			_target.setFromAxisAngle(UP, Math.atan2(sim.moveX, sim.moveZ));
		else _target.copy(this.facing);
		this.facing.slerp(_target, 1 - Math.exp(-TURN_RATE * dt));
		this.root.quaternion.copy(this.facing);

		// Hit flash (emissive red) and invulnerability blink.
		this.flash = Math.max(0, this.flash - dt * 3.5);
		for (const m of this.flashMats)
			m.emissive.setRGB(this.flash * 2.2, this.flash * 0.25, 0);
		const blink = sim.invuln > 0 && sim.phase !== PHASE.OVER;
		this.model.visible = !blink || Math.floor(sim.invuln / 4) % 2 === 0;

		this.shield.visible = sim.shield;
		this.shieldOn.value = sim.shield ? 1 : 0;
		this.ring.visible = sim.phase !== PHASE.TITLE && sim.phase !== PHASE.OVER;
		this.mixer.update(dt);
	}

	private play(name: Clip): void {
		if (this.state === name) return;
		const next = this.actions.get(name);
		if (!next) return;
		this.state = name;
		next.reset();
		next.enabled = true;
		next.setEffectiveWeight(1);
		if (this.current && this.current !== next)
			next.crossFadeFrom(this.current, 0.18, false);
		next.play();
		this.current = next;
	}
}

export const PLAYER_COLOR = new Color("#40d8ff");
