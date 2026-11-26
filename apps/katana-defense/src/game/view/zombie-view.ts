import { readSlot } from "@pebble3d/renderer";
import type { Game } from "@pebble3d/sdk/game";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { float, length, smoothstep, uv, vec3 } from "three/tsl";
import {
	type AnimationAction,
	AnimationMixer,
	type Bone,
	type BufferGeometry,
	Color,
	DynamicDrawUsage,
	InstancedMesh,
	type Material,
	Matrix4,
	MeshBasicNodeMaterial,
	type MeshStandardNodeMaterial,
	type Node,
	Object3D,
	PlaneGeometry,
	Quaternion,
	type Scene,
	type SkinnedMesh,
	type Sphere,
	Vector3,
} from "three/webgpu";
import zombiesJson from "../../data/zombies.json";
import type { Archetype } from "../ai/archetypes.ts";
import { DT } from "../constants.ts";
import { type GameSim, SPAWN_FRAMES, type Zombie, ZS } from "../sim.ts";
import { type ZombieLook, zombieColorNode } from "./zombie-look.ts";
import { warmCounts } from "./zombie-pool.ts";

interface AvatarDef {
	id: string;
	url: string;
	walk: number;
	run: number;
}
interface ZombiesConfig {
	avatars: AvatarDef[];
	archetypes: Record<string, number[]>;
	look: ZombieLook;
	shamble: { rate: number; min: number; max: number };
}
export const ZOMBIES = zombiesJson as unknown as ZombiesConfig;

const MAX_CORPSES = 16;
/** Corpse timeline, seconds: tumble, then sink, then despawn. */
const CORPSE_TUMBLE = 2.6;
const CORPSE_SINK = 1.4;
/** Hip height of the 1.75 m avatars: the corpse capsule's centre. */
const HIP = 0.95;
/** Mixer LOD: distance (m) beyond which a zombie animates every 2nd / 3rd frame. */
const LOD_NEAR = 15;
const LOD_FAR = 22;
/** Hair cards (alpha-tested) are hidden beyond this camera distance. */
const HAIR_RANGE = 21;
/**
 * Real (CSM) shadows: only the MAX_CASTERS zombies nearest the player, within SHADOW_RANGE
 * (each caster draws into three cascades). The rest get a blob shadow (one instanced draw).
 */
const SHADOW_RANGE = 10;
const MAX_CASTERS = 8;
/** The FULL_RATE zombies nearest the player animate every frame; the rest every 2nd/3rd. */
const FULL_RATE = 16;

const UP = new Vector3(0, 1, 0);
const _v = new Vector3();
const _p = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _qp = new Quaternion();
const _fwd = new Vector3();
const _left = new Vector3();
const _hot = new Color(1.6, 0.32, 0.06);
const _white = new Color(0.9, 0.9, 0.85);
const _c = new Color();
const _blob = new Matrix4();

/** Soft dark discs under zombies without a real shadow (one instanced draw). */
function blobShadows(capacity: number): InstancedMesh {
	const g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
	const m = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
	});
	const r = length(uv().sub(0.5)).mul(2);
	m.colorNode = vec3(0, 0, 0);
	m.opacityNode = float(1)
		.sub(smoothstep(0.25, 1, r))
		.mul(0.55);
	const mesh = new InstancedMesh(g, m, capacity);
	mesh.instanceMatrix.setUsage(DynamicDrawUsage);
	mesh.frustumCulled = false;
	mesh.renderOrder = -1;
	mesh.count = 0;
	return mesh;
}

/** Growth of a zombie mesh's bind-pose bounding sphere that covers every animated pose. */
const BOUNDS_PAD = 1.5;
const _bindSpheres = new WeakMap<BufferGeometry, Sphere>();

