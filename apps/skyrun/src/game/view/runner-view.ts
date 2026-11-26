import {
	type AnimClipSpec,
	type AnimState,
	type CharacterFrame,
	CharacterView,
	readSlot,
} from "@pebble3d/renderer";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
	color,
	float,
	normalView,
	positionViewDirection,
	smoothstep,
	uniform,
	uv,
} from "three/tsl";
import {
	AdditiveBlending,
	CircleGeometry,
	Color,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	type MeshStandardMaterial,
	Object3D,
	Quaternion,
	type Scene,
	Vector3,
} from "three/webgpu";
import { CENTER_Y, type SkyrunSim } from "../sim.ts";

export type RunnerKind = "human" | "robot";

/** The two runners: a Rocketbox avatar (CC BY 4.0) and the CC0 expressive robot. */
export const RUNNERS: Record<
	RunnerKind,
	{
		url: string;
		scale: number;
		clips: Partial<Record<AnimState, AnimClipSpec>>;
	}
> = {
	human: {
		url: "/assets/rocketbox-female-adult-04.glb",
		scale: 1,
		clips: {
			idle: { clip: "Idle" },
			walk: { clip: "Walk", speed: 0.979 },
			run: { clip: "Run", speed: 5.649 },
			jump: { clip: "Jump" },
			fall: { clip: "Fall" },
		},
	},
	robot: {
		url: "/assets/RobotExpressive.glb",
		scale: 0.42,
		clips: {
			idle: { clip: "Idle" },
			walk: { clip: "Walking", speed: 2.4 },
			run: { clip: "Running", speed: 6.0 },
			jump: { clip: "Jump" },
		},
	},
};

/** Walk/run switch speed for the animation picker (run plays from ~4 m/s). */
const ANIM_SPRINT = 5.5;
const _p = new Vector3();
const _q = new Quaternion();
const _yaw = new Quaternion();

/**
 * A runner drawn from a sim's character slot: a skinned clone of the glTF, the renderer's
 * `CharacterView` for cross-faded idle/walk/run/jump/fall clips (speed-matched playback) and
 * velocity facing, and a soft contact shadow disc. `ghost` makes it a translucent cyan
 * silhouette for the best-run ghost. `update` does not allocate.
 */
export class RunnerView {
	readonly root = new Object3D();
	readonly view: CharacterView;
	private readonly frame: CharacterFrame = {
		grounded: true,
		vx: 0,
		vz: 0,
		vy: 0,
		sprintSpeed: ANIM_SPRINT,
	};
	private readonly blob: Mesh;
	/** Ghost only: brightness, faded down when it overlaps the live runner. */
	readonly fade = uniform(1);
	private readonly materials: Material[] = [];

	constructor(scene: Scene, gltf: GLTF, kind: RunnerKind, ghost: boolean) {
		const spec = RUNNERS[kind];
		const model = cloneSkinned(gltf.scene);
		model.scale.setScalar(spec.scale);
		const ghostMat = ghost ? ghostMaterial(this.fade) : null;
		if (ghostMat) this.materials.push(ghostMat);
		model.traverse((o) => {
			const m = o as Mesh;
			if (!m.isMesh) return;
			m.castShadow = !ghost;
			m.receiveShadow = !ghost;
			m.frustumCulled = false;
			if (ghostMat) {
				m.material = ghostMat;
				return;
			}
			if (kind === "robot") {
				const mats = Array.isArray(m.material) ? m.material : [m.material];
				const cloned = mats.map((x: Material) => {
					const c = x.clone() as MeshStandardMaterial;
					// Coral body: warm against the cool sky, distinct from the cyan ghost.
					if (c.name === "Main") c.color.set(0xff8a5c);
					this.materials.push(c);
					return c;
				});
				m.material = Array.isArray(m.material)
					? cloned
					: (cloned[0] as Material);
			}
		});
		this.root.add(model);
		this.view = new CharacterView(this.root, gltf.animations, spec.clips);

		const bm = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
		});
		const g = new CircleGeometry(0.42, 24);
		g.rotateX(-Math.PI / 2);
		const d = uv().sub(0.5).length().mul(2);
		bm.colorNode = color(new Color("#2a2140"));
		bm.opacityNode = float(1)
			.sub(smoothstep(0.2, 1, d))
			.mul(ghost ? 0 : 0.42);
		this.blob = new Mesh(g, bm);
		this.blob.position.y = 0.02;
		this.blob.renderOrder = 1;
		this.materials.push(bm);
		this.root.add(this.blob);
		scene.add(this.root);
	}

	/** Snaps facing to a yaw (radians, 0 faces -Z like the camera convention). */
	face(yaw: number): void {
		// The model faces +Z at rotation 0; camera yaw 0 looks down -Z.
		_yaw.setFromAxisAngle(_p.set(0, 1, 0), yaw + Math.PI);
		this.root.quaternion.copy(_yaw);
		// CharacterView keeps its own (private) facing quaternion and slerps it toward the
		// velocity; re-seed it so a respawn does not turn the runner from its old heading.
		(
			this.view as unknown as { facing: Quaternion; facingInit: boolean }
		).facing.copy(_yaw);
		(this.view as unknown as { facingInit: boolean }).facingInit = true;
	}

	update(sim: SkyrunSim, alpha: number, dt: number): void {
		const v = sim.views;
		if (readSlot(v.prev, v.curr, sim.playerSlot, alpha, _p, _q))
			this.root.position.set(_p.x, _p.y - CENTER_Y, _p.z);
		const f = this.frame;
		f.grounded = sim.grounded;
		f.vx = sim.vx;
		f.vz = sim.vz;
		f.vy = sim.vy;
		this.view.update(f, dt);
		this.blob.visible = sim.grounded;
	}

	dispose(): void {
		this.view.dispose();
		this.root.removeFromParent();
		for (const m of this.materials) m.dispose();
		this.blob.geometry.dispose();
	}
}

/** Translucent cyan fresnel silhouette. */
function ghostMaterial(fade: RunnerView["fade"]): MeshBasicNodeMaterial {
	const m = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
	const fres = float(1)
		.sub(normalView.dot(positionViewDirection.negate()).abs())
		.pow(1.8);
	m.colorNode = color(new Color("#6ff0ff"))
		.mul(fres.mul(1.6).add(0.12))
		.mul(fade);
	return m;
}
