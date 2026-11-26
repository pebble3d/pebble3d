import {
	BufferAttribute,
	BufferGeometry,
	DynamicDrawUsage,
	type Material,
	Mesh,
	Vector3,
} from "three/webgpu";

/** A sphere the cloth stays out of (world space, updated by the owner each frame). */
export interface ClothCollider {
	center: Vector3;
	radius: number;
}

export interface RibbonOptions {
	/** Particles after the pinned root. */
	segments: number;
	/** Rest length, metres. */
	length: number;
	/** Width at the root and at the tip, metres. */
	width: number;
	tipWidth: number;
	/** Downward acceleration, m/s^2 (cloth: a bit under g, for a floaty fall). */
	gravity: number;
	/** Velocity kept per 1/120 s step (0..1). */
	damping: number;
	/** Pull of the first particles toward the root direction (0 = hinge, 1 = rigid). */
	rootStiffness: number;
	/** Sideways flutter, m/s^2, and its frequency, Hz. */
	flutter: number;
	flutterHz: number;
}

/** Target sub-step; a frame runs ceil(dt / STEP) equal sub-steps (at most MAX_STEPS). */
const STEP = 1 / 120;
const MAX_STEPS = 4;
const ITERATIONS = 4;
/**
 * Anchor jumps beyond max(TELEPORT, TELEPORT_SPEED * dt) in one frame (respawn, lab reset)
 * snap the ribbon instead of whipping it; real motion (a 13 m/s dash) stays under it at any
 * frame rate.
 */
const TELEPORT = 0.6;
const TELEPORT_SPEED = 30;
/** Particle speed cap, m/s: no whip-cracks from fast anchor motion. */
const MAX_SPEED = 12;
/** Sub-steps run on reset (0.75 s) so the cloth starts at rest. */
const SETTLE = 90;

const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _side = new Vector3();
const _n = new Vector3();

/**
 * A cloth tail (headband tail, sash end, sword cord): a verlet chain pinned at a moving
 * anchor, drawn as a tapered double-sided strip in world space. The anchor supplies its
 * position, the strip's width axis and the root direction every frame. `update` does not
 * allocate. Presentation only: it never feeds the sim.
 */
export class Ribbon {
	readonly mesh: Mesh;
	private readonly o: RibbonOptions;
	private readonly n: number;
	private readonly seg: number;
	private readonly pos: Float32Array;
	private readonly prev: Float32Array;
	private readonly vpos: Float32Array;
	private readonly vnrm: Float32Array;
	private readonly geo: BufferGeometry;
	private readonly anchor = new Vector3();
	private readonly side = new Vector3(1, 0, 0);
	private readonly rootDir = new Vector3(0, -1, 0);
	private time = 0;
	/** Length of the previous sub-step (verlet velocity rescale when it changes). */
	private hPrev = STEP;
	private phase: number;
	private live = false;
	colliders: ClothCollider[] = [];

	constructor(material: Material, o: RibbonOptions, phase = 0) {
		this.o = o;
		this.n = o.segments + 1;
		this.seg = o.length / o.segments;
		this.phase = phase;
		this.pos = new Float32Array(this.n * 3);
		this.prev = new Float32Array(this.n * 3);
		this.vpos = new Float32Array(this.n * 2 * 3);
		this.vnrm = new Float32Array(this.n * 2 * 3);
		const uv = new Float32Array(this.n * 2 * 2);
		const idx: number[] = [];
		for (let i = 0; i < this.n; i++) {
			const v = i / (this.n - 1);
			uv.set([0, v, 1, v], i * 4);
			if (i < this.n - 1) {
				const a = i * 2;
				idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
			}
		}
		const g = new BufferGeometry();
		const pa = new BufferAttribute(this.vpos, 3).setUsage(DynamicDrawUsage);
		const na = new BufferAttribute(this.vnrm, 3).setUsage(DynamicDrawUsage);
		g.setAttribute("position", pa);
		g.setAttribute("normal", na);
		g.setAttribute("uv", new BufferAttribute(uv, 2));
		g.setIndex(idx);
		this.geo = g;
		this.mesh = new Mesh(g, material);
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = true;
		this.mesh.matrixAutoUpdate = false;
	}

