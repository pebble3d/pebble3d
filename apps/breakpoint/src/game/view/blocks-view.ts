import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
	float,
	instancedBufferAttribute,
	mix,
	mx_fractal_noise_float,
	positionGeometry,
	vec3,
} from "three/tsl";
import {
	Color,
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshStandardNodeMaterial,
	Quaternion,
	type Scene,
	SphereGeometry,
	Vector3,
} from "three/webgpu";
import { type BlockSpec, KINDS, type Kind } from "../blocks.ts";
import type { SiteView } from "../host.ts";

/** Stone base colours (sRGB), indexed by `Stone`. */
const STONE_COLORS = ["#c8a27c", "#d9d2c0", "#7b828c", "#b8693f"];
const STRIDE = 8;
const NO_INTERP = 4;

const _p = new Vector3();
const _q = new Quaternion();
const _qb = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _m = new Matrix4();
const _c = new Color();

interface KindMesh {
	mesh: InstancedMesh;
	/** instance -> block index */
	blocks: Int32Array;
	count: number;
}

/**
 * Draws a Site's blocks: one InstancedMesh per block kind (bevelled boxes, a seeded stone
 * texture in TSL, per-block colour jitter), plus the iron balls. `bind` switches sites (the
 * live run or a replay world); `update` interpolates every body from the site's state views.
 */
export class BlocksView {
	private readonly kinds: KindMesh[] = [];
	private readonly balls: Mesh[] = [];
	private site: SiteView | null = null;
	/** Per block: kind mesh index and instance index. */
	private where = new Int32Array(0);

	constructor(scene: Scene, capacity: number) {
		for (let k = 0; k < KINDS.length; k++) {
			const def = KINDS[k] as (typeof KINDS)[number];
			const [hx, hy, hz] = def.half;
			const r = Math.min(hx, hy, hz) * 0.16;
			const geo = new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 1, r);
			const seed = new InstancedBufferAttribute(new Float32Array(capacity), 1);
			const mat = stoneMaterial(seed);
			const mesh = new InstancedMesh(geo, mat, capacity);
			mesh.instanceColor = new InstancedBufferAttribute(
				new Float32Array(capacity * 3).fill(1),
				3,
			);
			mesh.userData.seed = seed;
			mesh.count = 0;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.frustumCulled = false;
			mesh.name = `blocks:${def.name}`;
			scene.add(mesh);
			this.kinds.push({ mesh, blocks: new Int32Array(capacity), count: 0 });
		}
		const ballGeo = new SphereGeometry(1, 40, 24);
		const ballMat = new MeshStandardNodeMaterial({
			color: new Color("#2b2d31"),
			roughness: 0.38,
			metalness: 0.85,
		});
		for (let i = 0; i < 4; i++) {
			const m = new Mesh(ballGeo, ballMat);
			m.castShadow = true;
			m.receiveShadow = true;
			m.visible = false;
			scene.add(m);
			this.balls.push(m);
		}
	}

	/** Shows `site`'s blocks (rebuilding the instance tables). */
	bind(site: SiteView): void {
		this.site = site;
		for (const k of this.kinds) k.count = 0;
		this.where = new Int32Array(site.n * 2);
		for (let i = 0; i < site.n; i++) {
			const b = site.blocks[i] as BlockSpec;
			const km = this.kinds[b.kind as Kind] as KindMesh;
			const idx = km.count++;
			km.blocks[idx] = i;
			this.where[i * 2] = b.kind;
			this.where[i * 2 + 1] = idx;
			_c.set(STONE_COLORS[b.stone] ?? "#999");
			const j = 0.82 + b.tint * 0.3;
			_c.r *= j * (0.97 + 0.06 * ((b.tint * 7.3) % 1));
			_c.g *= j;
			_c.b *= j * (0.96 + 0.08 * ((b.tint * 3.1) % 1));
			km.mesh.instanceColor?.setXYZ(idx, _c.r, _c.g, _c.b);
			(km.mesh.userData.seed as InstancedBufferAttribute).setX(
				idx,
				b.tint * 97.0,
			);
		}
		for (const k of this.kinds) {
			k.mesh.count = k.count;
			if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
			(k.mesh.userData.seed as InstancedBufferAttribute).needsUpdate = true;
		}
		for (const b of this.balls) b.visible = false;
		this.update(1);
	}

	update(alpha: number): void {
		const site = this.site;
		if (!site) return;
		site.refresh(); // another world may have grown the wasm memory
		const prev = site.prev;
		const curr = site.curr;
		for (const k of this.kinds) {
			const arr = k.mesh.instanceMatrix.array as Float32Array;
			for (let i = 0; i < k.count; i++) {
				const slot = site.slots[k.blocks[i] as number] as number;
				pose(prev, curr, slot, alpha);
				_m.compose(_p, _q, _s);
				_m.toArray(arr, i * 16);
			}
			k.mesh.instanceMatrix.needsUpdate = true;
		}
		for (let i = 0; i < this.balls.length; i++) {
			const m = this.balls[i] as Mesh;
			const slot = site.ballSlots[i];
			if (slot === undefined) {
				m.visible = false;
				continue;
			}
			m.visible = true;
			pose(prev, curr, slot, alpha);
			m.position.copy(_p);
			m.quaternion.copy(_q);
			m.scale.setScalar(0.6);
		}
	}

	/** Interpolated position of ball `i` (false when it does not exist). */
	ballPosition(i: number, out: Vector3): boolean {
		const m = this.balls[i];
		if (!m?.visible) return false;
		out.copy(m.position);
		return true;
	}
}

