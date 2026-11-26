import {
	float,
	instancedDynamicBufferAttribute,
	mx_noise_float,
	smoothstep,
	uv,
	type vec2,
	vec3,
} from "three/tsl";
import {
	type Camera,
	Color,
	DodecahedronGeometry,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	Quaternion,
	type Scene,
	Vector3,
} from "three/webgpu";
import { Rng } from "../rng.ts";

const DUST_MAX = 700;
const CHIP_MAX = 500;
const GRAV = 9.81;

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _hidden = new Matrix4().makeScale(0, 0, 0);

/**
 * Impact VFX: billowing dust puffs (camera-facing soft quads, alpha in TSL) and stone chips
 * (small lit dodecahedrons on ballistic arcs). Fixed pools, no per-frame allocation.
 * Presentation-only: it uses its own seeded RNG, never the sim's.
 */
export class Dust {
	private readonly dust: InstancedMesh;
	private readonly chips: InstancedMesh;
	private readonly fade: InstancedBufferAttribute;
	private readonly rng = new Rng(77);
	// Dust state (SoA)
	private readonly dp = new Float32Array(DUST_MAX * 3);
	private readonly dv = new Float32Array(DUST_MAX * 3);
	private readonly dAge = new Float32Array(DUST_MAX).fill(1e9);
	private readonly dLife = new Float32Array(DUST_MAX);
	private readonly dSize = new Float32Array(DUST_MAX * 2);
	private readonly dRot = new Float32Array(DUST_MAX);
	private dNext = 0;
	// Chips
	private readonly cp = new Float32Array(CHIP_MAX * 3);
	private readonly cv = new Float32Array(CHIP_MAX * 3);
	private readonly cAge = new Float32Array(CHIP_MAX).fill(1e9);
	private readonly cSpin = new Float32Array(CHIP_MAX * 2);
	private readonly cSize = new Float32Array(CHIP_MAX);
	private cNext = 0;

