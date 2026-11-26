import {
	Color,
	DoubleSide,
	DynamicDrawUsage,
	Euler,
	InstancedMesh,
	Matrix4,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	Quaternion,
	type Scene,
	Vector3,
} from "three/webgpu";

/**
 * Pooled presentation particles in one InstancedMesh: sand puffs where bodies land, and a
 * swirl of blossom petals when the pebble settles in the bowl. Fixed arrays, a seeded
 * jitter (fixed-mode captures repeat exactly), no per-frame allocation.
 */
const CAP = 320;

const PETALS = ["#f4b6c2", "#f8d3da", "#fff1e8", "#f29fb0", "#ffd27a"].map(
	(c) => new Color(c),
);
const SAND = new Color("#d9c7a5");

export class Fx {
	private readonly mesh: InstancedMesh;
	private readonly pos = new Float32Array(CAP * 3);
	private readonly vel = new Float32Array(CAP * 3);
	private readonly rot = new Float32Array(CAP * 3);
	private readonly spin = new Float32Array(CAP * 3);
	private readonly life = new Float32Array(CAP);
	private readonly max = new Float32Array(CAP);
	private readonly size = new Float32Array(CAP);
	private readonly drag = new Float32Array(CAP);
	private readonly grav = new Float32Array(CAP);
	private next = 0;
	private seed = 7;
	private readonly m = new Matrix4();
	private readonly q = new Quaternion();
	private readonly e = new Euler();
	private readonly p = new Vector3();
	private readonly s = new Vector3();
	private readonly zero = new Matrix4().makeScale(0, 0, 0);

	constructor(scene: Scene) {
		const mat = new MeshStandardNodeMaterial({
			roughness: 0.8,
			side: DoubleSide,
		});
		this.mesh = new InstancedMesh(new PlaneGeometry(1, 0.7), mat, CAP);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		for (let i = 0; i < CAP; i++) {
			this.mesh.setMatrixAt(i, this.zero);
			this.mesh.setColorAt(i, SAND);
		}
		scene.add(this.mesh);
	}

	private rnd(): number {
		this.seed = (this.seed * 16807) % 2147483647;
		return this.seed / 2147483647;
	}

	private emit(
		x: number,
		y: number,
		z: number,
		vx: number,
		vy: number,
		vz: number,
		life: number,
		size: number,
		drag: number,
		grav: number,
		color: Color,
	): void {
		const i = this.next;
		this.next = (this.next + 1) % CAP;
		this.pos[i * 3] = x;
		this.pos[i * 3 + 1] = y;
		this.pos[i * 3 + 2] = z;
		this.vel[i * 3] = vx;
		this.vel[i * 3 + 1] = vy;
		this.vel[i * 3 + 2] = vz;
		for (let k = 0; k < 3; k++) {
			this.rot[i * 3 + k] = this.rnd() * 6.28;
			this.spin[i * 3 + k] = (this.rnd() - 0.5) * 8;
		}
		this.life[i] = life;
		this.max[i] = life;
		this.size[i] = size;
		this.drag[i] = drag;
		this.grav[i] = grav;
		this.mesh.setColorAt(i, color);
	}

	/** A small sand puff where something landed. */
	puff(x: number, y: number, z: number, strength: number): void {
		const n = Math.min(10, 3 + Math.floor(strength * 1.5));
		for (let k = 0; k < n; k++) {
			const a = this.rnd() * Math.PI * 2;
			const sp = 0.4 + this.rnd() * 0.8 * Math.min(2, strength * 0.4);
			this.emit(
				x,
				Math.max(0.03, y - 0.15),
				z,
				Math.cos(a) * sp,
				0.6 + this.rnd() * 0.8,
				Math.sin(a) * sp,
				0.5 + this.rnd() * 0.3,
				0.05 + this.rnd() * 0.05,
				2.5,
				-3,
				SAND,
			);
		}
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	/** Petals rising and swirling from the bowl. */
	bloom(x: number, y: number, z: number): void {
		for (let k = 0; k < 90; k++) {
			const a = this.rnd() * Math.PI * 2;
			const r = this.rnd() * 0.8;
			const c = PETALS[k % PETALS.length] as Color;
			this.emit(
				x + Math.cos(a) * r,
				y + 0.1,
				z + Math.sin(a) * r,
				Math.cos(a) * (0.6 + this.rnd()) - Math.sin(a) * 1.2,
				2.6 + this.rnd() * 2.8,
				Math.sin(a) * (0.6 + this.rnd()) + Math.cos(a) * 1.2,
				2.2 + this.rnd() * 1.4,
				0.16 + this.rnd() * 0.1,
				1.2,
				-1.6,
				c,
			);
		}
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	frame(dt: number): void {
		if (dt <= 0) return;
		const { pos, vel, rot, spin, life } = this;
		for (let i = 0; i < CAP; i++) {
			const l = (life[i] as number) - dt;
			if (l + dt <= 0) continue;
			life[i] = l;
			if (l <= 0) {
				this.mesh.setMatrixAt(i, this.zero);
				continue;
			}
			const d = Math.exp(-(this.drag[i] as number) * dt);
			const j = i * 3;
			const vx = (vel[j] as number) * d;
			const vy = (vel[j + 1] as number) * d + (this.grav[i] as number) * dt;
			const vz = (vel[j + 2] as number) * d;
			vel[j] = vx;
			vel[j + 1] = vy;
			vel[j + 2] = vz;
			const px = (pos[j] as number) + vx * dt;
			const py = Math.max(0.01, (pos[j + 1] as number) + vy * dt);
			const pz = (pos[j + 2] as number) + vz * dt;
			pos[j] = px;
			pos[j + 1] = py;
			pos[j + 2] = pz;
			const rx = (rot[j] as number) + (spin[j] as number) * dt;
			const ry = (rot[j + 1] as number) + (spin[j + 1] as number) * dt;
			const rz = (rot[j + 2] as number) + (spin[j + 2] as number) * dt;
			rot[j] = rx;
			rot[j + 1] = ry;
			rot[j + 2] = rz;
			const sz =
				(this.size[i] as number) *
				Math.min(1, (l / (this.max[i] as number)) * 3);
			this.e.set(rx, ry, rz);
			this.q.setFromEuler(this.e);
			this.p.set(px, py, pz);
			this.s.set(sz, sz, sz);
			this.m.compose(this.p, this.q, this.s);
			this.mesh.setMatrixAt(i, this.m);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
	}
}
