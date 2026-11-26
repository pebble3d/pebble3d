import { attribute, color, float, uniform } from "three/tsl";
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	DynamicDrawUsage,
	LineBasicNodeMaterial,
	LineSegments,
	Mesh,
	MeshBasicNodeMaterial,
	type Object3D,
	type PerspectiveCamera,
	Vector3,
} from "three/webgpu";
import { Rng } from "../rng.ts";

/**
 * Speed lines: streaks in camera space rushing past the lens. Their count of visible streaks,
 * length and brightness all scale with speed; below ~50 km/h they vanish.
 */
export class SpeedLines {
	readonly obj: LineSegments;
	private readonly n = 72;
	private readonly px: Float32Array;
	private readonly py: Float32Array;
	private readonly pz: Float32Array;
	private readonly pos: Float32Array;
	private readonly attr: BufferAttribute;
	private readonly strength = uniform(0);

	constructor(camera: PerspectiveCamera, tint: string) {
		const rng = new Rng(77);
		this.px = new Float32Array(this.n);
		this.py = new Float32Array(this.n);
		this.pz = new Float32Array(this.n);
		for (let i = 0; i < this.n; i++) {
			const a = rng.range(0, Math.PI * 2);
			const r = rng.range(1.4, 4.2);
			this.px[i] = Math.cos(a) * r * 1.6;
			this.py[i] = Math.sin(a) * r;
			this.pz[i] = -rng.range(2, 40);
		}
		this.pos = new Float32Array(this.n * 6);
		const g = new BufferGeometry();
		this.attr = new BufferAttribute(this.pos, 3);
		this.attr.setUsage(DynamicDrawUsage);
		g.setAttribute("position", this.attr);
		// per-vertex alpha: head bright, tail clear
		const fade = new Float32Array(this.n * 2);
		for (let i = 0; i < this.n; i++) {
			fade[i * 2] = 1;
			fade[i * 2 + 1] = 0;
		}
		g.setAttribute("fade", new BufferAttribute(fade, 1));
		const m = new LineBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			depthTest: false,
			blending: AdditiveBlending,
		});
		const f = attribute("fade", "float");
		m.colorNode = color(tint).mul(1.2);
		m.opacityNode = f.mul(this.strength);
		this.obj = new LineSegments(g, m);
		this.obj.frustumCulled = false;
		this.obj.renderOrder = 20;
		camera.add(this.obj);
	}

	update(dt: number, speed: number, boosting: number): void {
		const s = Math.max(0, Math.min(1, (speed - 14) / 22)) + boosting * 0.6;
		this.strength.value +=
			(Math.min(1.2, s) * 0.4 - this.strength.value) * Math.min(1, dt * 6);
		this.obj.visible = this.strength.value > 0.01;
		if (!this.obj.visible) return;
		const v = speed * 1.6 + 10;
		const len = 0.6 + speed * 0.12;
		for (let i = 0; i < this.n; i++) {
			let z = (this.pz[i] as number) + v * dt;
			if (z > -1.5) z -= 40;
			this.pz[i] = z;
			const o = i * 6;
			const x = this.px[i] as number;
			const y = this.py[i] as number;
			this.pos[o] = x;
			this.pos[o + 1] = y;
			this.pos[o + 2] = z;
			this.pos[o + 3] = x;
			this.pos[o + 4] = y;
			this.pos[o + 5] = z - len;
		}
		this.attr.needsUpdate = true;
	}
}

const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _side = new Vector3();
const _view = new Vector3();

/**
 * The ghost line: a camera-facing ribbon through the ghost's recent positions, tapering and
 * fading toward the tail.
 */
export class Ribbon {
	readonly mesh: Mesh;
	private readonly cap: number;
	private readonly hx: Float32Array;
	private readonly hy: Float32Array;
	private readonly hz: Float32Array;
	private count = 0;
	private head = 0;
	private readonly pos: Float32Array;
	private readonly attr: BufferAttribute;
	private readonly width: number;
	readonly opacity = uniform(1);

	constructor(parent: Object3D, tint: string, cap = 70, width = 0.3) {
		this.cap = cap;
		this.width = width;
		this.hx = new Float32Array(cap);
		this.hy = new Float32Array(cap);
		this.hz = new Float32Array(cap);
		this.pos = new Float32Array(cap * 2 * 3);
		const along = new Float32Array(cap * 2);
		for (let i = 0; i < cap; i++) {
			along[i * 2] = i / (cap - 1);
			along[i * 2 + 1] = i / (cap - 1);
		}
		const idx: number[] = [];
		for (let i = 0; i + 1 < cap; i++) {
			const a = i * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		const g = new BufferGeometry();
		this.attr = new BufferAttribute(this.pos, 3);
		this.attr.setUsage(DynamicDrawUsage);
		g.setAttribute("position", this.attr);
		g.setAttribute("along", new BufferAttribute(along, 1));
		g.setIndex(idx);
		const m = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			side: 2,
		});
		const t = attribute("along", "float");
		const fade = float(1).sub(t);
		m.colorNode = color(tint).mul(1.4);
		m.opacityNode = fade.mul(fade).mul(0.42).mul(this.opacity);
		this.mesh = new Mesh(g, m);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 4;
		parent.add(this.mesh);
	}

	clear(): void {
		this.count = 0;
	}

	push(x: number, y: number, z: number): void {
		this.head = (this.head + 1) % this.cap;
		this.hx[this.head] = x;
		this.hy[this.head] = y;
		this.hz[this.head] = z;
		if (this.count < this.cap) this.count++;
	}

	/** Rebuilds the strip; `hx/hy/hz` is the live head position (interpolated). */
	update(camPos: Vector3, x: number, y: number, z: number): void {
		const n = this.count;
		this.mesh.visible = n > 2;
		if (n <= 2) return;
		for (let k = 0; k < this.cap; k++) {
			const kk = Math.min(k, n - 1);
			const idx = (this.head - kk + this.cap * 2) % this.cap;
			if (k === 0) _a.set(x, y, z);
			else
				_a.set(
					this.hx[idx] as number,
					this.hy[idx] as number,
					this.hz[idx] as number,
				);
			const nidx =
				(this.head - Math.min(kk + 1, n - 1) + this.cap * 2) % this.cap;
			_b.set(
				this.hx[nidx] as number,
				this.hy[nidx] as number,
				this.hz[nidx] as number,
			);
			_d.subVectors(_a, _b);
			if (_d.lengthSq() < 1e-8) _d.set(0, 0, 1);
			_view.subVectors(camPos, _a);
			_side.crossVectors(_d, _view).normalize();
			const w = this.width * (1 - k / this.cap) + 0.02;
			const o = k * 6;
			this.pos[o] = _a.x + _side.x * w;
			this.pos[o + 1] = _a.y + _side.y * w;
			this.pos[o + 2] = _a.z + _side.z * w;
			this.pos[o + 3] = _a.x - _side.x * w;
			this.pos[o + 4] = _a.y - _side.y * w;
			this.pos[o + 5] = _a.z - _side.z * w;
		}
		this.attr.needsUpdate = true;
	}
}
