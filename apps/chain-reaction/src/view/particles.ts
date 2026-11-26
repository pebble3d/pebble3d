import {
	BoxGeometry,
	Color,
	DynamicDrawUsage,
	InstancedMesh,
	Matrix4,
	MeshStandardNodeMaterial,
	Quaternion,
	type Scene,
	Vector3,
} from "three/webgpu";

/**
 * Pooled particles in one InstancedMesh: small sparks on impacts and a confetti burst when
 * the ball lands in the cup. Fixed-size state arrays; nothing allocates per frame.
 */
const CAP = 220;
const GRAVITY = -9;

const CONFETTI = ["#3dffc8", "#ffc94a", "#ff5a7a", "#7db6ff", "#f3eee2"].map(
	(c) => new Color(c),
);
const SPARK = new Color("#fff2d6");

export class Particles {
	private readonly mesh: InstancedMesh;
	private readonly pos = new Float32Array(CAP * 3);
	private readonly vel = new Float32Array(CAP * 3);
	private readonly spin = new Float32Array(CAP * 3);
	private readonly life = new Float32Array(CAP);
	private readonly max = new Float32Array(CAP);
	private readonly size = new Float32Array(CAP);
	private next = 0;
	/** Deterministic jitter (no Math.random, so fixed-mode captures repeat exactly). */
	private seed = 1;
	private readonly m = new Matrix4();
	private readonly q = new Quaternion();
	private readonly p = new Vector3();
	private readonly s = new Vector3();
	private readonly e = new Vector3();

	constructor(scene: Scene) {
		const mat = new MeshStandardNodeMaterial({
			roughness: 0.4,
			metalness: 0.1,
		});
		this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 0.2), mat, CAP);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		const zero = new Matrix4().makeScale(0, 0, 0);
		for (let i = 0; i < CAP; i++) {
			this.mesh.setMatrixAt(i, zero);
			this.mesh.setColorAt(i, SPARK);
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
		vx: number,
		vy: number,
		life: number,
		size: number,
		color: Color,
	): void {
		const i = this.next;
		this.next = (this.next + 1) % CAP;
		this.pos[i * 3] = x;
		this.pos[i * 3 + 1] = y;
		this.pos[i * 3 + 2] = (this.rnd() - 0.5) * 0.6;
		this.vel[i * 3] = vx;
		this.vel[i * 3 + 1] = vy;
		this.vel[i * 3 + 2] = (this.rnd() - 0.5) * 1.5;
		for (let k = 0; k < 3; k++) this.spin[i * 3 + k] = (this.rnd() - 0.5) * 18;
		this.life[i] = life;
		this.max[i] = life;
		this.size[i] = size;
		this.mesh.setColorAt(i, color);
	}

	/** Sparks where something hit hard. */
	impact(x: number, y: number, strength: number): void {
		const n = Math.min(10, 2 + Math.floor(strength * 1.5));
		for (let k = 0; k < n; k++) {
			const a = this.rnd() * Math.PI * 2;
			const sp = 0.8 + this.rnd() * (1 + strength * 0.4);
			this.emit(
				x,
				y,
				Math.cos(a) * sp,
				Math.abs(Math.sin(a)) * sp + 0.5,
				0.35,
				0.035,
				SPARK,
			);
		}
		this.flush();
	}

	/** Confetti fountain from the cup. */
	confetti(x: number, y: number): void {
		for (let k = 0; k < 90; k++) {
			const a = (this.rnd() - 0.5) * 1.3;
			const sp = 4 + this.rnd() * 4;
			this.emit(
				x,
				y,
				Math.sin(a) * sp,
				Math.cos(a) * sp,
				1.6 + this.rnd() * 0.8,
				0.07 + this.rnd() * 0.05,
				CONFETTI[k % CONFETTI.length] as Color,
			);
		}
		this.flush();
	}

	clear(): void {
		this.life.fill(0);
	}

	private flush(): void {
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	update(dt: number): void {
		for (let i = 0; i < CAP; i++) {
			const l = this.life[i] as number;
			if (l <= 0) {
				if (l > -1) {
					// Hide once, then leave it.
					this.life[i] = -1;
					this.m.makeScale(0, 0, 0);
					this.mesh.setMatrixAt(i, this.m);
				}
				continue;
			}
			this.life[i] = l - dt;
			const o = i * 3;
			const drag = Math.exp(-dt * 1.6);
			this.vel[o] = (this.vel[o] as number) * drag;
			this.vel[o + 1] = (this.vel[o + 1] as number) * drag + GRAVITY * dt;
			this.vel[o + 2] = (this.vel[o + 2] as number) * drag;
			this.pos[o] = (this.pos[o] as number) + (this.vel[o] as number) * dt;
			this.pos[o + 1] = Math.max(
				0.02,
				(this.pos[o + 1] as number) + (this.vel[o + 1] as number) * dt,
			);
			this.pos[o + 2] =
				(this.pos[o + 2] as number) + (this.vel[o + 2] as number) * dt;
			const t = 1 - l / (this.max[i] as number);
			const sz = (this.size[i] as number) * (t < 0.8 ? 1 : (1 - t) / 0.2);
			this.e.set(
				(this.spin[o] as number) * t,
				(this.spin[o + 1] as number) * t,
				(this.spin[o + 2] as number) * t,
			);
			this.q.setFromAxisAngle(this.e.normalize(), (this.spin[o] as number) * t);
			this.p.set(
				this.pos[o] as number,
				this.pos[o + 1] as number,
				this.pos[o + 2] as number,
			);
			this.s.set(sz, sz, sz);
			this.m.compose(this.p, this.q, this.s);
			this.mesh.setMatrixAt(i, this.m);
		}
		this.mesh.instanceMatrix.needsUpdate = true;
	}
}