/** The bind-pose bounding sphere of `g` grown by BOUNDS_PAD (one per shared geometry). */
function paddedBindSphere(g: BufferGeometry): Sphere {
	let s = _bindSpheres.get(g);
	if (!s) {
		if (!g.boundingSphere) g.computeBoundingSphere();
		s = (g.boundingSphere as Sphere).clone();
		s.radius *= BOUNDS_PAD;
		_bindSpheres.set(g, s);
	}
	return s.clone();
}

/** One pooled, skinned avatar clone. */
interface Inst {
	avatar: number;
	root: Object3D;
	model: Object3D;
	mixer: AnimationMixer;
	idle: AnimationAction;
	walk: AnimationAction;
	run: AnimationAction;
	current: AnimationAction;
	mats: MeshStandardNodeMaterial[];
	/** Shadow casters (not the hair cards). */
	meshes: SkinnedMesh[];
	/** The hair-card meshes (distance-culled). */
	hair: SkinnedMesh[];
	upperL: Bone;
	upperR: Bone;
	foreL: Bone;
	foreR: Bone;
	spine: Bone;
	head: Bone;
	/**
	 * The skeleton lives outside the scene graph (so render passes never walk ~90 bones per
	 * zombie): `rig` stands in for `rigParent`, whose world matrix it copies each frame.
	 */
	rig: Object3D;
	rigParent: Object3D;
	bip: Object3D;
	inUse: boolean;
	/** Seconds of animation owed to the mixer (LOD skips). */
	owed: number;
	lodPhase: number;
}

interface Corpse {
	active: boolean;
	inst: Inst | null;
	body: number;
	slot: number;
	age: number;
	scale: number;
	x: number;
	y: number;
	z: number;
	heading: number;
}

/** Procedural layer over the clip, radians. */
interface Pose {
	arms: number;
	armSplit: number;
	elbow: number;
	lean: number;
	headTilt: number;
	headDroop: number;
	tilt: number;
	sink: number;
}

function bone(root: Object3D, name: string): Bone {
	const want = name.replace(/\s/g, "_");
	let out: Bone | null = null;
	root.traverse((o) => {
		if (!out && (o as Bone).isBone && o.name === want) out = o as Bone;
	});
	if (!out) throw new Error(`zombie rig: bone "${name}" not found`);
	return out;
}

const _ax = new Vector3();
const _sc = new Vector3();
/**
 * Turns `b` by `angle` about the world `axis`, expressed in its parent's frame from the
 * parent's last world matrix (no hierarchy update: an additive tweak tolerates a one-frame
 * stale parent, and crowds cannot afford a subtree update per turn).
 */
function turn(b: Bone, axis: Vector3, angle: number): void {
	if (angle === 0 || !b.parent) return;
	b.parent.matrixWorld.decompose(_p, _qp, _sc);
	_ax.copy(axis).applyQuaternion(_qp.invert());
	_q2.setFromAxisAngle(_ax, angle);
	b.quaternion.premultiply(_q2);
}

/**
 * Zombies drawn as pooled Rocketbox avatars (four avatars; geometry, textures and one
 * zombie-look material graph shared per avatar, one skeleton per clone). Each zombie plays
 * its avatar's clips (shamblers the slowed injured/drunk walk, runners the run, brutes are
 * scaled up) with an additive procedural layer from its sim state: reaching arms, a lolling
 * head, telegraph wind-ups that raise the arms and glow hot, strikes, staggers, launches and
 * spawn climbs. Far zombies advance their mixer every 2nd/3rd frame. Kills keep their clone
 * as a corpse driven by a tumbling physics capsule, which then sinks and darkens away.
 * `update` does not allocate (except pool growth and one small JSON per kill).
 */
