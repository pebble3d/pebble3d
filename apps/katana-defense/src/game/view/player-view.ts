import {
	applyLook,
	type CharacterFrame,
	CharacterView,
	type LookSpec,
} from "@pebble3d/renderer";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
	type Bone,
	type Group,
	Matrix4,
	type Mesh,
	type MeshStandardNodeMaterial,
	Object3D,
	Quaternion,
	type Scene,
	type SkinnedMesh,
	Vector3,
} from "three/webgpu";
import type { MoveDef } from "../combat/moves.ts";
import { channel, POSE_CHANNELS, poseDir, samplePose } from "../combat/pose.ts";
import type { GameSim } from "../sim.ts";
import { BLADE_LENGTH, createKatana, GRIP_LENGTH } from "./katana.ts";
import { CORD_TAIL, clothMaterial, NinjaGear } from "./ninja-gear.ts";
import { NINJA_PALETTE, ninjaBodyColor, ninjaHeadColor } from "./ninja-look.ts";
import { Ribbon } from "./ribbon.ts";
import { solveTwoBone } from "./two-bone-ik.ts";

/** The player's Rocketbox avatar: clips and authored ground speeds (assets.manifest.json). */
export const PLAYER_MODEL = {
	url: "/assets/rocketbox-male-adult-16.glb",
	clips: {
		idle: { clip: "Idle" },
		walk: { clip: "Walk", speed: 0.979 },
		run: { clip: "Run", speed: 5.649 },
		jump: { clip: "Jump" },
		fall: { clip: "Fall" },
	},
	look: { envIntensity: 1.1, saturation: 0.9 } satisfies LookSpec,
} as const;

const UP = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;
/** Visual facing smoothing, 1/s (the sim snaps facing at move starts). */
const FACE_RATE = 28;
/** Rest-pose return rate after a move, 1/s. */
const REST_RATE = 12;
/** Upper-body layer fade in/out, 1/s. */
const LAYER_IN = 30;
const LAYER_OUT = 8;
/** Edge (roll) smoothing, 1/s. */
const EDGE_RATE = 26;
/** Chest pivot: from the clavicles' midpoint, metres forward / down in character space. */
const PIVOT_FORWARD = 0.12;
const PIVOT_DOWN = 0.2;
/** Sword hand to the left hand along the hilt (toward the pommel), metres. */
const LEFT_HAND_ALONG = 0.1;
/** The guard (tsuba) in front of the sword hand's palm centre, metres. */
const GUARD_AHEAD = 0.05;
/** Spine layer: share of the arm yaw turned by the torso, and bend per degree of pitch. */
const TWIST_SHARE = 0.42;
const BEND_DOWN = 0.32;
const BEND_UP = 0.12;
/** Spine1/Spine2 only: in Bip01 the thighs hang off "Bip01 Spine", so turning it moves the legs. */
const SPINE = ["Bip01 Spine1", "Bip01 Spine2"];
/** Fist curl per finger joint, radians (index -> pinky get progressively more). */
const CURL = [0.95, 1.15, 0.9];
const CURL_SIGN = -1;

const _q = new Quaternion();
const _q2 = new Quaternion();
const _qp = new Quaternion();
const _v = new Vector3();
const _v2 = new Vector3();
const _fwd = new Vector3();
const _left = new Vector3();
const _pivot = new Vector3();
const _target = new Vector3();
const _blade = new Vector3();
const _edge = new Vector3();
const _spine = new Vector3();
const _pole = new Vector3();
const _m = new Matrix4();
const _qk = new Quaternion();
const _c0 = new Vector3();
const _c1 = new Vector3();
const _c2 = new Vector3();
const _cq = new Quaternion();
const _cq2 = new Quaternion();
const _qh = new Quaternion();
const _d = { x: 0, y: 0, z: 0 };

function boneName(name: string): string {
	// GLTFLoader sanitises node names: whitespace -> "_", reserved characters removed.
	return name.replace(/\s/g, "_");
}

