import {
	AdditiveBlending,
	Color,
	DynamicDrawUsage,
	IcosahedronGeometry,
	InstancedMesh,
	Matrix4,
	MeshBasicNodeMaterial,
	type Object3D,
	Quaternion,
	Vector3,
} from "three/webgpu";
import { Rng } from "../rng.ts";

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _c = new Color();

/**
 * Pooled glowing sparks (one InstancedMesh, structure-of-arrays state, oldest recycled).
 * `burst` and `update` never allocate. Presentation only: seeded by its own Rng, never the sim.
 */
export class Sparks {
	readonly mesh: InstancedMesh;
	private readonly cap = 220;
	private readonly px = new Float32Array(this.cap);
	private readonly py = new Float32Array(this.cap);
	private readonly pz = new Float32Array(this.cap);
	private readonly vx = new Float32Array(this.cap);
	private readonly vy = new Float32Array(this.cap);
	private readonly vz = new Float32Array(this.cap);
	private readonly age = new Float32Array(this.cap);
	private readonly life = new Float32Array(this.cap);
	private readonly size = new Float32Array(this.cap);
	private cursor = 0;
	private readonly rng = new Rng(4242);

	constructor(parent: Object3D) {
		const mat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 0), mat, this.cap);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.setColorAt(0, _c.set(1, 1, 1));
		this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 6;
		for (let i = 0; i < this.cap; i++) this.life[i] = 0;
		parent.add(this.mesh);
	}

	/**
	 * `n` sparks at (x, y, z) moving along (dx, dy, dz) * speed with a cone `spread`, tinted
	 * `color` (HDR: values > 1 bloom).
	 */
	burst(
		n: number,
		x: number,
		y: number,
		z: number,
		dx: number,
		dy: number,
		dz: number,
		speed: number,
		spread: number,
		color: Color,
		intensity: number,
	): void {
		const r = this.rng;
		for (let k = 0; k < n; k++) {
			const i = this.cursor;
			this.cursor = (this.cursor + 1) % this.cap;
			const s = speed * r.range(0.4, 1.1);
			this.px[i] = x;
			this.py[i] = y;
			this.pz[i] = z;
			this.vx[i] = (dx + r.range(-spread, spread)) * s;
			this.vy[i] = (dy + r.range(-spread, spread) * 0.6) * s;
			this.vz[i] = (dz + r.range(-spread, spread)) * s;
			this.age[i] = 0;
			this.life[i] = r.range(0.25, 0.7);
			this.size[i] = r.range(0.03, 0.07);
			this.mesh.setColorAt(
				i,
				_c.copy(color).multiplyScalar(intensity * r.range(0.6, 1.2)),
			);
		}
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	update(dt: number): void {
		let live = 0;
		for (let i = 0; i < this.cap; i++) {
			const l = this.life[i] as number;
			let a = this.age[i] as number;
			if (a < l) {
				a += dt;
				this.age[i] = a;
				this.vy[i] = (this.vy[i] as number) - 9 * dt;
				const drag = Math.exp(-2.5 * dt);
				this.vx[i] = (this.vx[i] as number) * drag;
				this.vz[i] = (this.vz[i] as number) * drag;
				this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
				this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
				this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * dt;
			}
			const k = a < l ? 1 - a / l : 0;
			if (k > 0) live++;
			const sz = (this.size[i] as number) * k;
			_p.set(this.px[i] as number, this.py[i] as number, this.pz[i] as number);
			_s.set(sz, sz, sz);
			_m.compose(_p, _q, _s);
			this.mesh.setMatrixAt(i, _m);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
		this.mesh.visible = live > 0;
	}
}