export class ZombieView {
	private readonly sim: GameSim;
	private readonly game: Game;
	private readonly scene: Scene;
	private readonly gltfs: GLTF[];
	private readonly pools: Inst[][];
	/** Shared zombie material per (avatar, source material). */
	private readonly zmats: Map<Material, MeshStandardNodeMaterial>[];
	private readonly colorNode: Node<"vec4">;
	/** Avatar clone bound to each sim zombie (by pool index) and its serial. */
	private readonly bound: (Inst | null)[];
	private readonly boundSerial: Int32Array;
	private readonly index = new Map<Zombie, number>();
	private readonly corpses: Corpse[] = [];
	private readonly bodyJson: string[];
	private readonly pose: Pose = {
		arms: 0,
		armSplit: 0,
		elbow: 0,
		lean: 0,
		headTilt: 0,
		headDroop: 0,
		tilt: 0,
		sink: 0,
	};
	private readonly blobs: InstancedMesh;
	private readonly dist: Float32Array;
	private readonly near: Float32Array;
	private time = 0;
	private frame = 0;
	private hidden = false;
	private noShadow = false;
	/** Diagnostics: mixers advanced on the last frame, live clones. */
	readonly diag = { animated: 0, visible: 0, clones: 0 };

	constructor(scene: Scene, game: Game, sim: GameSim, gltfs: GLTF[]) {
		this.sim = sim;
		this.game = game;
		this.scene = scene;
		this.gltfs = gltfs;
		this.colorNode = zombieColorNode(ZOMBIES.look);
		this.zmats = gltfs.map(() => new Map());
		this.pools = gltfs.map(() => []);
		// warm by the waves' archetype mix so no wave clones mid-fight (the pool still grows
		// if an unlucky `vary` draw needs more)
		const warm = warmCounts(
			sim.waves,
			ZOMBIES.archetypes,
			gltfs.length,
			MAX_CORPSES,
		);
		for (let a = 0; a < gltfs.length; a++)
			for (let i = 0; i < (warm[a] ?? 0); i++)
				(this.pools[a] as Inst[]).push(this.make(a));
		sim.zombies.forEach((z, i) => {
			this.index.set(z, i);
		});
		this.bound = sim.zombies.map(() => null);
		this.dist = new Float32Array(sim.zombies.length);
		this.near = new Float32Array(FULL_RATE);
		this.blobs = blobShadows(sim.zombies.length + MAX_CORPSES);
		scene.add(this.blobs);
		this.boundSerial = new Int32Array(sim.zombies.length).fill(-1);
		for (let i = 0; i < MAX_CORPSES; i++)
			this.corpses.push({
				active: false,
				inst: null,
				body: -1,
				slot: -1,
				age: 0,
				scale: 1,
				x: 0,
				y: 0,
				z: 0,
				heading: 0,
			});
		this.bodyJson = sim.archetypes.map((a) =>
			JSON.stringify({
				position: [0, 0, 0],
				rotation: [0, 0, 0, 1],
				body: {
					type: "dynamic",
					mass: 60 * a.mass,
					friction: 0.9,
					restitution: 0.05,
					linearDamping: 0.15,
					angularDamping: 0.6,
					collider: {
						shape: "capsule",
						halfHeight: 0.55 * a.scale,
						radius: 0.24 * a.scale,
					},
				},
			}),
		);
	}

	/** The shared zombie material for `src` on avatar `a`. */
	private zmat(a: number, src: Material): MeshStandardNodeMaterial {
		const cache = this.zmats[a] as Map<Material, MeshStandardNodeMaterial>;
		let m = cache.get(src);
		if (!m) {
			m = src.clone() as MeshStandardNodeMaterial;
			m.colorNode = this.colorNode;
			m.envMapIntensity = ZOMBIES.look.envIntensity;
			// Crowd budget: keep zombies out of the AO prepass (which draws the opaque list
			// only). Fully opaque and depth-written, they just sort with the transparents.
			m.transparent = true;
			m.depthWrite = true;
			m.opacity = 1;
			// hair cards: alpha-tested (cheap, no sorting)
			if ((src.userData as { alphaHash?: boolean }).alphaHash) {
				m.alphaHash = false;
				m.alphaTest = 0.5;
			}
			cache.set(src, m);
		}
		return m;
	}