function findBone(root: Object3D, name: string): Bone {
	const want = boneName(name);
	let out: Bone | null = null;
	root.traverse((o) => {
		if (!out && (o as Bone).isBone && o.name === want) out = o as Bone;
	});
	if (!out) throw new Error(`player rig: bone "${name}" not found`);
	return out;
}

/** Writes `world` as `bone`'s world rotation (its parent's world matrix must be current). */
function setWorldQuat(bone: Object3D, world: Quaternion): void {
	const parent = bone.parent;
	if (parent) {
		parent.getWorldQuaternion(_qp);
		bone.quaternion.copy(_qp.invert().multiply(world));
	} else bone.quaternion.copy(world);
}

/** One arm of the Bip01 rig and its rest measurements. */
interface Arm {
	upper: Bone;
	fore: Bone;
	hand: Bone;
	fingers: Bone[][];
	thumb: Bone[];
	upperLen: number;
	foreLen: number;
	/** Hand-local grip frame: katana +Z (toward the blade) and +Y (spine) in hand space. */
	gripRot: Quaternion;
	/** Hand-local position of the grip centre (source units). */
	gripPos: Vector3;
	/** The same in metres (world scale), for the wrist target. */
	gripPosM: Vector3;
	/** Rest (animated) local rotations captured each frame before the IK, for blending. */
	animUpper: Quaternion;
	animFore: Quaternion;
	animHand: Quaternion;
}

/**
 * The player's visuals: the Rocketbox swordsman. `CharacterView` plays the locomotion clips;
 * a procedural sword layer is written over them every frame from the move's pose keys:
 *  - the spine (Spine, Spine1, Spine2) twists and bends with the swing;
 *  - the sword hand reaches a target around a chest pivot with analytic two-bone IK (elbow
 *    down and out), and is oriented so the katana, parented to the hand bone, points along
 *    the pose's blade direction with the edge leading the swing;
 *  - the left hand is IK'd onto the hilt for two-handed keys (weighted by the pose's grip
 *    and by reach), and both hands close into a fist.
 * Exposes the blade's world base/tip for the trail. `update` does not allocate.
 */
export class PlayerView {
	readonly root = new Object3D();
	readonly model: Object3D;
	readonly katana: Group;
	readonly cv: CharacterView;
	readonly bladeBase = new Vector3();
	readonly bladeTip = new Vector3();
	/** Blade base/tip on the previous rendered frame (trail sub-sampling). */
	readonly prevBase = new Vector3();
	readonly prevTip = new Vector3();
	/** Current sword pose (armYaw, armPitch, bladeYaw, bladePitch, reach, grip). */
	readonly pose = new Float32Array(POSE_CHANNELS);
	private readonly poseFrom = new Float32Array(POSE_CHANNELS);
	private readonly ahead = new Float32Array(POSE_CHANNELS);
	private readonly behind = new Float32Array(POSE_CHANNELS);
	private readonly right: Arm;
	private readonly left: Arm;
	private readonly spine: Bone[];
	private readonly clavL: Bone;
	private readonly clavR: Bone;
	private readonly head: Bone;
	private readonly facing = new Quaternion();
	/** Smoothed edge direction (world), the katana's -Y. */
	private readonly edge = new Vector3(0, -1, 0);
	/** Debug (?pose=move:frame): hold this move's pose at this frame. */
	hold: { def: MoveDef; frame: number } | null = null;
	/** Diagnostics (debug hook): left-hand weight and shoulder->wrist-target distance. */
	readonly diag = { leftW: 0, leftDist: 0, leftReach: 0 };
	/** Debug markers (?rigdbg=1): right target, left target, right elbow, left elbow. */
	markers: Object3D[] | null = null;
	private layer = 0;
	private leftW = 1;
	private lastSwing = -1;
	private readonly frameState: CharacterFrame = {
		grounded: true,
		vx: 0,
		vz: 0,
		vy: 0,
		sprintSpeed: 4.2,
	};
	private readonly sim: GameSim;
	/** The model's materials (hit flash tint). */
	private readonly mats: MeshStandardNodeMaterial[] = [];
	private flash = 0;
	/** Headband and sash tails (verlet cloth). */
	readonly gear: NinjaGear;
	/** The red cord (sageo) hanging from the katana's pommel. */
	private readonly cord: Ribbon;

