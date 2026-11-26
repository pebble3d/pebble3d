import {
	type BufferGeometry,
	Color,
	DynamicDrawUsage,
	InstancedMesh,
	type Material,
	type PerspectiveCamera,
	type Scene,
	Vector3,
} from "three/webgpu";

export interface ParticleOptions {
	capacity: number;
	geometry: BufferGeometry;
	material: Material;
	/** billboard: faces the camera; stretch: billboard stretched along velocity; tumble: a lit 3D chunk. */
	mode: "billboard" | "stretch" | "tumble";
	gravity: number;
	/** Velocity damping per second. */
	drag: number;
	/** Extra length per m/s of speed (stretch mode). */
	stretch?: number;
	/** Fade colour toward black with age (additive particles). */
	fadeColor?: boolean;
	castShadow?: boolean;
	/** Called when a particle reaches the ground (it then dies). */
	onGround?: (x: number, z: number, size: number) => void;
}

const _c = new Color();
const _toCam = new Vector3();

/**
 * A pooled particle system drawn as one InstancedMesh. Structure-of-arrays state; the pool
 * recycles the oldest particle when full. `spawn` and `update` do not allocate.
 */
export class Particles {
	readonly mesh: InstancedMesh;
	private readonly o: ParticleOptions;
	private readonly cap: number;
	private readonly px: Float32Array;
	private readonly py: Float32Array;
	private readonly pz: Float32Array;
	private readonly vx: Float32Array;
	private readonly vy: Float32Array;
	private readonly vz: Float32Array;
	private readonly age: Float32Array;
	private readonly life: Float32Array;
	private readonly size: Float32Array;
	private readonly col: Float32Array;
	private readonly spin: Float32Array;
	private n = 0;
	private cursor = 0;

	constructor(scene: Scene, o: ParticleOptions) {
		this.o = o;
		const c = o.capacity;
		this.cap = c;
		this.px = new Float32Array(c);
		this.py = new Float32Array(c);
		this.pz = new Float32Array(c);
		this.vx = new Float32Array(c);
		this.vy = new Float32Array(c);
		this.vz = new Float32Array(c);
		this.age = new Float32Array(c);
		this.life = new Float32Array(c);
		this.size = new Float32Array(c);
		this.col = new Float32Array(c * 3);
		this.spin = new Float32Array(c);
		this.mesh = new InstancedMesh(o.geometry, o.material, c);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.setColorAt(0, _c.set(1, 1, 1));
		this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = o.castShadow === true;
		this.mesh.count = 0;
		scene.add(this.mesh);
	}

	spawn(
		x: number,
		y: number,
		z: number,
		vx: number,
		vy: number,
		vz: number,
		life: number,
		size: number,
		r: number,
		g: number,
		b: number,
	): void {
		let i: number;
		if (this.n < this.cap) i = this.n++;
		else {
			i = this.cursor;
			this.cursor = (this.cursor + 1) % this.cap;
		}
		this.px[i] = x;
		this.py[i] = y;
		this.pz[i] = z;
		this.vx[i] = vx;
		this.vy[i] = vy;
		this.vz[i] = vz;
		this.age[i] = 0;
		this.life[i] = life;
		this.size[i] = size;
		this.col[i * 3] = r;
		this.col[i * 3 + 1] = g;
		this.col[i * 3 + 2] = b;
		this.spin[i] = (i * 2.399) % 6.283;
	}