	private make(a: number): Inst {
		const gltf = this.gltfs[a] as GLTF;
		const model = cloneSkinned(gltf.scene);
		const meshes: SkinnedMesh[] = [];
		const skinned: SkinnedMesh[] = [];
		const hair: SkinnedMesh[] = [];
		const mats: MeshStandardNodeMaterial[] = [];
		// source materials in traversal order (SkeletonUtils.clone keeps the hierarchy; mesh
		// names are not unique, so pair by order, never by name)
		const srcMats: Material[] = [];
		gltf.scene.traverse((o) => {
			if ((o as SkinnedMesh).isMesh)
				srcMats.push((o as SkinnedMesh).material as Material);
		});
		let mi = 0;
		model.traverse((o) => {
			const m = o as SkinnedMesh;
			if (!m.isMesh) return;
			// per-clone material (telegraph glow / hit flash / corpse darkening); it shares
			// the textures and node graph, so the pipeline is shared too
			const src = srcMats[mi++] ?? (m.material as Material);
			const shared = this.zmat(a, src);
			const own = shared.clone() as MeshStandardNodeMaterial;
			own.colorNode = this.colorNode;
			m.material = own;
			mats.push(own);
			m.castShadow = true;
			m.receiveShadow = true;
			// Culled against a padded bind-pose sphere (in mesh space, so it follows the
			// clone and tumbling corpse): off-camera zombies and casters outside a shadow
			// cascade skip their draws. SkinnedMesh would otherwise skin every vertex on the
			// CPU to bound itself.
			if (m.isSkinnedMesh) m.boundingSphere = paddedBindSphere(m.geometry);
			else m.frustumCulled = false;
			// hair cards stay out of the shadow passes (alpha-tested, five passes each)
			if (own.alphaTest > 0) {
				m.castShadow = false;
				hair.push(m);
			} else meshes.push(m);
			if (m.isSkinnedMesh) skinned.push(m);
		});
		// one skeleton for all of the clone's skinned meshes (same Bip01 joints)
		const first = skinned[0];
		if (first)
			for (let i = 1; i < skinned.length; i++) {
				const m = skinned[i] as SkinnedMesh;
				if (m.skeleton.bones.length === first.skeleton.bones.length)
					m.bind(first.skeleton, m.bindMatrix);
			}
		const root = new Object3D();
		root.add(model);
		// detach the skeleton (see Inst.rig)
		// (the hips node is not a skin joint, so it is a plain Object3D)
		const bip = model.getObjectByName("Bip01");
		if (!bip?.parent) throw new Error(`zombie avatar ${a}: no Bip01 node`);
		const rigParent = bip.parent;
		rigParent.remove(bip);
		const rig = new Object3D();
		rig.matrixAutoUpdate = false;
		rig.matrixWorldAutoUpdate = false;
		rig.add(bip);
		root.visible = false;
		this.scene.add(root);
		const mixer = new AnimationMixer(rig);
		const clip = (name: string): AnimationAction => {
			const c = gltf.animations.find((k) => k.name === name);
			if (!c) throw new Error(`zombie avatar ${a}: no clip "${name}"`);
			return mixer.clipAction(c);
		};
		// Bones without a track in any clip (the face rig) keep their local matrix: skip
		// recomposing it every frame.
		const animated = new Set<string>();
		for (const c of gltf.animations)
			for (const t of c.tracks) animated.add(t.name.split(".")[0] ?? "");
		rig.traverse((o) => {
			if (o !== bip && !animated.has(o.name)) {
				o.updateMatrix();
				o.matrixAutoUpdate = false;
			}
		});
		const idle = clip("Idle");
		const walk = clip("Walk");
		const run = clip("Run");
		idle.play();
		this.diag.clones++;
		return {
			avatar: a,
			root,
			model,
			mixer,
			idle,
			walk,
			run,
			current: idle,
			mats,
			meshes,
			hair,
			upperL: bone(rig, "Bip01 L UpperArm"),
			upperR: bone(rig, "Bip01 R UpperArm"),
			foreL: bone(rig, "Bip01 L Forearm"),
			foreR: bone(rig, "Bip01 R Forearm"),
			spine: bone(rig, "Bip01 Spine2"),
			head: bone(rig, "Bip01 Head"),
			rig,
			rigParent,
			bip,
			inUse: false,
			owed: 0,
			lodPhase: 0,
		};
	}