	constructor(scene: Scene, gltf: GLTF, sim: GameSim) {
		this.sim = sim;
		const model = cloneSkinned(gltf.scene);
		applyLook(model, PLAYER_MODEL.look);
		model.traverse((o) => {
			const m = o as Mesh;
			if (m.isMesh) {
				m.castShadow = true;
				m.receiveShadow = true;
				// one emissive-capable copy per material for the hurt flash
				const src = m.material as MeshStandardNodeMaterial;
				const mat = src.clone() as MeshStandardNodeMaterial;
				// the ninja outfit, painted over the avatar's textures by bind-pose region
				mat.colorNode = /head/i.test(src.name)
					? ninjaHeadColor()
					: ninjaBodyColor();
				m.material = mat;
				this.mats.push(mat);
			}
		});
		this.model = model;
		this.root.add(model);
		this.root.name = "player";
		scene.add(this.root);
		this.cv = new CharacterView(this.root, gltf.animations, PLAYER_MODEL.clips);
		this.spine = SPINE.map((n) => findBone(model, n));
		this.clavL = findBone(model, "Bip01 L Clavicle");
		this.clavR = findBone(model, "Bip01 R Clavicle");
		this.head = findBone(model, "Bip01 Head");
		this.root.updateMatrixWorld(true);
		this.right = this.arm(model, "R");
		this.left = this.arm(model, "L");

		this.katana = createKatana();
		// Parented to the sword hand: the bone hierarchy is in source units (cm), so the
		// katana carries the inverse of the hand's world scale.
		const hand = this.right.hand;
		hand.getWorldScale(_v);
		this.katana.scale.setScalar(1 / _v.x);
		this.katana.quaternion.copy(this.right.gripRot);
		// the guard sits GUARD_AHEAD in front of the palm centre
		this.katana.position
			.set(0, 0, GUARD_AHEAD * this.katana.scale.x)
			.applyQuaternion(this.right.gripRot)
			.add(this.right.gripPos);
		hand.add(this.katana);
		let skinned: SkinnedMesh | null = null;
		model.traverse((o) => {
			if (!skinned && (o as SkinnedMesh).isSkinnedMesh)
				skinned = o as SkinnedMesh;
		});
		if (!skinned) throw new Error("player rig: no skinned mesh");
		this.gear = new NinjaGear(scene, skinned, (n) => findBone(model, n));
		this.cord = new Ribbon(
			clothMaterial(NINJA_PALETTE.headband),
			CORD_TAIL,
			0.5,
		);
		scene.add(this.cord.mesh);
		const rest = sim.moves.rest;
		for (let i = 0; i < POSE_CHANNELS; i++) this.pose[i] = channel(rest, i, 0);
		this.facing.setFromAxisAngle(UP, sim.player.facing);
	}

	/** Bones and rest measurements of one arm (`side` "L" | "R"). */
	private arm(model: Object3D, side: "L" | "R"): Arm {
		const b = (n: string) => findBone(model, `Bip01 ${side} ${n}`);
		const upper = b("UpperArm");
		const fore = b("Forearm");
		const hand = b("Hand");
		const fingers: Bone[][] = [];
		for (let f = 1; f <= 4; f++)
			fingers.push([b(`Finger${f}`), b(`Finger${f}1`), b(`Finger${f}2`)]);
		const thumb = [b("Finger0"), b("Finger01"), b("Finger02")];
		const p0 = upper.getWorldPosition(new Vector3());
		const p1 = fore.getWorldPosition(new Vector3());
		const p2 = hand.getWorldPosition(new Vector3());
		// Grip frame in hand space. Hand axes (Bip01): X along the fingers, Y the palm normal,
		// Z toward the thumb (right hand; -Z on the left). The hilt runs across the palm from
		// the heel to the thumb-index web; the edge faces the knuckles (+X), the spine the
		// wrist. Positions are in the hand's local (cm) units.
		const thumbSide = side === "R" ? 1 : -1;
		const z = new Vector3(0.38, 0.12, thumbSide).normalize();
		const y = new Vector3(-1, 0, 0);
		y.addScaledVector(z, -y.dot(z)).normalize();
		const x = new Vector3().crossVectors(y, z);
		const gripRot = new Quaternion().setFromRotationMatrix(
			new Matrix4().makeBasis(x, y, z),
		);
		hand.getWorldScale(_v);
		const s = 1 / _v.x;
		// palm centre: ~8.5 cm along the fingers, 2.5 cm into the palm
		const gripPosM = new Vector3(0.085, 0.025, 0);
		const gripPos = gripPosM.clone().multiplyScalar(s);
		return {
			upper,
			fore,
			hand,
			fingers,
			thumb,
			upperLen: p0.distanceTo(p1),
			foreLen: p1.distanceTo(p2),
			gripRot,
			gripPos,
			gripPosM,
			animUpper: new Quaternion(),
			animFore: new Quaternion(),
			animHand: new Quaternion(),
		};
	}