	/**
	 * Lays the chain out from `anchor` (along `dir`, bent toward the ground) and lets it
	 * settle for SETTLE steps with the anchor still, so it starts hanging, not sticking out.
	 */
	reset(anchor: Vector3, dir: Vector3): void {
		_side.copy(dir).multiplyScalar(0.5);
		_side.y -= 1;
		_side.normalize();
		for (let i = 0; i < this.n; i++) {
			_a.copy(anchor).addScaledVector(_side, i * this.seg);
			_a.toArray(this.pos, i * 3);
			_a.toArray(this.prev, i * 3);
		}
		this.anchor.copy(anchor);
		this.rootDir.copy(dir);
		this.live = true;
		this.hPrev = STEP;
		for (let s = 0; s < SETTLE; s++) this.step(STEP);
	}

	/**
	 * Steps the cloth toward the anchor's new pose. `side` is the strip's width axis and
	 * `dir` the direction the root leaves the anchor (both world, unit).
	 */
	update(dt: number, anchor: Vector3, side: Vector3, dir: Vector3): void {
		const jump = Math.max(TELEPORT, TELEPORT_SPEED * dt);
		if (!this.live || anchor.distanceTo(this.anchor) > jump)
			this.reset(anchor, dir);
		this.side.copy(side);
		this.rootDir.copy(dir);
		if (dt > 0) {
			// Equal sub-steps cover the whole frame (no zero-step frames at high refresh
			// rates); the anchor moves linearly across them.
			const steps = Math.min(MAX_STEPS, Math.ceil(dt / STEP - 1e-6));
			const h = Math.min(dt, STEP * MAX_STEPS) / steps;
			_b.copy(this.anchor);
			for (let s = 1; s <= steps; s++) {
				this.anchor.lerpVectors(_b, anchor, s / steps);
				this.step(h);
			}
		} else {
			// Paused (dt 0) but the anchor may still move: pin it and satisfy the lengths.
			this.anchor.copy(anchor);
			this.constrain();
		}
		this.pos[0] = anchor.x;
		this.pos[1] = anchor.y;
		this.pos[2] = anchor.z;
		this.build();
	}

	private step(h: number): void {
		const o = this.o;
		const p = this.pos;
		const q = this.prev;
		this.time += h;
		// damping is authored per 1/120 s; velocity rescaled if the step length changed
		const keep = o.damping ** (h / STEP) * (h / this.hPrev);
		const maxMove = MAX_SPEED * h;
		this.hPrev = h;
		const fl =
			o.flutter *
			Math.sin((this.time * o.flutterHz + this.phase) * Math.PI * 2);
		const dt2 = h * h;
		for (let i = 1; i < this.n; i++) {
			const k = i * 3;
			const w = i / (this.n - 1);
			for (let c = 0; c < 3; c++) {
				const x = p[k + c] as number;
				let v = (x - (q[k + c] as number)) * keep;
				if (v > maxMove) v = maxMove;
				else if (v < -maxMove) v = -maxMove;
				q[k + c] = x;
				let acc = c === 1 ? -o.gravity : 0;
				acc += fl * w * (this.side.getComponent(c) * 0.7);
				p[k + c] = x + v + acc * dt2;
			}
		}
		p[0] = this.anchor.x;
		p[1] = this.anchor.y;
		p[2] = this.anchor.z;
		// root direction: the first particle leans toward the knot's outward direction
		_a.copy(this.anchor).addScaledVector(this.rootDir, this.seg);
		const kk = o.rootStiffness;
		p[3] = (p[3] as number) + (_a.x - (p[3] as number)) * kk;
		p[4] = (p[4] as number) + (_a.y - (p[4] as number)) * kk;
		p[5] = (p[5] as number) + (_a.z - (p[5] as number)) * kk;
		this.constrain();
	}