	update(dt: number, camera: PerspectiveCamera): void {
		const o = this.o;
		const damp = Math.exp(-o.drag * dt);
		const m = this.mesh;
		const e = m.instanceMatrix.array as Float32Array;
		const cam = camera.position;
		let i = 0;
		while (i < this.n) {
			let a = (this.age[i] as number) + dt;
			this.age[i] = a;
			let dead = a >= (this.life[i] as number);
			if (!dead) {
				this.vy[i] = ((this.vy[i] as number) - o.gravity * dt) * damp;
				this.vx[i] = (this.vx[i] as number) * damp;
				this.vz[i] = (this.vz[i] as number) * damp;
				this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dt;
				this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dt;
				this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * dt;
				if ((this.py[i] as number) < 0.02 && (this.vy[i] as number) < 0) {
					if (o.onGround) {
						o.onGround(
							this.px[i] as number,
							this.pz[i] as number,
							this.size[i] as number,
						);
						dead = true;
					} else {
						this.py[i] = 0.02;
						this.vy[i] = -(this.vy[i] as number) * 0.3;
						this.vx[i] = (this.vx[i] as number) * 0.6;
						this.vz[i] = (this.vz[i] as number) * 0.6;
					}
				}
			}
			if (dead) {
				this.kill(i);
				continue;
			}
			a /= this.life[i] as number;
			const k = 1 - a;
			const s =
				(this.size[i] as number) *
				(o.fadeColor ? 0.6 + 0.4 * k : k > 0.3 ? 1 : k / 0.3);
			const x = this.px[i] as number;
			const y = this.py[i] as number;
			const z = this.pz[i] as number;
			const j = i * 16;
			if (o.mode === "tumble") {
				// random-ish rotation about a tilted axis, uniform scale
				const ang = (this.spin[i] as number) + a * 9;
				const c = Math.cos(ang) * s;
				const sn = Math.sin(ang) * s;
				e[j] = c;
				e[j + 1] = sn;
				e[j + 2] = 0;
				e[j + 3] = 0;
				e[j + 4] = -sn;
				e[j + 5] = c;
				e[j + 6] = 0;
				e[j + 7] = 0;
				e[j + 8] = 0;
				e[j + 9] = 0;
				e[j + 10] = s;
				e[j + 11] = 0;
			} else {
				// Y axis: velocity (stretch) or camera up; Z axis: toward the camera
				_toCam.set(cam.x - x, cam.y - y, cam.z - z).normalize();
				let ux: number;
				let uy: number;
				let uz: number;
				let len = s;
				if (o.mode === "stretch") {
					const vx = this.vx[i] as number;
					const vy = this.vy[i] as number;
					const vz = this.vz[i] as number;
					const sp = Math.hypot(vx, vy, vz) || 1;
					ux = vx / sp;
					uy = vy / sp;
					uz = vz / sp;
					len = s * (1 + sp * (o.stretch ?? 0.05));
				} else {
					ux = 0;
					uy = 1;
					uz = 0;
				}
				// X = up x toCam
				let xx = uy * _toCam.z - uz * _toCam.y;
				let xy = uz * _toCam.x - ux * _toCam.z;
				let xz = ux * _toCam.y - uy * _toCam.x;
				const xl = Math.hypot(xx, xy, xz) || 1;
				xx /= xl;
				xy /= xl;
				xz /= xl;
				e[j] = xx * s;
				e[j + 1] = xy * s;
				e[j + 2] = xz * s;
				e[j + 3] = 0;
				e[j + 4] = ux * len;
				e[j + 5] = uy * len;
				e[j + 6] = uz * len;
				e[j + 7] = 0;
				e[j + 8] = _toCam.x;
				e[j + 9] = _toCam.y;
				e[j + 10] = _toCam.z;
				e[j + 11] = 0;
			}
			e[j + 12] = x;
			e[j + 13] = y;
			e[j + 14] = z;
			e[j + 15] = 1;
			const f = o.fadeColor ? k * k : 1;
			_c.setRGB(
				(this.col[i * 3] as number) * f,
				(this.col[i * 3 + 1] as number) * f,
				(this.col[i * 3 + 2] as number) * f,
			);
			m.setColorAt(i, _c);
			i++;
		}
		m.count = this.n;
		m.instanceMatrix.needsUpdate = true;
		if (m.instanceColor) m.instanceColor.needsUpdate = true;
	}

	/** Swap-remove particle `i`. */
	private kill(i: number): void {
		const last = --this.n;
		if (this.cursor >= this.n) this.cursor = 0;
		if (i === last) return;
		this.px[i] = this.px[last] as number;
		this.py[i] = this.py[last] as number;
		this.pz[i] = this.pz[last] as number;
		this.vx[i] = this.vx[last] as number;
		this.vy[i] = this.vy[last] as number;
		this.vz[i] = this.vz[last] as number;
		this.age[i] = this.age[last] as number;
		this.life[i] = this.life[last] as number;
		this.size[i] = this.size[last] as number;
		this.spin[i] = this.spin[last] as number;
		this.col[i * 3] = this.col[last * 3] as number;
		this.col[i * 3 + 1] = this.col[last * 3 + 1] as number;
		this.col[i * 3 + 2] = this.col[last * 3 + 2] as number;
	}
}