	/** `alpha`: interpolation between the sim's previous and current tick. */
	update(dt: number, alpha: number): void {
		const s = this.sim;
		const p = s.player;
		const frozen = s.hitstop > 0;
		const adt = frozen ? dt * 0.05 : dt;
		this.prevBase.copy(this.bladeBase);
		this.prevTip.copy(this.bladeTip);
		this.root.position.set(
			p.px + (p.x - p.px) * alpha,
			p.py + (p.y - p.py) * alpha,
			p.pz + (p.z - p.pz) * alpha,
		);
		const c = s.combo;
		const d = this.hold?.def ?? c.def;
		const f = this.frameState;
		f.grounded = p.grounded;
		const attacking = d !== null && d.dash.length === 0;
		f.vx = attacking ? 0 : p.vx;
		f.vz = attacking ? 0 : p.vz;
		f.vy = p.vy;
		this.cv.update(f, adt);

		// facing from the sim (plus the Spin Storm spin), smoothed
		_q.setFromAxisAngle(UP, p.facing + (d?.spin ? p.spin : 0));
		if (d?.spin) this.facing.copy(_q);
		else this.facing.slerp(_q, 1 - Math.exp(-FACE_RATE * dt));
		this.root.quaternion.copy(this.facing);
		if (!p.alive) {
			// collapsed: tip over backwards
			_q2.setFromAxisAngle(_v.set(1, 0, 0), -1.35);
			this.root.quaternion.multiply(_q2);
		}
		this.root.updateMatrixWorld(true);

		// sword pose: the move's keys, or a guard that eases toward the run carry with speed
		const speed = Math.hypot(p.vx, p.vz);
		if (d) {
			if (c.swing !== this.lastSwing) {
				this.lastSwing = c.swing;
				this.poseFrom.set(this.pose);
			}
			const frame = this.hold
				? this.hold.frame
				: Math.min(d.total, c.frame + (frozen ? 0 : alpha));
			samplePose(d.pose, frame, this.pose, this.poseFrom);
			samplePose(
				d.pose,
				Math.min(d.total, frame + 3),
				this.ahead,
				this.poseFrom,
			);
			samplePose(d.pose, Math.max(0, frame - 1), this.behind, this.poseFrom);
		} else {
			const rest = s.moves.rest;
			const run = s.moves.restRun;
			const kr = Math.min(1, Math.max(0, (speed - 2.2) / 2.5));
			const k = 1 - Math.exp(-REST_RATE * dt);
			for (let i = 0; i < POSE_CHANNELS; i++) {
				const want =
					channel(rest, i, 0) + (channel(run, i, 0) - channel(rest, i, 0)) * kr;
				this.pose[i] =
					(this.pose[i] as number) + (want - (this.pose[i] as number)) * k;
			}
			this.ahead.set(this.pose);
			this.behind.set(this.pose);
			this.lastSwing = -1;
		}
		const lk = 1 - Math.exp(-(d ? LAYER_IN : LAYER_OUT) * dt);
		this.layer += ((d && p.alive ? 1 : 0) - this.layer) * lk;
		this.applySword(dt);
		this.updateCloth(adt);

		if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 6);
		const e = this.flash;
		for (let i = 0; i < this.mats.length; i++)
			(this.mats[i] as MeshStandardNodeMaterial).emissive.setRGB(
				e * 0.9,
				e * 0.08,
				e * 0.05,
			);
	}

	/** Verlet cloth after the final pose: headband and sash tails, the sword cord. */
	private updateCloth(dt: number): void {
		this.gear.update(dt);
		const k = this.katana;
		_v.set(0, 0, -GRIP_LENGTH - 0.02).applyMatrix4(k.matrixWorld);
		_v2
			.set(0, 0, -GRIP_LENGTH - 0.1)
			.applyMatrix4(k.matrixWorld)
			.sub(_v);
		_v2.normalize();
		_spine.set(1, 0, 0).transformDirection(k.matrixWorld);
		this.cord.update(dt, _v, _spine, _v2);
	}

	/** Red hurt flash (0..1). */
	hurt(): void {
		this.flash = 1;
	}

	/** Character-space pose direction -> world unit vector. */
	private dirWorld(yaw: number, pitch: number, out: Vector3): Vector3 {
		poseDir(yaw, pitch, _d);
		return out.set(_d.x, _d.y, _d.z).applyQuaternion(this.facing);
	}

	private applySword(dt: number): void {
		const pose = this.pose;
		const w = this.layer;
		_fwd.set(0, 0, 1).applyQuaternion(this.facing);
		_left.crossVectors(UP, _fwd).normalize();

		// --- spine: twist toward the swing, bend into low cuts, arch for overhead ones
		if (w > 1e-3) {
			const yaw = pose[0] as number;
			const pitch = pose[1] as number;
			const twist = (-yaw * TWIST_SHARE * DEG * w) / SPINE.length;
			const bend =
				((pitch < 0 ? -pitch * BEND_DOWN : -pitch * BEND_UP) * DEG * w) /
				SPINE.length;
			for (const b of this.spine) {
				b.getWorldQuaternion(_q);
				_q2.setFromAxisAngle(UP, twist);
				_q.premultiply(_q2);
				_q2.setFromAxisAngle(_left, bend);
				_q.premultiply(_q2);
				b.parent?.updateWorldMatrix(true, false);
				setWorldQuat(b, _q);
				b.updateMatrixWorld(true);
			}
			// keep the head on the opponent: undo most of the twist and bend
			this.head.getWorldQuaternion(_q);
			_q2.setFromAxisAngle(UP, -twist * SPINE.length * 0.6);
			_q.premultiply(_q2);
			_q2.setFromAxisAngle(_left, -bend * SPINE.length * 0.5);
			_q.premultiply(_q2);
			setWorldQuat(this.head, _q);
		}
		// raise the sword-side clavicle for high guards
		const lift = Math.max(0, (pose[1] as number) - 30) * 0.004 * DEG * 60;
		if (lift > 0) {
			this.clavR.getWorldQuaternion(_q);
			_q2.setFromAxisAngle(_fwd, lift);
			_q.premultiply(_q2);
			setWorldQuat(this.clavR, _q);
		}
		this.spine[this.spine.length - 1]?.updateMatrixWorld(true);

		// --- chest pivot and the sword hand's target
		this.clavL.getWorldPosition(_pivot);
		this.clavR.getWorldPosition(_v);
		_pivot.add(_v).multiplyScalar(0.5);
		_pivot
			.addScaledVector(_fwd, PIVOT_FORWARD)
			.addScaledVector(UP, -PIVOT_DOWN);
		this.dirWorld(pose[0] as number, pose[1] as number, _v);
		_target.copy(_pivot).addScaledVector(_v, pose[4] as number);

		// --- blade frame: direction from the pose, the edge leading the swing's travel
		this.dirWorld(pose[2] as number, pose[3] as number, _blade);
		this.dirWorld(this.ahead[2] as number, this.ahead[3] as number, _v);
		this.dirWorld(this.behind[2] as number, this.behind[3] as number, _v2);
		_edge.subVectors(_v, _v2);
		_edge.addScaledVector(_blade, -_edge.dot(_blade));
		if (_edge.lengthSq() < 1e-4) {
			// no travel: edge down (or forward when the blade is vertical)
			_edge.set(0, -1, 0).addScaledVector(_fwd, 0.35);
			_edge.addScaledVector(_blade, -_edge.dot(_blade));
		}
		_edge.normalize();
		const ek = 1 - Math.exp(-EDGE_RATE * dt);
		this.edge.lerp(_edge, ek);
		this.edge.addScaledVector(_blade, -this.edge.dot(_blade));
		if (this.edge.lengthSq() < 1e-6) this.edge.copy(_edge);
		this.edge.normalize();
		_spine.copy(this.edge).negate();

		// --- sword arm. The katana's world frame (Z = blade, Y = spine) fixes the hand's
		// rotation (hand = katana * inverse(grip)); the wrist goes where that puts the grip
		// centre on the target; IK reaches the wrist.
		const R = this.right;
		_v.crossVectors(_spine, _blade);
		_m.makeBasis(_v, _spine, _blade);
		_qk.setFromRotationMatrix(_m);
		_qh.copy(R.gripRot).invert().premultiply(_qk);
		_v.copy(R.gripPosM).applyQuaternion(_qh);
		_target.sub(_v);
		_pole.copy(UP).multiplyScalar(-0.75).addScaledVector(_left, -0.75);
		_pole.addScaledVector(_fwd, -0.25);
		this.reachClavicle(this.clavR, R, _target, 1);
		this.solveArm(R, _target, _pole, 1);
		if (this.markers) {
			this.markers[0]?.position.copy(_target);
			this.markers[2]?.position.copy(ikOut.elbow);
		}
		setWorldQuat(R.hand, _qh);
		R.hand.updateMatrixWorld(true);
		this.curl(R, 1);

		// blade endpoints from the katana itself
		this.katana.getWorldPosition(this.bladeBase);
		this.bladeTip.copy(this.bladeBase).addScaledVector(_blade, BLADE_LENGTH);

		// --- left hand on the hilt, toward the pommel
		const L = this.left;
		_qh.copy(L.gripRot).invert().premultiply(_qk);
		R.hand.localToWorld(_target.copy(R.gripPos));
		_target.addScaledVector(_blade, -LEFT_HAND_ALONG);
		_v.copy(L.gripPosM).applyQuaternion(_qh);
		_target.sub(_v);
		L.upper.getWorldPosition(_v);
		const reach = L.upperLen + L.foreLen;
		const dist = _v.distanceTo(_target);
		// the clavicle can bring the shoulder ~8 cm closer; beyond that, let go of the hilt
		const reachW = Math.min(1, Math.max(0, (reach + 0.1 - dist) / 0.08));
		const wantL =
			(pose[5] as number) * reachW * (this.sim.player.alive ? 1 : 0);
		this.diag.leftDist = dist;
		this.diag.leftReach = reach;
		this.diag.leftW = this.leftW;
		this.leftW += (wantL - this.leftW) * (1 - Math.exp(-14 * dt));
		if (this.leftW > 1e-3) {
			this.reachClavicle(this.clavL, L, _target, this.leftW);
			_pole.copy(UP).multiplyScalar(-0.8).addScaledVector(_left, 0.6);
			_pole.addScaledVector(_fwd, -0.2);
			this.solveArm(L, _target, _pole, this.leftW);
			if (this.markers) {
				this.markers[1]?.position.copy(_target);
				this.markers[3]?.position.copy(ikOut.elbow);
			}
			// the left hand mirrors the grip: same blade axis and spine
			L.animHand.copy(L.hand.quaternion);
			setWorldQuat(L.hand, _qh);
			blendFrom(L.hand.quaternion, L.animHand, this.leftW);
			L.hand.updateMatrixWorld(true);
			this.curl(L, this.leftW);
		}
		this.katana.updateMatrixWorld(true);
	}

	/**
	 * Shoulder protraction: when `target` is beyond ~92 % of the arm's reach, turns the
	 * clavicle (up to ~22 degrees) so the shoulder swings toward it.
	 */
	private reachClavicle(
		clav: Bone,
		arm: Arm,
		target: Vector3,
		w: number,
	): void {
		const reach = arm.upperLen + arm.foreLen;
		clav.getWorldPosition(_c0);
		arm.upper.getWorldPosition(_c1);
		const over = _c1.distanceTo(target) - reach * 0.92;
		if (over <= 0) return;
		_c1.sub(_c0).normalize();
		_c2.subVectors(target, _c0).normalize();
		_cq.setFromUnitVectors(_c1, _c2);
		const k = Math.min(1, over / 0.12) * w;
		_cq2.identity().slerp(_cq, Math.min(0.55, k * 0.55));
		clav.getWorldQuaternion(_q);
		_q.premultiply(_cq2);
		setWorldQuat(clav, _q);
		clav.updateMatrixWorld(true);
	}

	/** Two-bone IK on `arm` toward `target` with an elbow `pole`, blended by `w`. */
	private solveArm(arm: Arm, target: Vector3, pole: Vector3, w: number): void {
		arm.animUpper.copy(arm.upper.quaternion);
		arm.animFore.copy(arm.fore.quaternion);
		arm.upper.getWorldPosition(_v);
		solveTwoBone(_v, target, pole, arm.upperLen, arm.foreLen, ikOut);
		// bone frames: X along the bone, Z the elbow hinge (Bip01), Y = Z x X
		setBoneFrame(arm.upper, ikOut.upperDir, ikOut.hinge);
		// (slerpQuaternions(a, b, t) copies `a` into `this` first, so blend from a copy)
		if (w < 1) blendFrom(arm.upper.quaternion, arm.animUpper, w);
		arm.upper.updateMatrixWorld(true);
		setBoneFrame(arm.fore, ikOut.foreDir, ikOut.hinge);
		if (w < 1) blendFrom(arm.fore.quaternion, arm.animFore, w);
		arm.fore.updateMatrixWorld(true);
	}

	/** Closes the hand into a fist around the hilt (weight `w`). */
	private curl(arm: Arm, w: number): void {
		for (let f = 0; f < arm.fingers.length; f++) {
			const chain = arm.fingers[f] as Bone[];
			const extra = f * 0.08;
			for (let j = 0; j < chain.length; j++) {
				_q.setFromAxisAngle(
					_v.set(0, 0, CURL_SIGN),
					((CURL[j] as number) + extra) * w,
				);
				(chain[j] as Bone).quaternion.multiply(_q);
			}
		}
		for (let j = 0; j < arm.thumb.length; j++) {
			_q.setFromAxisAngle(_v.set(0, 0, 1), (j === 0 ? 0.25 : 0.55) * w);
			(arm.thumb[j] as Bone).quaternion.multiply(_q);
		}
		arm.hand.updateMatrixWorld(true);
	}
}

const _blend = new Quaternion();
/** `q` = slerp(from, q, w): `w` of the way from `from` to the current `q`. */
function blendFrom(q: Quaternion, from: Quaternion, w: number): void {
	_blend.copy(q);
	q.copy(from).slerp(_blend, w);
}

const ikOut = {
	upperDir: new Vector3(),
	foreDir: new Vector3(),
	hinge: new Vector3(),
	elbow: new Vector3(),
};
const _bx = new Vector3();
const _by = new Vector3();
const _bz = new Vector3();
const _bm = new Matrix4();
const _bq = new Quaternion();

/** Sets `bone`'s world rotation so its X runs along `dir` and its Z is `hinge` (orthogonalised). */
function setBoneFrame(bone: Bone, dir: Vector3, hinge: Vector3): void {
	_bx.copy(dir).normalize();
	_bz.copy(hinge).addScaledVector(_bx, -hinge.dot(_bx)).normalize();
	_by.crossVectors(_bz, _bx);
	_bm.makeBasis(_bx, _by, _bz);
	_bq.setFromRotationMatrix(_bm);
	setWorldQuat(bone, _bq);
}