	private acquire(a: number, phase: number): Inst {
		const pool = this.pools[a] as Inst[];
		let inst = pool.find((k) => !k.inUse);
		if (!inst) {
			inst = this.make(a);
			pool.push(inst);
		}
		inst.inUse = true;
		inst.root.visible = !this.hidden;
		inst.owed = 0;
		inst.lodPhase = phase;
		inst.model.position.set(0, 0, 0);
		inst.model.quaternion.identity();
		for (const m of inst.mats) {
			m.color.setScalar(1);
			m.emissive.setScalar(0);
		}
		// random start phase so a wave does not march in lockstep
		inst.mixer.stopAllAction();
		inst.current = inst.idle;
		inst.idle.reset().play();
		inst.mixer.setTime(phase * 3.7);
		return inst;
	}

	private releaseInst(inst: Inst): void {
		inst.inUse = false;
		inst.root.visible = false;
	}

	private avatarFor(z: Zombie, a: Archetype): number {
		const list = ZOMBIES.archetypes[a.id] ?? [0];
		return list[Math.floor(z.vary * list.length) % list.length] as number;
	}

	debug(hide: boolean, noShadow: boolean): void {
		this.hidden = hide;
		this.noShadow = noShadow;
	}

	/** A zombie died: its clone becomes a corpse on a capsule launched with the kill impulse. */
	kill(z: Zombie, vx: number, vz: number): void {
		const zi = this.index.get(z);
		if (zi === undefined) return;
		const inst = this.bound[zi];
		this.bound[zi] = null;
		this.boundSerial[zi] = -1;
		if (!inst) return;
		let c = this.corpses.find((k) => !k.active);
		if (!c) {
			c = this.corpses.reduce((p, q) => (p.age > q.age ? p : q));
			this.releaseCorpse(c);
		}
		const a = this.sim.archetypes[z.type] as Archetype;
		const scale = a.scale * (0.94 + 0.1 * z.vary);
		const w = this.game.sim.world;
		const json = (this.bodyJson[z.type] as string).replace(
			'"position":[0,0,0]',
			`"position":[${z.x.toFixed(3)},${(HIP * scale + Math.max(0, z.y)).toFixed(3)},${z.z.toFixed(3)}]`,
		);
		const id = w.spawn(json);
		const sp = Math.hypot(vx, vz);
		const up = 2.2 + Math.min(4, sp * 0.35) + (z.y > 0.2 ? 1.5 : 0);
		const ax = sp > 1e-3 ? vz / sp : 1;
		const az = sp > 1e-3 ? -vx / sp : 0;
		const spin = 3.2 + sp * 0.4;
		w.setVelocity(
			id,
			vx * 0.9,
			up,
			vz * 0.9,
			ax * spin,
			(z.vary - 0.5) * 3,
			az * spin,
		);
		// The capsule is the body from the hips: hang the avatar from its centre. Freeze
		// the clip and go limp: arms flung up, head back.
		inst.model.position.set(0, -HIP, 0);
		inst.mixer.stopAllAction();
		_left.set(1, 0, 0).applyQuaternion(inst.root.quaternion);
		turn(inst.upperL, _left, -2.2 + z.vary * 0.6);
		turn(inst.upperR, _left, -1.8 - z.vary * 0.6);
		turn(inst.head, _left, -0.5);
		for (const m of inst.mats) m.emissive.setScalar(0);
		c.active = true;
		c.inst = inst;
		c.body = id;
		c.slot = w.slotOf(id);
		c.age = 0;
		c.scale = scale;
		c.x = z.x;
		c.y = HIP * scale;
		c.z = z.z;
		c.heading = z.heading;
	}