	/** Lengths and colliders, with the root pinned at the anchor. */
	private constrain(): void {
		const p = this.pos;
		p[0] = this.anchor.x;
		p[1] = this.anchor.y;
		p[2] = this.anchor.z;
		for (let it = 0; it < ITERATIONS; it++) {
			for (let i = 1; i < this.n; i++) {
				const a = (i - 1) * 3;
				const b = i * 3;
				_d.set(
					(p[b] as number) - (p[a] as number),
					(p[b + 1] as number) - (p[a + 1] as number),
					(p[b + 2] as number) - (p[a + 2] as number),
				);
				const len = _d.length() || 1e-6;
				const corr = (len - this.seg) / len;
				// the root end is pinned: its child takes the whole correction
				const wa = i === 1 ? 0 : 0.5;
				const wb = i === 1 ? 1 : 0.5;
				p[a] = (p[a] as number) + _d.x * corr * wa;
				p[a + 1] = (p[a + 1] as number) + _d.y * corr * wa;
				p[a + 2] = (p[a + 2] as number) + _d.z * corr * wa;
				p[b] = (p[b] as number) - _d.x * corr * wb;
				p[b + 1] = (p[b + 1] as number) - _d.y * corr * wb;
				p[b + 2] = (p[b + 2] as number) - _d.z * corr * wb;
			}
			for (const col of this.colliders) {
				const r = col.radius;
				for (let i = 1; i < this.n; i++) {
					const k = i * 3;
					_d.set(
						(p[k] as number) - col.center.x,
						(p[k + 1] as number) - col.center.y,
						(p[k + 2] as number) - col.center.z,
					);
					const l2 = _d.lengthSq();
					if (l2 >= r * r || l2 < 1e-10) continue;
					_d.multiplyScalar(r / Math.sqrt(l2));
					p[k] = col.center.x + _d.x;
					p[k + 1] = col.center.y + _d.y;
					p[k + 2] = col.center.z + _d.z;
				}
			}
		}
		// Follow-the-leader pass: no segment ends longer than its rest length (the relaxation
		// above is soft against a fast-moving root).
		for (let i = 1; i < this.n; i++) {
			const a = (i - 1) * 3;
			const b = i * 3;
			_d.set(
				(p[b] as number) - (p[a] as number),
				(p[b + 1] as number) - (p[a + 1] as number),
				(p[b + 2] as number) - (p[a + 2] as number),
			);
			const len = _d.length();
			if (len <= this.seg) continue;
			const k = this.seg / len;
			p[b] = (p[a] as number) + _d.x * k;
			p[b + 1] = (p[a + 1] as number) + _d.y * k;
			p[b + 2] = (p[a + 2] as number) + _d.z * k;
		}
	}

	/** Strip vertices: each particle +/- half the (tapered) width along the side axis. */
	private build(): void {
		const o = this.o;
		const p = this.pos;
		for (let i = 0; i < this.n; i++) {
			const k = i * 3;
			const j = Math.min(i + 1, this.n - 1);
			const h = Math.max(i - 1, 0);
			_d.set(
				(p[j * 3] as number) - (p[h * 3] as number),
				(p[j * 3 + 1] as number) - (p[h * 3 + 1] as number),
				(p[j * 3 + 2] as number) - (p[h * 3 + 2] as number),
			).normalize();
			_side.copy(this.side).addScaledVector(_d, -this.side.dot(_d));
			if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
			_side.normalize();
			_n.crossVectors(_side, _d).normalize();
			const t = i / (this.n - 1);
			const half = (o.width + (o.tipWidth - o.width) * t) / 2;
			const v = i * 6;
			for (let c = 0; c < 3; c++) {
				const x = p[k + c] as number;
				const sc = _side.getComponent(c) * half;
				this.vpos[v + c] = x - sc;
				this.vpos[v + 3 + c] = x + sc;
				this.vnrm[v + c] = _n.getComponent(c);
				this.vnrm[v + 3 + c] = _n.getComponent(c);
			}
		}
		(this.geo.getAttribute("position") as BufferAttribute).needsUpdate = true;
		(this.geo.getAttribute("normal") as BufferAttribute).needsUpdate = true;
	}
}
