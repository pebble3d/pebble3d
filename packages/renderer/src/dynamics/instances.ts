import {
	type BufferGeometry,
	type Color,
	InstancedBufferAttribute,
	InstancedMesh,
	type Material,
	Matrix4,
	Quaternion,
	type Scene,
	Vector3,
} from "three/webgpu";

/** State buffer layout: 8 f32 per slot, `px,py,pz,qx,qy,qz,qw,flags`. */
export const STATE_STRIDE = 8;
export const ACTIVE = 1;
export const SLEEPING = 2;
export const NO_INTERP = 4;

const INITIAL_CAPACITY = 64;

interface Group {
	key: string;
	mesh: InstancedMesh;
	capacity: number;
	count: number;
	/** instance index -> slot */
	slots: Int32Array;
}

// Preallocated scratch (no per-frame allocation in sync).
const _pos = new Vector3();
const _quat = new Quaternion();
const _quatB = new Quaternion();
const _one = new Vector3(1, 1, 1);
const _mat = new Matrix4();
const _hidden = new Matrix4().makeScale(0, 0, 0);

/** Writes the interpolated (or NO_INTERP-snapped) transform of `slot` into `outPos`/`outQuat`. Returns false (writing nothing) if the slot is not ACTIVE. */
export function readSlot(
	prev: Float32Array,
	curr: Float32Array,
	slot: number,
	alpha: number,
	outPos: Vector3,
	outQuat: Quaternion,
): boolean {
	const o = slot * STATE_STRIDE;
	if (o + 7 >= curr.length) return false;
	const flags = curr[o + 7] as number;
	if ((flags & ACTIVE) === 0) return false;
	if ((flags & NO_INTERP) !== 0 || o + 7 >= prev.length || alpha >= 1) {
		outPos.set(curr[o] as number, curr[o + 1] as number, curr[o + 2] as number);
		outQuat.set(
			curr[o + 3] as number,
			curr[o + 4] as number,
			curr[o + 5] as number,
			curr[o + 6] as number,
		);
		return true;
	}
	const px = prev[o] as number;
	const py = prev[o + 1] as number;
	const pz = prev[o + 2] as number;
	outPos.set(
		px + ((curr[o] as number) - px) * alpha,
		py + ((curr[o + 1] as number) - py) * alpha,
		pz + ((curr[o + 2] as number) - pz) * alpha,
	);
	outQuat.set(
		prev[o + 3] as number,
		prev[o + 4] as number,
		prev[o + 5] as number,
		prev[o + 6] as number,
	);
	_quatB.set(
		curr[o + 3] as number,
		curr[o + 4] as number,
		curr[o + 5] as number,
		curr[o + 6] as number,
	);
	outQuat.slerp(_quatB, alpha);
	return true;
}

/**
 * One `InstancedMesh` per key (geometry kind + size + material params). A slot maps to
 * (group, instance index); removal swaps the last instance into the freed index.
 * Capacity starts at 64 and doubles when full.
 */
export class InstanceRegistry {
	private readonly scene: Scene;
	private readonly groups = new Map<string, Group>();
	private readonly groupList: Group[] = [];
	private readonly meshList: InstancedMesh[] = [];
	/** slot -> group, or undefined */
	private slotGroup: (Group | undefined)[] = [];
	/** slot -> instance index */
	private slotIndex: number[] = [];

	constructor(scene: Scene) {
		this.scene = scene;
	}

