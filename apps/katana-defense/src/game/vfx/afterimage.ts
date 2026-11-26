import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { uniform, vec3 } from "three/tsl";
import {
	AdditiveBlending,
	type Bone,
	type Mesh,
	MeshBasicNodeMaterial,
	type Object3D,
	type Scene,
} from "three/webgpu";

const GHOSTS = 5;
const LIFE = 0.32;

interface Ghost {
	root: Object3D;
	bones: Bone[];
	strength: { value: number };
	age: number;
}

/**
 * Dash afterimages: a few pre-cloned copies of the player model in an additive cyan
 * material. `snap` copies the live pose (bone transforms) and placement into the next
 * ghost, which then fades out. Clones are made once; `snap`/`update` do not allocate.
 */
export class Afterimages {
	private readonly ghosts: Ghost[] = [];
	private readonly srcBones: Bone[];
	private next = 0;

	constructor(scene: Scene, gltf: GLTF, source: Object3D) {
		this.srcBones = collectBones(source);
		for (let i = 0; i < GHOSTS; i++) {
			const root = cloneSkinned(gltf.scene);
			const strength = uniform(0);
			const mat = new MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
			});
			mat.colorNode = vec3(0.25, 0.75, 1.6).mul(strength);
			root.traverse((o) => {
				const m = o as Mesh;
				if (m.isMesh) {
					m.material = mat;
					m.castShadow = false;
					m.frustumCulled = false;
				}
			});
			root.visible = false;
			scene.add(root);
			this.ghosts.push({
				root,
				bones: collectBones(root),
				strength,
				age: LIFE,
			});
		}
	}

	/** Captures the source model's current world placement and pose. */
	snap(model: Object3D): void {
		const g = this.ghosts[this.next] as Ghost;
		this.next = (this.next + 1) % GHOSTS;
		model.updateMatrixWorld(true);
		model.matrixWorld.decompose(
			g.root.position,
			g.root.quaternion,
			g.root.scale,
		);
		const n = Math.min(g.bones.length, this.srcBones.length);
		for (let i = 0; i < n; i++) {
			const s = this.srcBones[i] as Bone;
			const d = g.bones[i] as Bone;
			d.position.copy(s.position);
			d.quaternion.copy(s.quaternion);
			d.scale.copy(s.scale);
		}
		g.age = 0;
		g.root.visible = true;
	}

	update(dt: number): void {
		for (const g of this.ghosts) {
			if (g.age >= LIFE) continue;
			g.age += dt;
			const k = Math.max(0, 1 - g.age / LIFE);
			g.strength.value = k * k * 0.55;
			if (g.age >= LIFE) g.root.visible = false;
		}
	}
}

function collectBones(root: Object3D): Bone[] {
	const out: Bone[] = [];
	root.traverse((o) => {
		if ((o as Bone).isBone) out.push(o as Bone);
	});
	return out;
}