	private releaseCorpse(c: Corpse): void {
		if (c.body >= 0) this.game.sim.world.despawn(c.body);
		if (c.inst) this.releaseInst(c.inst);
		c.inst = null;
		c.active = false;
		c.body = -1;
	}

	/** Despawns every corpse (run restart). */
	clear(): void {
		for (const c of this.corpses) if (c.active) this.releaseCorpse(c);
	}

	update(dt: number, alpha: number): void {
		const s = this.sim;
		const frozen = s.hitstop > 0;
		const adt = frozen ? dt * 0.08 : dt;
		this.time += frozen ? 0 : dt;
		this.frame++;
		const cam = this.game.renderer.three.camera.position;
		this.diag.animated = 0;
		this.diag.visible = 0;
		const zs = s.zombies;
		this.rankNearest();
		const limit = Math.min(SHADOW_RANGE, this.near[MAX_CASTERS - 1] as number);
		const fullRate = this.near[FULL_RATE - 1] as number;
		let nb = 0;
		for (let i = 0; i < zs.length; i++) {
			const z = zs[i] as Zombie;
			let inst = this.bound[i] ?? null;
			if (!z.alive) {
				if (inst) {
					this.releaseInst(inst);
					this.bound[i] = null;
					this.boundSerial[i] = -1;
				}
				continue;
			}
			const a = s.archetypes[z.type] as Archetype;
			if (!inst || this.boundSerial[i] !== z.serial) {
				if (inst) this.releaseInst(inst);
				inst = this.acquire(this.avatarFor(z, a), z.vary);
				this.bound[i] = inst;
				this.boundSerial[i] = z.serial;
			}
			this.diag.visible++;
			const x = z.px + (z.x - z.px) * alpha;
			const y = z.py + (z.y - z.py) * alpha;
			const zz = z.pz + (z.z - z.pz) * alpha;
			this.poseZombie(z, a);
			const p = this.pose;
			const r = inst.root;
			r.position.set(x, y - p.sink, zz);
			r.quaternion.setFromAxisAngle(UP, z.heading);
			if (p.tilt !== 0) {
				_q.setFromAxisAngle(_v.set(1, 0, 0), p.tilt);
				r.quaternion.multiply(_q);
			}
			r.scale.setScalar(a.scale * (0.94 + 0.1 * z.vary));
			const dist = Math.hypot(x - cam.x, zz - cam.z);
			const shadow = !this.noShadow && (this.dist[i] as number) <= limit;
			if (!shadow && p.sink < 0.5 && !this.hidden) {
				const sc = a.scale * (0.94 + 0.1 * z.vary);
				_blob.makeScale(0.9 * sc, 1, 0.9 * sc).setPosition(x, 0.03, zz);
				this.blobs.setMatrixAt(nb++, _blob);
			}
			for (const m of inst.meshes) m.castShadow = shadow;
			for (const m of inst.hair) m.visible = dist < HAIR_RANGE;

			// clip choice and rate
			const speed = Math.hypot(z.x - z.px, z.z - z.pz) / DT;
			const av = ZOMBIES.avatars[inst.avatar] as AvatarDef;
			let want = inst.idle;
			let rate = 1;
			if (z.state === ZS.CHASE && speed > 0.15) {
				if (a.speed > 2.5) {
					want = inst.run;
					rate = Math.min(1.4, Math.max(0.6, speed / av.run));
				} else {
					want = inst.walk;
					const sh = ZOMBIES.shamble;
					rate = Math.min(
						sh.max,
						Math.max(sh.min, (speed / av.walk) * sh.rate),
					);
				}
			} else if (z.state === ZS.STAGGER) rate = 0.4;
			if (want !== inst.current) {
				want.reset().play();
				want.crossFadeFrom(inst.current, 0.25, false);
				inst.current = want;
			}
			want.timeScale = rate;

			// LOD: far zombies advance every 2nd / 3rd frame (a skipped frame keeps the
			// last full pose, procedural layer included)
			inst.owed += adt;
			const k =
				(this.dist[i] as number) <= fullRate && dist < LOD_NEAR
					? 1
					: dist < LOD_FAR
						? 2
						: 3;
			if ((this.frame + inst.lodPhase * 7) % k < 1) {
				inst.mixer.update(inst.owed);
				inst.owed = 0;
				this.layer(inst, z);
				this.diag.animated++;
			}
			this.syncRig(inst);
			this.colors(inst, z, a);
		}

		this.blobs.count = nb;
		this.blobs.instanceMatrix.needsUpdate = true;
		// corpses: the avatar follows the tumbling capsule, then sinks and darkens
		const views = this.game.views;
		for (const c of this.corpses) {
			if (!c.active || !c.inst) continue;
			c.age += dt;
			if (c.age > CORPSE_TUMBLE + CORPSE_SINK) {
				this.releaseCorpse(c);
				continue;
			}
			const r = c.inst.root;
			if (!readSlot(views.prev, views.curr, c.slot, 1, _p, _q)) {
				_p.set(c.x, c.y, c.z);
				_q.setFromAxisAngle(UP, c.heading);
			}
			const sinkT = Math.max(0, c.age - CORPSE_TUMBLE) / CORPSE_SINK;
			_p.y -= sinkT * sinkT * 0.9;
			r.position.copy(_p);
			r.quaternion.copy(_q);
			r.scale.setScalar(c.scale);
			this.syncRig(c.inst);
			const dark = 0.75 * (1 - sinkT * 0.85);
			for (const m of c.inst.mats) m.color.setScalar(dark);
			for (const m of c.inst.meshes)
				m.castShadow = sinkT < 0.3 && !this.noShadow;
		}
	}