	add(
		key: string,
		geometry: BufferGeometry,
		material: Material,
		slot: number,
		color?: Color,
	): void {
		if (this.slotGroup[slot] !== undefined) this.removeSlot(slot);
		let g = this.groups.get(key);
		if (!g) {
			const mesh = new InstancedMesh(geometry, material, INITIAL_CAPACITY);
			mesh.count = 0;
			mesh.frustumCulled = false; // instances move every frame; no per-frame bounds
			mesh.name = `instances:${key}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			g = {
				key,
				mesh,
				capacity: INITIAL_CAPACITY,
				count: 0,
				slots: new Int32Array(INITIAL_CAPACITY),
			};
			this.groups.set(key, g);
			this.groupList.push(g);
			this.meshList.push(mesh);
			this.scene.add(mesh);
		}
		if (g.count === g.capacity) this.grow(g);
		const index = g.count++;
		g.slots[index] = slot;
		g.mesh.count = g.count;
		g.mesh.setMatrixAt(index, _hidden); // hidden until the first sync writes it
		g.mesh.instanceMatrix.needsUpdate = true;
		if (color) {
			g.mesh.setColorAt(index, color);
			if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
		} else if (g.mesh.instanceColor) {
			g.mesh.instanceColor.setXYZ(index, 1, 1, 1);
			g.mesh.instanceColor.needsUpdate = true;
		}
		this.slotGroup[slot] = g;
		this.slotIndex[slot] = index;
	}

	removeSlot(slot: number): void {
		const g = this.slotGroup[slot];
		if (!g) return;
		const index = this.slotIndex[slot] as number;
		const last = g.count - 1;
		if (index !== last) {
			const movedSlot = g.slots[last] as number;
			const m = g.mesh.instanceMatrix.array as Float32Array;
			m.copyWithin(index * 16, last * 16, last * 16 + 16);
			const c = g.mesh.instanceColor;
			if (c) {
				const ca = c.array as Float32Array;
				ca.copyWithin(index * 3, last * 3, last * 3 + 3);
				c.needsUpdate = true;
			}
			g.slots[index] = movedSlot;
			this.slotIndex[movedSlot] = index;
		}
		g.count = last;
		g.mesh.count = last;
		g.mesh.instanceMatrix.needsUpdate = true;
		this.slotGroup[slot] = undefined;
	}

	sync(prev: Float32Array, curr: Float32Array, alpha: number): void {
		for (let gi = 0; gi < this.groupList.length; gi++) {
			const g = this.groupList[gi] as Group;
			if (g.count === 0) continue;
			const arr = g.mesh.instanceMatrix.array as Float32Array;
			let dirty = false;
			for (let i = 0; i < g.count; i++) {
				const slot = g.slots[i] as number;
				if (!readSlot(prev, curr, slot, alpha, _pos, _quat)) continue;
				_mat.compose(_pos, _quat, _one);
				_mat.toArray(arr, i * 16);
				dirty = true;
			}
			if (dirty) g.mesh.instanceMatrix.needsUpdate = true;
		}
	}

	meshes(): InstancedMesh[] {
		return this.meshList;
	}

	/** The current mesh for `key` (it is replaced when the group grows). */
	mesh(key: string): InstancedMesh | undefined {
		return this.groups.get(key)?.mesh;
	}

	has(key: string): boolean {
		return this.groups.has(key);
	}

	dispose(): void {
		for (const g of this.groupList) {
			this.scene.remove(g.mesh);
			g.mesh.dispose();
		}
		this.groups.clear();
		this.groupList.length = 0;
		this.meshList.length = 0;
		this.slotGroup = [];
		this.slotIndex = [];
	}

	private grow(g: Group): void {
		const old = g.mesh;
		const capacity = g.capacity * 2;
		const mesh = new InstancedMesh(old.geometry, old.material, capacity);
		(mesh.instanceMatrix.array as Float32Array).set(
			old.instanceMatrix.array as Float32Array,
		);
		if (old.instanceColor) {
			const colors = new Float32Array(capacity * 3).fill(1);
			colors.set(old.instanceColor.array as Float32Array);
			mesh.instanceColor = new InstancedBufferAttribute(colors, 3);
		}
		mesh.count = g.count;
		mesh.frustumCulled = old.frustumCulled;
		mesh.name = old.name;
		mesh.castShadow = old.castShadow;
		mesh.receiveShadow = old.receiveShadow;
		mesh.layers.mask = old.layers.mask;
		const slots = new Int32Array(capacity);
		slots.set(g.slots);
		g.slots = slots;
		g.capacity = capacity;
		g.mesh = mesh;
		const li = this.meshList.indexOf(old);
		if (li >= 0) this.meshList[li] = mesh;
		this.scene.remove(old);
		this.scene.add(mesh);
		old.dispose(); // frees instance buffers only; geometry/material are shared
	}
}
