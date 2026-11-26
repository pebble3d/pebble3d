import { ToonNodeMaterial } from "@pebble3d/renderer";
import {
	abs,
	atan,
	float,
	fract,
	length,
	mix,
	positionLocal,
	sin,
	smoothstep,
	uv,
	vec3,
} from "three/tsl";
import {
	AdditiveBlending,
	type BufferGeometry,
	Color,
	DynamicDrawUsage,
	InstancedMesh,
	type Material,
	MeshBasicNodeMaterial,
	PlaneGeometry,
	RingGeometry,
	type Scene,
} from "three/webgpu";

const _c = new Color();

/**
 * Flat ground decals in one InstancedMesh: each has a centre, rotation, a radius that
 * eases from `r0` to `r1` over its life and a colour that fades (additive) or a size that
 * shrinks at the end (opaque). Preallocated; `add`/`update` do not allocate.
 */
export class Decals {
	readonly mesh: InstancedMesh;
	private readonly cap: number;
	private readonly x: Float32Array;
	private readonly z: Float32Array;
	private readonly y: Float32Array;
	private readonly rot: Float32Array;
	private readonly r0: Float32Array;
	private readonly r1: Float32Array;
	private readonly age: Float32Array;
	private readonly life: Float32Array;
	private readonly col: Float32Array;
	private readonly additive: boolean;
	/** Fraction of life spent growing (the rest holds, then fades). */
	private readonly grow: number;
	private n = 0;
	private cursor = 0;

	constructor(
		scene: Scene,
		geometry: BufferGeometry,
		material: Material,
		cap: number,
		additive: boolean,
		grow: number,
	) {
		this.cap = cap;
		this.additive = additive;
		this.grow = grow;
		this.x = new Float32Array(cap);
		this.z = new Float32Array(cap);
		this.y = new Float32Array(cap);
		this.rot = new Float32Array(cap);
		this.r0 = new Float32Array(cap);
		this.r1 = new Float32Array(cap);
		this.age = new Float32Array(cap);
		this.life = new Float32Array(cap);
		this.col = new Float32Array(cap * 3);
		geometry.rotateX(-Math.PI / 2);
		this.mesh = new InstancedMesh(geometry, material, cap);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.setColorAt(0, _c.set(1, 1, 1));
		this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.receiveShadow = !additive;
		this.mesh.count = 0;
		this.mesh.renderOrder = additive ? 4 : 1;
		scene.add(this.mesh);
	}

	add(
		x: number,
		z: number,
		r0: number,
		r1: number,
		life: number,
		r: number,
		g: number,
		b: number,
		rot = 0,
		y = 0.03,
	): void {
		let i: number;
		if (this.n < this.cap) i = this.n++;
		else {
			i = this.cursor;
			this.cursor = (this.cursor + 1) % this.cap;
		}
		this.x[i] = x;
		this.z[i] = z;
		this.y[i] = y;
		this.rot[i] = rot;
		this.r0[i] = r0;
		this.r1[i] = r1;
		this.age[i] = 0;
		this.life[i] = life;
		this.col[i * 3] = r;
		this.col[i * 3 + 1] = g;
		this.col[i * 3 + 2] = b;
	}

