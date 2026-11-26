import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	DynamicDrawUsage,
	Mesh,
	MeshBasicNodeMaterial,
	type Scene,
} from "three/webgpu";

/**
 * A light trail: a flat ribbon through the last N positions, laid along the drone's right axis,
 * fading from the head to the tail. Additive and unlit so it blooms. Preallocated ring buffer:
 * `push` and `rebuild` allocate nothing.
 */
export class Trail {
	readonly mesh: Mesh;
	private readonly n: number;
	private readonly p: Float32Array;
	private readonly s: Float32Array;
	private head = 0;
	private count = 0;
	private readonly pos: Float32Array;
	private readonly col: Float32Array;
	private readonly posAttr: BufferAttribute;
	private readonly colAttr: BufferAttribute;
	private readonly tint: Color;
	strength = 1;

	private readonly width: number;

	constructor(scene: Scene, color: string, n = 48, width = 0.05) {
		this.width = width;
		this.n = n;
		this.p = new Float32Array(n * 3);
		this.s = new Float32Array(n * 3);
		this.pos = new Float32Array(n * 2 * 3);
		this.col = new Float32Array(n * 2 * 3);
		this.tint = new Color(color);
		const g = new BufferGeometry();
		this.posAttr = new BufferAttribute(this.pos, 3);
		this.posAttr.setUsage(DynamicDrawUsage);
		this.colAttr = new BufferAttribute(this.col, 3);
		this.colAttr.setUsage(DynamicDrawUsage);
		g.setAttribute("position", this.posAttr);
		g.setAttribute("color", this.colAttr);
		const idx: number[] = [];
		for (let i = 0; i < n - 1; i++) {
			const a = i * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		g.setIndex(idx);
		const m = new MeshBasicNodeMaterial({
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			side: DoubleSide,
		});
		this.mesh = new Mesh(g, m);
		this.mesh.frustumCulled = false;
		scene.add(this.mesh);
	}

	clear(): void {
		this.count = 0;
	}

	/** Adds a point with the ribbon's sideways axis (unit). */
	push(
		x: number,
		y: number,
		z: number,
		sx: number,
		sy: number,
		sz: number,
	): void {
		const o = this.head * 3;
		this.p[o] = x;
		this.p[o + 1] = y;
		this.p[o + 2] = z;
		this.s[o] = sx;
		this.s[o + 1] = sy;
		this.s[o + 2] = sz;
		this.head = (this.head + 1) % this.n;
		if (this.count < this.n) this.count++;
	}

	/** Rewrites the ribbon; `hx..hz` is the live head (interpolated drone position). */
	rebuild(hx: number, hy: number, hz: number): void {
		const n = this.n;
		const c = this.count;
		const w = this.width;
		const tr = this.tint.r * this.strength;
		const tg = this.tint.g * this.strength;
		const tb = this.tint.b * this.strength;
		for (let i = 0; i < n; i++) {
			// i = 0 is the newest
			const k =
				i < c ? (this.head - 1 - i + n * 2) % n : (this.head - c + n * 2) % n;
			const o = k * 3;
			let x = this.p[o] as number;
			let y = this.p[o + 1] as number;
			let z = this.p[o + 2] as number;
			if (i === 0 || c === 0) {
				x = hx;
				y = hy;
				z = hz;
			}
			const f = c > 1 ? Math.max(0, 1 - i / (c - 1)) : 0;
			const ww = w * (0.3 + 0.7 * f);
			const sx = (this.s[o] as number) * ww;
			const sy = (this.s[o + 1] as number) * ww;
			const sz = (this.s[o + 2] as number) * ww;
			const v = i * 6;
			this.pos[v] = x - sx;
			this.pos[v + 1] = y - sy;
			this.pos[v + 2] = z - sz;
			this.pos[v + 3] = x + sx;
			this.pos[v + 4] = y + sy;
			this.pos[v + 5] = z + sz;
			const a = f * f;
			this.col[v] = tr * a;
			this.col[v + 1] = tg * a;
			this.col[v + 2] = tb * a;
			this.col[v + 3] = tr * a;
			this.col[v + 4] = tg * a;
			this.col[v + 5] = tb * a;
		}
		this.posAttr.needsUpdate = true;
		this.colAttr.needsUpdate = true;
	}
}
