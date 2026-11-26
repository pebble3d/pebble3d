import {
	AdditiveBlending,
	BoxGeometry,
	type BufferGeometry,
	Color,
	DynamicDrawUsage,
	IcosahedronGeometry,
	InstancedMesh,
	Matrix4,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	OctahedronGeometry,
	Quaternion,
	RingGeometry,
	type Scene,
	Vector3,
} from "three/webgpu";
import { MAX_DEBRIS, MAX_SHELLS } from "../constants.ts";
import { KIND, SHELL_TICKS, TOWER } from "../defs.ts";
import { EV } from "../events.ts";
import {
	D_STRIDE,
	E_STRIDE,
	H,
	OFF_DEBRIS,
	OFF_EVENTS,
	OFF_SHELLS,
	OFF_TOWERS,
	S_STRIDE,
	T_STRIDE,
} from "../snapshot.ts";

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _d = new Vector3();
const _z = new Vector3(0, 0, 1);
const _c = new Color();

function additive(): MeshBasicNodeMaterial {
	return new MeshBasicNodeMaterial({
		color: 0xffffff,
		transparent: true,
		blending: AdditiveBlending,
		depthWrite: false,
	});
}

/** A fixed pool of short-lived instanced items; oldest recycled when full. */
class Pool {
	readonly mesh: InstancedMesh;
	readonly cap: number;
	n = 0;
	cursor = 0;
	readonly age: Float32Array;
	readonly life: Float32Array;
	readonly a: Float32Array; // 6 floats: two points or pos + velocity
	readonly w: Float32Array;
	readonly col: Float32Array;

	constructor(scene: Scene, geo: BufferGeometry, cap: number) {
		this.cap = cap;
		this.mesh = new InstancedMesh(geo, additive(), cap);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.setColorAt(0, _c.setRGB(1, 1, 1));
		this.mesh.instanceColor?.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.count = 0;
		scene.add(this.mesh);
		this.age = new Float32Array(cap);
		this.life = new Float32Array(cap);
		this.a = new Float32Array(cap * 6);
		this.w = new Float32Array(cap);
		this.col = new Float32Array(cap * 3);
	}

	alloc(): number {
		if (this.n < this.cap) return this.n++;
		const i = this.cursor;
		this.cursor = (this.cursor + 1) % this.cap;
		return i;
	}

	set(
		i: number,
		life: number,
		w: number,
		r: number,
		g: number,
		b: number,
	): void {
		this.age[i] = 0;
		this.life[i] = life;
		this.w[i] = w;
		this.col[i * 3] = r;
		this.col[i * 3 + 1] = g;
		this.col[i * 3 + 2] = b;
	}

	/** Drops dead items (swap-remove). Returns nothing; call before drawing. */
	age_(dt: number): void {
		let i = 0;
		while (i < this.n) {
			this.age[i] = (this.age[i] as number) + dt;
			if ((this.age[i] as number) < (this.life[i] as number)) {
				i++;
				continue;
			}
			const j = --this.n;
			if (i !== j) {
				this.age[i] = this.age[j] as number;
				this.life[i] = this.life[j] as number;
				this.w[i] = this.w[j] as number;
				for (let k = 0; k < 6; k++)
					this.a[i * 6 + k] = this.a[j * 6 + k] as number;
				for (let k = 0; k < 3; k++)
					this.col[i * 3 + k] = this.col[j * 3 + k] as number;
			}
		}
		if (this.cursor >= this.n) this.cursor = 0;
	}

	commit(count: number): void {
		this.mesh.count = count;
		// Upload only what is drawn (fewer buffer writes per frame, notably on WebGL).
		if (count === 0) return;
		const im = this.mesh.instanceMatrix;
		im.clearUpdateRanges();
		im.addUpdateRange(0, count * 16);
		im.needsUpdate = true;
		const ic = this.mesh.instanceColor;
		if (ic) {
			ic.clearUpdateRanges();
			ic.addUpdateRange(0, count * 3);
			ic.needsUpdate = true;
		}
	}
}

/**
 * Every effect: bolts and lance beams (stretched additive boxes), shock rings, sparks,
 * mortar shells in flight and the engine-simulated debris shards. Driven by snapshot events
 * and state; HDR colours above 1 feed the bloom pass.
 */