	update(dt: number): void {
		const e = this.mesh.instanceMatrix.array as Float32Array;
		let i = 0;
		while (i < this.n) {
			const a = (this.age[i] as number) + dt;
			this.age[i] = a;
			const t = a / (this.life[i] as number);
			if (t >= 1) {
				this.remove(i);
				continue;
			}
			const g = Math.min(1, t / this.grow);
			const ease = 1 - (1 - g) * (1 - g) * (1 - g);
			let r =
				(this.r0[i] as number) +
				((this.r1[i] as number) - (this.r0[i] as number)) * ease;
			const tail = Math.max(0, (t - 0.7) / 0.3);
			let f = 1;
			if (this.additive) f = 1 - tail * tail;
			else r *= 1 - tail * tail;
			const c = Math.cos(this.rot[i] as number) * r;
			const s = Math.sin(this.rot[i] as number) * r;
			const j = i * 16;
			e[j] = c;
			e[j + 1] = 0;
			e[j + 2] = -s;
			e[j + 3] = 0;
			e[j + 4] = 0;
			e[j + 5] = 1;
			e[j + 6] = 0;
			e[j + 7] = 0;
			e[j + 8] = s;
			e[j + 9] = 0;
			e[j + 10] = c;
			e[j + 11] = 0;
			e[j + 12] = this.x[i] as number;
			e[j + 13] = this.y[i] as number;
			e[j + 14] = this.z[i] as number;
			e[j + 15] = 1;
			_c.setRGB(
				(this.col[i * 3] as number) * f,
				(this.col[i * 3 + 1] as number) * f,
				(this.col[i * 3 + 2] as number) * f,
			);
			this.mesh.setColorAt(i, _c);
			i++;
		}
		this.mesh.count = this.n;
		this.mesh.instanceMatrix.needsUpdate = true;
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	private remove(i: number): void {
		const last = --this.n;
		if (this.cursor >= this.n) this.cursor = 0;
		if (i === last) return;
		this.x[i] = this.x[last] as number;
		this.z[i] = this.z[last] as number;
		this.y[i] = this.y[last] as number;
		this.rot[i] = this.rot[last] as number;
		this.r0[i] = this.r0[last] as number;
		this.r1[i] = this.r1[last] as number;
		this.age[i] = this.age[last] as number;
		this.life[i] = this.life[last] as number;
		this.col[i * 3] = this.col[last * 3] as number;
		this.col[i * 3 + 1] = this.col[last * 3 + 1] as number;
		this.col[i * 3 + 2] = this.col[last * 3 + 2] as number;
	}
}

/** Additive ring (shockwaves, slams): soft inner and outer edges. */
export function ringDecals(scene: Scene, cap: number): Decals {
	const m = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
	const g = new RingGeometry(0.72, 1, 64, 1);
	// RingGeometry uvs are planar; use the radius for a soft band
	const r = length(positionLocal.xz);
	m.colorNode = vec3(1, 1, 1).mul(
		smoothstep(0.72, 0.86, r).mul(float(1).sub(smoothstep(0.9, 1, r))),
	);
	return new Decals(scene, g, m, cap, true, 0.55);
}

/** Additive glowing ground cracks (zombie spawn points). */
export function crackDecals(scene: Scene, cap: number): Decals {
	const m = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
	const p = uv().sub(0.5).mul(2);
	const r = length(p);
	const ang = atan(p.y, p.x);
	// jagged radial fissures: thin bands in angle, wobbling with radius
	const wob = sin(r.mul(17))
		.mul(0.18)
		.add(sin(r.mul(41)).mul(0.07));
	const band = abs(fract(ang.mul(7 / 6.2832).add(wob)).sub(0.5));
	const line = float(1).sub(smoothstep(0.0, 0.07, band));
	const ringed = float(1).sub(smoothstep(0.55, 1, r));
	const core = float(1)
		.sub(smoothstep(0.0, 0.35, r))
		.mul(0.6);
	m.colorNode = vec3(1, 1, 1).mul(line.mul(ringed).add(core));
	return new Decals(scene, new PlaneGeometry(2, 2), m, cap, true, 0.25);
}

/** Opaque glossy ichor pools left on the ground. */
export function ichorDecals(scene: Scene, cap: number): Decals {
	const m = new ToonNodeMaterial({ roughness: 0.18, metalness: 0 });
	// toon: a small wet glint, not a sheet of stepped highlight over the dark pool
	m.toonSpecular = 0.2;
	m.polygonOffset = true;
	m.polygonOffsetFactor = -2;
	m.polygonOffsetUnits = -2;
	const p = uv().sub(0.5).mul(2);
	const r = length(p);
	const ang = atan(p.y, p.x);
	// blobby edge: discard outside a wavy radius
	const edge = float(0.78)
		.add(sin(ang.mul(5)).mul(0.1))
		.add(sin(ang.mul(11)).mul(0.05));
	m.opacityNode = float(1).sub(smoothstep(edge.sub(0.04), edge, r));
	m.alphaTest = 0.5;
	m.colorNode = mix(vec3(0.05, 0.12, 0.04), vec3(0.1, 0.22, 0.07), r);
	return new Decals(scene, new PlaneGeometry(2, 2), m, cap, false, 0.12);
}