	/**
	 * Distances of live zombies to the player into `dist`, and the FULL_RATE nearest
	 * distances, sorted, into `near` (the shadow-caster and full-rate animation cut-offs).
	 */
	private rankNearest(): void {
		const zs = this.sim.zombies;
		const pl = this.sim.player;
		const near = this.near;
		near.fill(Number.POSITIVE_INFINITY);
		for (let i = 0; i < zs.length; i++) {
			const z = zs[i] as Zombie;
			const d = z.alive ? Math.hypot(z.x - pl.x, z.z - pl.z) : Infinity;
			this.dist[i] = d;
			// insertion into the sorted k-nearest list
			if (d >= (near[FULL_RATE - 1] as number)) continue;
			let j = FULL_RATE - 1;
			while (j > 0 && (near[j - 1] as number) > d) {
				near[j] = near[j - 1] as number;
				j--;
			}
			near[j] = d;
		}
	}

	/** World matrices of the clone and its detached skeleton, once per frame. */
	private syncRig(inst: Inst): void {
		inst.root.updateMatrixWorld(true);
		inst.rig.matrixWorld.copy(inst.rigParent.matrixWorld);
		inst.bip.updateMatrixWorld(true);
	}

	/** The additive procedural layer over the clip (world-space bone turns). */
	private layer(inst: Inst, z: Zombie): void {
		const p = this.pose;
		const r = inst.root;
		_fwd.set(0, 0, 1).applyQuaternion(r.quaternion);
		_left.set(1, 0, 0).applyQuaternion(r.quaternion);
		turn(inst.spine, _left, p.lean);
		// arms: raise forward (negative about the left axis), split by `armSplit`
		turn(inst.upperL, _left, -(p.arms + p.armSplit));
		turn(inst.upperR, _left, -(p.arms - p.armSplit));
		turn(inst.foreL, _left, -p.elbow);
		turn(inst.foreR, _left, -p.elbow * (0.8 + z.vary * 0.4));
		turn(inst.head, _fwd, p.headTilt);
		turn(inst.head, _left, p.headDroop);
	}

