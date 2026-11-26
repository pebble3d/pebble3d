import { color, instanceColor } from "three/tsl";
import {
	AdditiveBlending,
	Color,
	DynamicDrawUsage,
	InstancedMesh,
	Matrix4,
	MeshBasicNodeMaterial,
	OctahedronGeometry,
	Quaternion,
	type Scene,
	Vector3,
} from "three/webgpu";
import { EV, type Events } from "../sim.ts";

const N = 240;
const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _c = new Color();
const CYAN = new Color("#7ff6ff");
const GOLD = new Color("#ffcf6a");
const DUST = new Color("#f6e3cf");
const WHITE = new Color("#ffffff");

/**
 * Pooled additive sparks (one instanced draw): shard bursts, checkpoint and finish
 * fountains, landing dust, the respawn flash. Driven by the sim's per-tick events;
 * `update` does not allocate.
 */
export class Effects {
	private readonly mesh: InstancedMesh;
	private readonly px = new Float32Array(N);
	private readonly py = new Float32Array(N);
	private readonly pz = new Float32Array(N);
	private readonly vx = new Float32Array(N);
	private readonly vy = new Float32Array(N);
	private readonly vz = new Float32Array(N);
	private readonly life = new Float32Array(N);
	private readonly max = new Float32Array(N);
	private readonly size = new Float32Array(N);
	private readonly grav = new Float32Array(N);
	private next = 0;
	private seed = 1;

	constructor(scene: Scene) {
		const geo = new OctahedronGeometry(0.08, 0);
		const mat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		mat.colorNode = color(instanceColor).mul(2.4);
		this.mesh = new InstancedMesh(geo, mat, N);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 5;
		_m.makeScale(0, 0, 0);
		for (let i = 0; i < N; i++) {
			this.mesh.setMatrixAt(i, _m);
			this.mesh.setColorAt(i, WHITE);
		}
		scene.add(this.mesh);
	}

	/** Presentation-only randomness (never feeds the sim). */
	private rand(): number {
		this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
		return this.seed / 4294967296;
	}

	private burst(
		x: number,
		y: number,
		z: number,
		n: number,
		c: Color,
		speed: number,
		up: number,
		life: number,
		grav: number,
		size: number,
	): void {
		for (let k = 0; k < n; k++) {
			const i = this.next;
			this.next = (this.next + 1) % N;
			const a = this.rand() * Math.PI * 2;
			const r = speed * (0.4 + this.rand() * 0.6);
			this.px[i] = x;
			this.py[i] = y;
			this.pz[i] = z;
			this.vx[i] = Math.cos(a) * r;
			this.vz[i] = Math.sin(a) * r;
			this.vy[i] = up * (0.5 + this.rand());
			this.life[i] = life * (0.6 + this.rand() * 0.4);
			this.max[i] = this.life[i] as number;
			this.grav[i] = grav;
			this.size[i] = size * (0.6 + this.rand() * 0.8);
			_c.copy(c).lerp(WHITE, this.rand() * 0.35);
			this.mesh.setColorAt(i, _c);
		}
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	handle(ev: Events): void {
		for (let e = 0; e < ev.n; e++) {
			const t = ev.type[e];
			const x = ev.x[e] as number;
			const y = ev.y[e] as number;
			const z = ev.z[e] as number;
			if (t === EV.SHARD) this.burst(x, y, z, 26, CYAN, 3.2, 2.5, 0.8, -4, 1.3);
			else if (t === EV.CHECKPOINT)
				this.burst(x, y + 0.2, z, 40, GOLD, 2.2, 6, 1.3, -7, 1.4);
			else if (t === EV.FINISH) {
				this.burst(x, y + 0.2, z, 70, GOLD, 3.5, 8, 1.8, -6, 1.6);
				this.burst(x, y + 2, z, 40, CYAN, 4, 4, 1.6, -3, 1.2);
			} else if (t === EV.LAND && (ev.a[e] as number) > 20)
				this.burst(x, y - 0.75, z, 10, DUST, 1.6, 0.6, 0.45, -2, 1.1);
			else if (t === EV.RESPAWN)
				this.burst(x, y + 0.9, z, 36, CYAN, 1.8, 3, 0.9, -1, 1.2);
		}
	}

	update(dt: number): void {
		for (let i = 0; i < N; i++) {
			const l = this.life[i] as number;
			if (l <= 0) continue;
			const nl = l - dt;
			this.life[i] = nl;
			if (nl <= 0) {
				_m.makeScale(0, 0, 0);
				this.mesh.setMatrixAt(i, _m);
				continue;
			}
			this.vy[i] = (this.vy[i] as number) + (this.grav[i] as number) * dt;
			this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
			this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
			this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * dt;
			const k = (nl / (this.max[i] as number)) * (this.size[i] as number);
			_p.set(this.px[i] as number, this.py[i] as number, this.pz[i] as number);
			_s.set(k, k, k);
			_m.compose(_p, _q, _s);
			this.mesh.setMatrixAt(i, _m);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
	}
}