function pose(
	prev: Float32Array,
	curr: Float32Array,
	slot: number,
	a: number,
): void {
	const o = slot * STRIDE;
	const snap = ((curr[o + 7] as number) & NO_INTERP) !== 0 || a >= 1;
	if (snap) {
		_p.set(curr[o] as number, curr[o + 1] as number, curr[o + 2] as number);
		_q.set(
			curr[o + 3] as number,
			curr[o + 4] as number,
			curr[o + 5] as number,
			curr[o + 6] as number,
		);
		return;
	}
	const px = prev[o] as number;
	const py = prev[o + 1] as number;
	const pz = prev[o + 2] as number;
	_p.set(
		px + ((curr[o] as number) - px) * a,
		py + ((curr[o + 1] as number) - py) * a,
		pz + ((curr[o + 2] as number) - pz) * a,
	);
	_q.set(
		prev[o + 3] as number,
		prev[o + 4] as number,
		prev[o + 5] as number,
		prev[o + 6] as number,
	);
	_qb.set(
		curr[o + 3] as number,
		curr[o + 4] as number,
		curr[o + 5] as number,
		curr[o + 6] as number,
	);
	_q.slerp(_qb, a);
}

/**
 * Dressed stone: two octaves of object-space noise (stable as the block tumbles, offset per
 * block by its seed) modulate albedo and roughness; the instance colour tints it.
 */
function stoneMaterial(
	seed: InstancedBufferAttribute,
): MeshStandardNodeMaterial {
	const mat = new MeshStandardNodeMaterial({ roughness: 0.86, metalness: 0 });
	const s = instancedBufferAttribute(seed, "float") as unknown as ReturnType<
		typeof float
	>;
	const p = positionGeometry.mul(3.1).add(vec3(s, s.mul(0.37), s.mul(1.71)));
	const coarse = mx_fractal_noise_float(p, 3, 2.0, 0.5);
	const fine = mx_fractal_noise_float(
		positionGeometry.mul(14.0).add(s),
		2,
		2.0,
		0.5,
	);
	const v = float(0.86).add(coarse.mul(0.22)).add(fine.mul(0.08));
	mat.colorNode = vec3(v, v.mul(0.985), v.mul(0.97));
	mat.roughnessNode = mix(float(0.78), float(0.95), fine.mul(0.5).add(0.5));
	return mat;
}