	constructor(scene: Scene) {
		const geo = new PlaneGeometry(1, 1);
		this.fade = new InstancedBufferAttribute(new Float32Array(DUST_MAX * 2), 2);
		this.fade.setUsage(DynamicDrawUsage);
		const mat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
		});
		const f = instancedDynamicBufferAttribute(
			this.fade,
			"vec2",
		) as unknown as ReturnType<typeof vec2>;
		const d = uv().sub(0.5).length().mul(2);
		const n = mx_noise_float(vec3(uv().mul(3.2), f.y.mul(13.7)));
		const soft = smoothstep(1.0, 0.15, d.add(n.mul(0.35)));
		mat.opacityNode = soft.mul(f.x).mul(0.85);
		// Warm quarry dust, lighter on top as if sunlit.
		const shade = float(0.78).add(uv().y.mul(0.3)).add(n.mul(0.08));
		mat.colorNode = vec3(0.78, 0.66, 0.52).mul(shade);
		this.dust = new InstancedMesh(geo, mat, DUST_MAX);
		this.dust.frustumCulled = false;
		this.dust.renderOrder = 2;
		this.dust.name = "dust";
		for (let i = 0; i < DUST_MAX; i++) this.dust.setMatrixAt(i, _hidden);
		scene.add(this.dust);

		const chipMat = new MeshStandardNodeMaterial({
			color: new Color("#9a8169"),
			roughness: 0.9,
			flatShading: true,
		});
		this.chips = new InstancedMesh(
			new DodecahedronGeometry(1, 0),
			chipMat,
			CHIP_MAX,
		);
		this.chips.frustumCulled = false;
		this.chips.castShadow = true;
		this.chips.name = "chips";
		for (let i = 0; i < CHIP_MAX; i++) this.chips.setMatrixAt(i, _hidden);
		scene.add(this.chips);
	}

	/** A cloud of `n` puffs at a point, spread `r`, pushed by (vx, vz). */
	puff(
		x: number,
		y: number,
		z: number,
		n: number,
		r: number,
		vx = 0,
		vz = 0,
	): void {
		const g = this.rng;
		for (let k = 0; k < n; k++) {
			const i = this.dNext;
			this.dNext = (this.dNext + 1) % DUST_MAX;
			const a = g.range(0, Math.PI * 2);
			const rr = g.range(0, r);
			this.dp[i * 3] = x + Math.cos(a) * rr;
			this.dp[i * 3 + 1] = Math.max(0.2, y + g.range(-0.2, 0.4));
			this.dp[i * 3 + 2] = z + Math.sin(a) * rr;
			const out = g.range(0.6, 2.4);
			this.dv[i * 3] = Math.cos(a) * out + vx * 0.2;
			this.dv[i * 3 + 1] = g.range(0.3, 1.6);
			this.dv[i * 3 + 2] = Math.sin(a) * out + vz * 0.2;
			this.dAge[i] = 0;
			this.dLife[i] = g.range(2.2, 4.5);
			this.dSize[i * 2] = g.range(0.5, 1.1) * (0.6 + r * 0.4);
			this.dSize[i * 2 + 1] = g.range(2.2, 4.2) * (0.6 + r * 0.35);
			this.dRot[i] = g.range(0, Math.PI * 2);
		}
	}

	/** `n` stone chips thrown from a point with speed around `speed`. */
	spray(x: number, y: number, z: number, n: number, speed: number): void {
		const g = this.rng;
		for (let k = 0; k < n; k++) {
			const i = this.cNext;
			this.cNext = (this.cNext + 1) % CHIP_MAX;
			this.cp[i * 3] = x;
			this.cp[i * 3 + 1] = y;
			this.cp[i * 3 + 2] = z;
			const a = g.range(0, Math.PI * 2);
			const up = g.range(0.2, 1);
			const s = speed * g.range(0.35, 1);
			this.cv[i * 3] = Math.cos(a) * s * (1 - up * 0.5);
			this.cv[i * 3 + 1] = up * s;
			this.cv[i * 3 + 2] = Math.sin(a) * s * (1 - up * 0.5);
			this.cAge[i] = 0;
			this.cSpin[i * 2] = g.range(-12, 12);
			this.cSpin[i * 2 + 1] = g.range(0, 6);
			this.cSize[i] = g.range(0.03, 0.09);
		}
	}

	/** Advances by `dt` (scaled game seconds) and faces the puffs to `camera`. */
	update(dt: number, camera: Camera): void {
		const fade = this.fade.array as Float32Array;
		const arr = this.dust.instanceMatrix.array as Float32Array;
		const camQ = camera.quaternion;
		for (let i = 0; i < DUST_MAX; i++) {
			const life = this.dLife[i] as number;
			let age = this.dAge[i] as number;
			if (age >= life) {
				if (fade[i * 2] !== 0) {
					fade[i * 2] = 0;
					_hidden.toArray(arr, i * 16);
				}
				continue;
			}
			age += dt;
			this.dAge[i] = age;
			const t = age / life;
			const drag = Math.exp(-dt * 1.6);
			const o = i * 3;
			(this.dv as Float32Array)[o] = (this.dv[o] as number) * drag;
			this.dv[o + 1] = (this.dv[o + 1] as number) * drag + dt * 0.15;
			this.dv[o + 2] = (this.dv[o + 2] as number) * drag;
			this.dp[o] = (this.dp[o] as number) + (this.dv[o] as number) * dt;
			this.dp[o + 1] =
				(this.dp[o + 1] as number) + (this.dv[o + 1] as number) * dt;
			this.dp[o + 2] =
				(this.dp[o + 2] as number) + (this.dv[o + 2] as number) * dt;
			const ease = 1 - (1 - t) * (1 - t);
			const size =
				(this.dSize[i * 2] as number) +
				((this.dSize[i * 2 + 1] as number) - (this.dSize[i * 2] as number)) *
					ease;
			_p.set(
				this.dp[o] as number,
				this.dp[o + 1] as number,
				this.dp[o + 2] as number,
			);
			_s.set(size, size, size);
			_q.setFromAxisAngle(_p.set(0, 0, 1), (this.dRot[i] as number) + t * 0.6);
			_q.premultiply(camQ);
			_p.set(
				this.dp[o] as number,
				this.dp[o + 1] as number,
				this.dp[o + 2] as number,
			);
			_m.compose(_p, _q, _s);
			_m.toArray(arr, i * 16);
			// Quick fade-in, long fade-out.
			fade[i * 2] = Math.min(1, t * 10) * (1 - t) * (1 - t);
			fade[i * 2 + 1] = (this.dRot[i] as number) * 0.3;
		}
		this.dust.instanceMatrix.needsUpdate = true;
		this.fade.needsUpdate = true;

		const carr = this.chips.instanceMatrix.array as Float32Array;
		for (let i = 0; i < CHIP_MAX; i++) {
			let age = this.cAge[i] as number;
			if (age > 3.5) {
				if (age < 1e9) {
					this.cAge[i] = 1e9;
					_hidden.toArray(carr, i * 16);
				}
				continue;
			}
			age += dt;
			this.cAge[i] = age;
			const o = i * 3;
			this.cv[o + 1] = (this.cv[o + 1] as number) - GRAV * dt;
			let y = (this.cp[o + 1] as number) + (this.cv[o + 1] as number) * dt;
			const sz = this.cSize[i] as number;
			if (y < sz) {
				y = sz;
				this.cv[o] = (this.cv[o] as number) * 0.5;
				this.cv[o + 1] = -(this.cv[o + 1] as number) * 0.3;
				this.cv[o + 2] = (this.cv[o + 2] as number) * 0.5;
			}
			this.cp[o] = (this.cp[o] as number) + (this.cv[o] as number) * dt;
			this.cp[o + 1] = y;
			this.cp[o + 2] =
				(this.cp[o + 2] as number) + (this.cv[o + 2] as number) * dt;
			const shrink = age > 2.8 ? Math.max(0, 1 - (age - 2.8) / 0.7) : 1;
			_s.setScalar(sz * shrink);
			_q.setFromAxisAngle(
				_p
					.set(
						Math.sin(this.cSpin[i * 2 + 1] as number),
						0.5,
						Math.cos(this.cSpin[i * 2 + 1] as number),
					)
					.normalize(),
				age * (this.cSpin[i * 2] as number),
			);
			_p.set(this.cp[o] as number, y, this.cp[o + 2] as number);
			_m.compose(_p, _q, _s);
			_m.toArray(carr, i * 16);
		}
		this.chips.instanceMatrix.needsUpdate = true;
	}

	/** Clears every particle (level change, replay start). */
	clear(): void {
		this.dAge.fill(1e9);
		this.cAge.fill(4);
	}
}