	private colors(inst: Inst, z: Zombie, a: Archetype): void {
		_c.setRGB(0, 0, 0);
		if (z.state === ZS.WINDUP) {
			const t = 1 - z.stateT / a.windup;
			const pulse = 0.6 + 0.4 * Math.sin(this.time * 30);
			_c.copy(_hot).multiplyScalar(t * t * pulse * (a.slam ? 0.1 : 0.06));
		} else if (z.state === ZS.STRIKE) _c.copy(_hot).multiplyScalar(0.06);
		if (z.flash > 0) {
			// a brief, faint flash: a crowd under Spin Storm is re-hit every 8 frames
			const k = Math.min(1, z.flash / 6);
			_c.lerp(_white, k * k * 0.12);
		}
		for (let i = 0; i < inst.mats.length; i++)
			(inst.mats[i] as MeshStandardNodeMaterial).emissive.copy(_c);
	}

	/** Fills `this.pose` from the zombie's state. */
	private poseZombie(z: Zombie, a: Archetype): void {
		const p = this.pose;
		const brute = a.slam;
		const runner = a.speed > 2.5;
		const sway = Math.sin(this.time * 1.7 + z.vary * 9);
		// shamblers reach for you, runners claw forward, brutes hang heavy
		const reach = runner ? 0.35 : brute ? 0.55 : 1.25 + 0.15 * z.vary;
		p.arms = reach + 0.12 * sway;
		p.armSplit =
			(runner ? 0.05 : 0.18) * Math.sin(this.time * 1.1 + z.vary * 5);
		p.elbow = runner ? 0.5 : brute ? 0.25 : 0.2;
		p.lean = runner ? 0.32 : brute ? 0.16 : 0.12 + 0.1 * z.vary;
		p.headTilt =
			0.18 * Math.sin(this.time * 0.8 + z.vary * 7) + (z.vary - 0.5) * 0.25;
		p.headDroop = 0.18 + 0.15 * z.vary;
		p.tilt = 0;
		p.sink = 0;
		switch (z.state) {
			case ZS.SPAWNING: {
				const t = z.stateT / SPAWN_FRAMES; // 1 -> 0
				p.sink = t * t * 1.8 * a.scale;
				p.arms = 2.6 - t * 0.4;
				p.lean = 0.5 * t;
				break;
			}
			case ZS.WINDUP: {
				const t = 1 - z.stateT / a.windup;
				const up = brute ? 2.9 : 2.4;
				p.arms = reach + (up - reach) * t;
				p.armSplit = 0;
				p.elbow = 0.4 * t;
				p.lean = p.lean - 0.4 * t;
				p.headDroop = -0.3 * t;
				break;
			}
			case ZS.STRIKE:
				p.arms = brute ? 0.2 : 0.7;
				p.armSplit = 0;
				p.elbow = 0.1;
				p.lean = brute ? 0.7 : 0.5;
				break;
			case ZS.RECOVER: {
				const t = z.stateT / a.recover;
				p.arms = (brute ? 0.2 : 0.6) * t + reach * (1 - t);
				p.lean = 0.45 * t + p.lean * (1 - t);
				break;
			}
			case ZS.STAGGER:
				p.lean = -0.4;
				p.arms = 0.5;
				p.armSplit = 0.5;
				p.headDroop = -0.5;
				p.headTilt = 0.4;
				break;
			case ZS.AIRBORNE:
				p.tilt = -0.9 - Math.min(1.2, z.y * 0.5);
				p.arms = 2.6;
				p.armSplit = 0.4;
				break;
			case ZS.DOWN: {
				const t = Math.min(1, z.stateT / 25);
				p.tilt = -1.45 * t;
				p.arms = 2.4 * t;
				p.lean = 0;
				break;
			}
		}
	}
}