export class Fx {
	private readonly beams: Pool;
	private readonly rings: Pool;
	private readonly sparks: Pool;
	private readonly flashes: Pool;
	private readonly shells: InstancedMesh;
	private readonly debris: InstancedMesh;
	private budget = 0;
	/** Camera shake request (consumed by the camera). */
	shake = 0;

	constructor(scene: Scene) {
		this.beams = new Pool(scene, new BoxGeometry(1, 1, 1), 700);
		const rg = new RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2);
		this.rings = new Pool(scene, rg, 260);
		this.sparks = new Pool(scene, new OctahedronGeometry(0.1, 0), 5000);
		this.flashes = new Pool(scene, new IcosahedronGeometry(1, 1), 120);
		this.shells = new InstancedMesh(
			new IcosahedronGeometry(0.28, 1),
			additive(),
			MAX_SHELLS,
		);
		this.shells.instanceMatrix.setUsage(DynamicDrawUsage);
		this.shells.setColorAt(0, _c.setRGB(4, 1.8, 0.5));
		for (let i = 1; i < MAX_SHELLS; i++) this.shells.setColorAt(i, _c);
		this.shells.frustumCulled = false;
		this.shells.count = 0;
		scene.add(this.shells);
		this.debris = new InstancedMesh(
			new OctahedronGeometry(0.24, 0).scale(0.8, 0.55, 1.2),
			new MeshStandardNodeMaterial({
				color: 0x2a0e16,
				emissive: new Color(0xff3070),
				emissiveIntensity: 1.6,
				roughness: 0.3,
				metalness: 0.4,
				flatShading: true,
			}),
			MAX_DEBRIS,
		);
		this.debris.instanceMatrix.setUsage(DynamicDrawUsage);
		this.debris.frustumCulled = false;
		this.debris.castShadow = true;
		this.debris.count = 0;
		scene.add(this.debris);
	}

	private beam(
		x0: number,
		y0: number,
		z0: number,
		x1: number,
		y1: number,
		z1: number,
		w: number,
		life: number,
		r: number,
		g: number,
		b: number,
	): void {
		const p = this.beams;
		const i = p.alloc();
		p.set(i, life, w, r, g, b);
		const a = p.a;
		a[i * 6] = x0;
		a[i * 6 + 1] = y0;
		a[i * 6 + 2] = z0;
		a[i * 6 + 3] = x1;
		a[i * 6 + 4] = y1;
		a[i * 6 + 5] = z1;
	}

	ring(
		x: number,
		z: number,
		r: number,
		life: number,
		cr: number,
		cg: number,
		cb: number,
	): void {
		const p = this.rings;
		const i = p.alloc();
		p.set(i, life, r, cr, cg, cb);
		p.a[i * 6] = x;
		p.a[i * 6 + 1] = 0.08;
		p.a[i * 6 + 2] = z;
	}

	private flash(
		x: number,
		y: number,
		z: number,
		r: number,
		life: number,
		cr: number,
		cg: number,
		cb: number,
	): void {
		const p = this.flashes;
		const i = p.alloc();
		p.set(i, life, r, cr, cg, cb);
		p.a[i * 6] = x;
		p.a[i * 6 + 1] = y;
		p.a[i * 6 + 2] = z;
	}

	/** `n` sparks from (x, y, z), speed `v`, seeded by position (deterministic look, no Math.random). */
	sparksAt(
		x: number,
		y: number,
		z: number,
		n: number,
		v: number,
		up: number,
		life: number,
		r: number,
		g: number,
		b: number,
	): void {
		const p = this.sparks;
		let h =
			(Math.floor(x * 131) ^ Math.floor(z * 977) ^ (this.budget * 7919)) >>> 0;
		for (let k = 0; k < n; k++) {
			h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
			const a = (h / 4294967296) * Math.PI * 2;
			h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
			const s = v * (0.35 + 0.65 * (h / 4294967296));
			const i = p.alloc();
			p.set(i, life * (0.6 + 0.4 * (h / 4294967296)), 1, r, g, b);
			const q = p.a;
			q[i * 6] = x;
			q[i * 6 + 1] = y;
			q[i * 6 + 2] = z;
			q[i * 6 + 3] = Math.cos(a) * s;
			q[i * 6 + 4] = up * (0.5 + (h & 255) / 255);
			q[i * 6 + 5] = Math.sin(a) * s;
		}
		this.budget++;
	}

	/** Spawns the effects of one snapshot's events. */
	handle(snap: Float32Array): void {
		const n = snap[H.EVENTS] as number;
		let killFx = 0;
		for (let e = 0; e < n; e++) {
			const o = OFF_EVENTS + e * E_STRIDE;
			const t = snap[o] as number;
			const a = snap[o + 1] as number;
			const x = snap[o + 2] as number;
			const z = snap[o + 3] as number;
			const x2 = snap[o + 4] as number;
			const z2 = snap[o + 5] as number;
			switch (t) {
				case EV.ZAP: {
					const lv = snap[OFF_TOWERS + a * T_STRIDE + 1] as number;
					const top = 2.1 + 0.2 * (lv - 1);
					// A two-segment bolt with a kink, for a crackle.
					const mx = (x + x2) * 0.5 + (((e * 37) % 7) - 3) * 0.12;
					const mz = (z + z2) * 0.5 + (((e * 53) % 7) - 3) * 0.12;
					this.beam(x, top, z, mx, 1.2, mz, 0.07, 0.09, 1.2, 4, 6);
					this.beam(mx, 1.2, mz, x2, 0.35, z2, 0.07, 0.09, 1.2, 4, 6);
					this.flash(x2, 0.35, z2, 0.35, 0.1, 1, 3, 4);
					break;
				}
				case EV.LANCE: {
					this.beam(x, 2.45, z, x2, 0.5, z2, 0.42, 0.42, 3.5, 1.6, 6);
					this.beam(x, 2.45, z, x2, 0.5, z2, 0.14, 0.5, 6, 5, 8);
					this.flash(x, 2.45, z, 0.7, 0.18, 3, 1.5, 6);
					this.shake = Math.max(this.shake, 0.12);
					break;
				}
				case EV.SHELL:
					this.flash(x, 1.6, z, 0.5, 0.12, 4, 2, 0.6);
					break;
				case EV.BOOM: {
					const r = a / 100;
					this.ring(x, z, r * 1.15, 0.45, 5, 2.2, 0.6);
					this.flash(x, 0.6, z, r * 0.8, 0.22, 5, 2.4, 0.8);
					this.sparksAt(x, 0.4, z, 14, 7, 6, 0.7, 4, 1.6, 0.4);
					this.shake = Math.max(this.shake, 0.18);
					break;
				}
				case EV.PULSE:
					this.ring(x, z, x2, 0.55, 0.6, 1.6, 3.2);
					break;
				case EV.KILL: {
					if (a === KIND.MITE) {
						if (killFx++ > 60) break;
						this.sparksAt(x, 0.3, z, 3, 3, 3.5, 0.45, 3, 0.5, 1.6);
					} else if (a === KIND.GLIDER) {
						this.sparksAt(x, 1, z, 10, 5, 4, 0.6, 4, 1.8, 0.4);
						this.flash(x, 1, z, 0.7, 0.15, 4, 2, 0.6);
					} else {
						this.sparksAt(x, 1, z, 40, 9, 8, 1.0, 5, 0.8, 0.5);
						this.ring(x, z, 4, 0.6, 5, 0.6, 0.6);
						this.flash(x, 1, z, 1.8, 0.25, 6, 1.5, 1);
						this.shake = Math.max(this.shake, 0.35);
					}
					break;
				}
				case EV.LEAK:
					this.flash(x, 1, z, 1.2, 0.2, 6, 0.6, 0.4);
					this.shake = Math.max(this.shake, 0.08 + a * 0.03);
					break;
				case EV.PLACE:
					this.ring(x, z, 2.2, 0.5, 1, 3, 3.5);
					this.sparksAt(x, 0.3, z, 18, 3, 5, 0.7, 1.2, 3, 4);
					break;
				case EV.UPGRADE:
					this.ring(x, z, 2.6, 0.6, 3, 2.6, 1);
					this.sparksAt(x, 1, z, 24, 2.5, 7, 0.9, 3, 2.4, 0.8);
					break;
				case EV.SELL:
					this.ring(x, z, 1.8, 0.4, 2.5, 2, 0.6);
					break;
				case EV.DENY:
					this.ring(x, z, 1.2, 0.3, 4, 0.3, 0.2);
					break;
				case EV.LOST:
					this.ring(x, z, 14, 1.4, 6, 1, 3);
					this.flash(x, 4, z, 6, 0.6, 8, 2, 4);
					this.sparksAt(x, 4, z, 160, 14, 12, 1.6, 4, 1.2, 3);
					this.shake = 1;
					break;
				case EV.WON:
					for (let k = 0; k < 4; k++)
						this.ring(x, z, 10 + k * 8, 1 + k * 0.4, 0.6, 2.5, 3.5);
					this.sparksAt(x, 4.5, z, 120, 6, 14, 2, 1, 3, 4);
					break;
			}
		}
	}

	update(
		dt: number,
		snap: Float32Array,
		prev: Float32Array,
		alpha: number,
	): void {
		this.shake = Math.max(0, this.shake - dt * 2.5);
		// beams
		{
			const p = this.beams;
			p.age_(dt);
			const m = p.mesh;
			for (let i = 0; i < p.n; i++) {
				const a = p.a;
				const k = 1 - (p.age[i] as number) / (p.life[i] as number);
				_p.set(
					((a[i * 6] as number) + (a[i * 6 + 3] as number)) * 0.5,
					((a[i * 6 + 1] as number) + (a[i * 6 + 4] as number)) * 0.5,
					((a[i * 6 + 2] as number) + (a[i * 6 + 5] as number)) * 0.5,
				);
				_d.set(
					(a[i * 6 + 3] as number) - (a[i * 6] as number),
					(a[i * 6 + 4] as number) - (a[i * 6 + 1] as number),
					(a[i * 6 + 5] as number) - (a[i * 6 + 2] as number),
				);
				const len = _d.length() || 1;
				_q.setFromUnitVectors(_z, _d.multiplyScalar(1 / len));
				const w = (p.w[i] as number) * (0.3 + 0.7 * k);
				_s.set(w, w, len);
				m.setMatrixAt(i, _m.compose(_p, _q, _s));
				m.setColorAt(
					i,
					_c.setRGB(
						(p.col[i * 3] as number) * k,
						(p.col[i * 3 + 1] as number) * k,
						(p.col[i * 3 + 2] as number) * k,
					),
				);
			}
			p.commit(p.n);
		}
		// rings
		{
			const p = this.rings;
			p.age_(dt);
			const m = p.mesh;
			_q.identity();
			for (let i = 0; i < p.n; i++) {
				const u = (p.age[i] as number) / (p.life[i] as number);
				const r = (p.w[i] as number) * (0.25 + 0.75 * Math.sqrt(u));
				const k = (1 - u) * (1 - u);
				_p.set(
					p.a[i * 6] as number,
					p.a[i * 6 + 1] as number,
					p.a[i * 6 + 2] as number,
				);
				_s.set(r, 1, r);
				m.setMatrixAt(i, _m.compose(_p, _q, _s));
				m.setColorAt(
					i,
					_c.setRGB(
						(p.col[i * 3] as number) * k,
						(p.col[i * 3 + 1] as number) * k,
						(p.col[i * 3 + 2] as number) * k,
					),
				);
			}
			p.commit(p.n);
		}
		// flashes
		{
			const p = this.flashes;
			p.age_(dt);
			const m = p.mesh;
			_q.identity();
			for (let i = 0; i < p.n; i++) {
				const u = (p.age[i] as number) / (p.life[i] as number);
				const r = (p.w[i] as number) * (0.6 + 0.6 * u);
				const k = (1 - u) * (1 - u) * 0.6;
				_p.set(
					p.a[i * 6] as number,
					p.a[i * 6 + 1] as number,
					p.a[i * 6 + 2] as number,
				);
				_s.set(r, r, r);
				m.setMatrixAt(i, _m.compose(_p, _q, _s));
				m.setColorAt(
					i,
					_c.setRGB(
						(p.col[i * 3] as number) * k,
						(p.col[i * 3 + 1] as number) * k,
						(p.col[i * 3 + 2] as number) * k,
					),
				);
			}
			p.commit(p.n);
		}
		// sparks
		{
			const p = this.sparks;
			p.age_(dt);
			const m = p.mesh;
			const e = m.instanceMatrix.array as Float32Array;
			const cc = m.instanceColor?.array as Float32Array;
			const damp = Math.exp(-2.2 * dt);
			for (let i = 0; i < p.n; i++) {
				const a = p.a;
				const b = i * 6;
				a[b + 3] = (a[b + 3] as number) * damp;
				a[b + 5] = (a[b + 5] as number) * damp;
				a[b + 4] = (a[b + 4] as number) - 14 * dt;
				a[b] = (a[b] as number) + (a[b + 3] as number) * dt;
				let y = (a[b + 1] as number) + (a[b + 4] as number) * dt;
				if (y < 0.05) {
					y = 0.05;
					a[b + 4] = -(a[b + 4] as number) * 0.35;
				}
				a[b + 1] = y;
				a[b + 2] = (a[b + 2] as number) + (a[b + 5] as number) * dt;
				const u = (p.age[i] as number) / (p.life[i] as number);
				const s = 1 - u;
				const o = i * 16;
				e[o] = s;
				e[o + 1] = 0;
				e[o + 2] = 0;
				e[o + 3] = 0;
				e[o + 4] = 0;
				e[o + 5] = s * 1.6;
				e[o + 6] = 0;
				e[o + 7] = 0;
				e[o + 8] = 0;
				e[o + 9] = 0;
				e[o + 10] = s;
				e[o + 11] = 0;
				e[o + 12] = a[b] as number;
				e[o + 13] = y;
				e[o + 14] = a[b + 2] as number;
				e[o + 15] = 1;
				cc[i * 3] = (p.col[i * 3] as number) * s;
				cc[i * 3 + 1] = (p.col[i * 3 + 1] as number) * s;
				cc[i * 3 + 2] = (p.col[i * 3 + 2] as number) * s;
			}
			p.commit(p.n);
		}
		// shells in flight: a parabola from tower to landing point
		{
			const n = snap[H.SHELLS] as number;
			const m = this.shells;
			_q.identity();
			for (let s = 0; s < n; s++) {
				const o = OFF_SHELLS + s * S_STRIDE;
				const u = Math.min(1, (snap[o + 4] as number) + alpha / SHELL_TICKS);
				const x =
					(snap[o] as number) +
					((snap[o + 2] as number) - (snap[o] as number)) * u;
				const z =
					(snap[o + 1] as number) +
					((snap[o + 3] as number) - (snap[o + 1] as number)) * u;
				const y = 1.6 + 7 * u * (1 - u) * 4 * 0.5 - 1.4 * u;
				_p.set(x, y, z);
				_s.set(1, 1, 1);
				m.setMatrixAt(s, _m.compose(_p, _q, _s));
				if ((this.budget & 1) === 0)
					this.sparksAt(x, y, z, 1, 0.3, 0.5, 0.35, 3, 1.2, 0.3);
			}
			m.count = n;
			if (n > 0) m.instanceMatrix.needsUpdate = true;
		}
		// debris shards: engine rigid bodies, interpolated
		{
			const n = snap[H.DEBRIS] as number;
			const pn = prev[H.DEBRIS] as number;
			const m = this.debris;
			for (let d = 0; d < n; d++) {
				const o = OFF_DEBRIS + d * D_STRIDE;
				_p.set(snap[o] as number, snap[o + 1] as number, snap[o + 2] as number);
				_q.set(
					snap[o + 3] as number,
					snap[o + 4] as number,
					snap[o + 5] as number,
					snap[o + 6] as number,
				);
				if (
					d < pn &&
					Math.abs((prev[o] as number) - _p.x) < 1 &&
					Math.abs((prev[o + 2] as number) - _p.z) < 1
				) {
					_d.set(
						prev[o] as number,
						prev[o + 1] as number,
						prev[o + 2] as number,
					);
					_p.lerpVectors(_d, _p, alpha);
				}
				_s.set(1, 1, 1);
				m.setMatrixAt(d, _m.compose(_p, _q, _s));
			}
			m.count = n;
			if (n > 0) m.instanceMatrix.needsUpdate = true;
		}
		void TOWER;
	}

	get sparkCount(): number {
		return this.sparks.n;
	}
}
