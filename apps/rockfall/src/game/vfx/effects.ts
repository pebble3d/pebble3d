import {
	float,
	length,
	positionGeometry,
	smoothstep,
	uv,
	vec3,
} from "three/tsl";
import {
	AdditiveBlending,
	CircleGeometry,
	Color,
	DynamicDrawUsage,
	IcosahedronGeometry,
	InstancedMesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	type PerspectiveCamera,
	PlaneGeometry,
	type Scene,
} from "three/webgpu";
import { EV, type EventQueue } from "../events.ts";
import { KIND } from "../rocks.ts";
import type { RockfallSim } from "../sim.ts";
import { Particles } from "./particles.ts";

const MAX_WAVES = 24;
const _c = new Color();

/** Deterministic-enough hash noise for VFX only (never feeds the sim). */
let seed = 1234567;
function rnd(): number {
	seed = (seed * 16807) % 2147483647;
	return seed / 2147483647;
}
function rr(a: number, b: number): number {
	return a + (b - a) * rnd();
}

/**
 * Event-driven VFX: dust plumes and stone chips on landings (scaled by rock size and
 * impact speed), sparks and a shockwave ring for heavy impacts and meteor blasts, ember
 * trails behind falling meteors, pickup sparkles and crumble puffs.
 */
export class Effects {
	private readonly dust: Particles;
	private readonly chips: Particles;
	private readonly sparks: Particles;
	private readonly embers: Particles;
	private readonly glints: Particles;
	private readonly waves: InstancedMesh;
	private readonly waveAge = new Float32Array(MAX_WAVES);
	private readonly waveLife = new Float32Array(MAX_WAVES);
	private readonly waveSize = new Float32Array(MAX_WAVES);
	private readonly waveX = new Float32Array(MAX_WAVES);
	private readonly waveY = new Float32Array(MAX_WAVES);
	private readonly waveZ = new Float32Array(MAX_WAVES);
	private readonly waveCol = new Float32Array(MAX_WAVES * 3);
	private waveN = 0;
	private readonly sim: RockfallSim;
	private emberAcc = 0;

	constructor(scene: Scene, sim: RockfallSim) {
		this.sim = sim;
		const quad = new PlaneGeometry(1, 1);
		const soft = (additive: boolean, a: number): MeshBasicNodeMaterial => {
			const m = new MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
			});
			if (additive) m.blending = AdditiveBlending;
			const d = length(uv().sub(0.5)).mul(2);
			const fall = float(1).sub(smoothstep(0.2, 1, d));
			if (additive) m.colorNode = vec3(1, 1, 1).mul(fall);
			else m.opacityNode = fall.mul(a);
			return m;
		};
		this.dust = new Particles(scene, {
			capacity: 900,
			geometry: quad,
			material: soft(false, 0.55),
			mode: "billboard",
			gravity: -0.35,
			drag: 2.2,
		});
		this.chips = new Particles(scene, {
			capacity: 600,
			geometry: new IcosahedronGeometry(1, 0),
			material: new MeshStandardNodeMaterial({
				roughness: 0.9,
				flatShading: true,
			}),
			mode: "tumble",
			gravity: 14,
			drag: 0.4,
			castShadow: false,
		});
		this.sparks = new Particles(scene, {
			capacity: 600,
			geometry: quad,
			material: soft(true, 1),
			mode: "stretch",
			gravity: 9,
			drag: 1.2,
			stretch: 0.08,
			fadeColor: true,
		});
		this.embers = new Particles(scene, {
			capacity: 700,
			geometry: quad,
			material: soft(true, 1),
			mode: "billboard",
			gravity: -1.2,
			drag: 1.6,
			fadeColor: true,
		});
		this.glints = new Particles(scene, {
			capacity: 300,
			geometry: quad,
			material: soft(true, 1),
			mode: "stretch",
			gravity: -2,
			drag: 2.5,
			stretch: 0.12,
			fadeColor: true,
		});
		// Shockwave rings: thin bright annulus, additive.
		const wm = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		const r = length(positionGeometry.xz);
		wm.colorNode = vec3(1, 1, 1).mul(
			smoothstep(0.7, 0.93, r).mul(float(1).sub(smoothstep(0.93, 1, r))),
		);
		const wg = new CircleGeometry(1, 64);
		wg.rotateX(-Math.PI / 2);
		this.waves = new InstancedMesh(wg, wm, MAX_WAVES);
		this.waves.instanceMatrix.setUsage(DynamicDrawUsage);
		this.waves.setColorAt(0, _c.set(1, 1, 1));
		this.waves.instanceColor?.setUsage(DynamicDrawUsage);
		this.waves.frustumCulled = false;
		this.waves.count = 0;
		this.waves.renderOrder = 4;
		scene.add(this.waves);
	}

	/** Reacts to one tick's events. */
	handle(ev: EventQueue): void {
		for (let i = 0; i < ev.n; i++) {
			const t = ev.type[i] as number;
			const x = ev.x[i] as number;
			const y = ev.y[i] as number;
			const z = ev.z[i] as number;
			switch (t) {
				case EV.LAND:
					this.land(
						ev.a[i] as number,
						x,
						y,
						z,
						ev.u[i] as number,
						ev.v[i] as number,
					);
					break;
				case EV.BLAST:
					this.blast(x, y, z, ev.u[i] as number);
					break;
				case EV.CRUMBLE:
					this.puff(x, y, z, (ev.v[i] as number) * 1.4, 2);
					break;
				case EV.PICKUP:
					this.sparkle(ev.a[i] as number, x, y, z);
					break;
				case EV.HIT:
					this.burst(x, y, z, 14, 1.6, 0.9, 0.5, 6);
					break;
				case EV.NEAR_MISS:
					this.ring(
						this.sim.px,
						this.sim.py - 0.9,
						this.sim.pz,
						1.8,
						0.35,
						0.3,
						1.1,
						1.4,
					);
					break;
			}
		}
	}

	private land(
		kind: number,
		x: number,
		y: number,
		z: number,
		speed: number,
		r: number,
	): void {
		const k = Math.min(1, speed / 18);
		if (kind === KIND.PEBBLE) {
			if (rnd() < 0.5) this.puff(x, y, z, 0.35, 1);
			return;
		}
		const n = Math.round(3 + r * 8 * (0.4 + k));
		this.puff(x, y, z, r * 1.7, n);
		const chips = Math.round(r * 9 * (0.3 + k));
		for (let j = 0; j < chips; j++) {
			const a = rnd() * Math.PI * 2;
			const s = rr(1.5, 4.5) * (0.4 + k);
			this.chips.spawn(
				x,
				y + 0.1,
				z,
				Math.cos(a) * s,
				rr(2, 6) * (0.4 + k),
				Math.sin(a) * s,
				rr(0.6, 1.1),
				rr(0.04, 0.09) * (0.6 + r),
				0.55,
				0.47,
				0.39,
			);
		}
		if (kind >= KIND.BOULDER && speed > 8) {
			this.ring(x, y + 0.05, z, r * 4.2, 0.45, 1.0, 0.75, 0.5);
			this.burst(x, y, z, 10, 1.8, 0.9, 0.45, 5);
		}
	}

	private puff(x: number, y: number, z: number, size: number, n: number): void {
		for (let j = 0; j < n; j++) {
			const a = rnd() * Math.PI * 2;
			const s = rr(0.8, 2.6) * Math.min(1.5, size);
			const g = rr(0.52, 0.66);
			this.dust.spawn(
				x + Math.cos(a) * size * 0.3,
				y + rr(0, 0.3),
				z + Math.sin(a) * size * 0.3,
				Math.cos(a) * s,
				rr(0.4, 1.4),
				Math.sin(a) * s,
				rr(0.9, 1.7),
				size * rr(0.8, 1.4),
				g * 1.25,
				g * 0.98,
				g * 0.7,
			);
		}
	}

	private burst(
		x: number,
		y: number,
		z: number,
		n: number,
		r: number,
		g: number,
		b: number,
		speed: number,
	): void {
		for (let j = 0; j < n; j++) {
			const a = rnd() * Math.PI * 2;
			const s = rr(0.4, 1) * speed;
			this.sparks.spawn(
				x,
				y + 0.2,
				z,
				Math.cos(a) * s,
				rr(2, 7),
				Math.sin(a) * s,
				rr(0.3, 0.6),
				rr(0.05, 0.09),
				r * 2,
				g * 2,
				b * 2,
			);
		}
	}

	private blast(x: number, y: number, z: number, radius: number): void {
		this.ring(x, y + 0.1, z, radius * 1.25, 0.55, 3.2, 1.1, 0.25);
		this.ring(x, y + 0.1, z, radius * 0.7, 0.3, 4, 2.2, 0.8);
		this.burst(x, y, z, 60, 2.4, 0.8, 0.2, 11);
		this.puff(x, y, z, 2.2, 22);
		for (let j = 0; j < 40; j++)
			this.embers.spawn(
				x + rr(-1, 1),
				y + rr(0, 1),
				z + rr(-1, 1),
				rr(-3, 3),
				rr(1, 5),
				rr(-3, 3),
				rr(0.8, 1.8),
				rr(0.08, 0.18),
				3,
				0.9,
				0.2,
			);
	}

	private sparkle(type: number, x: number, y: number, z: number): void {
		const col =
			type === 0
				? [0.5, 2.6, 2.3]
				: type === 1
					? [2.8, 0.4, 0.5]
					: [0.6, 1.4, 3];
		for (let j = 0; j < 26; j++) {
			const a = rnd() * Math.PI * 2;
			const s = rr(1, 4);
			this.glints.spawn(
				x,
				y,
				z,
				Math.cos(a) * s,
				rr(1, 6),
				Math.sin(a) * s,
				rr(0.4, 0.8),
				rr(0.04, 0.08),
				col[0] as number,
				col[1] as number,
				col[2] as number,
			);
		}
		this.ring(
			x,
			y - 0.5,
			z,
			2.2,
			0.4,
			col[0] as number,
			col[1] as number,
			col[2] as number,
		);
	}

	private ring(
		x: number,
		y: number,
		z: number,
		size: number,
		life: number,
		r: number,
		g: number,
		b: number,
	): void {
		let i = this.waveN;
		if (i >= MAX_WAVES) {
			i = 0;
			let oldest = 0;
			for (let j = 0; j < MAX_WAVES; j++)
				if (
					(this.waveAge[j] as number) / (this.waveLife[j] as number) >
					oldest
				) {
					oldest = (this.waveAge[j] as number) / (this.waveLife[j] as number);
					i = j;
				}
		} else this.waveN++;
		this.waveAge[i] = 0;
		this.waveLife[i] = life;
		this.waveSize[i] = size;
		this.waveX[i] = x;
		this.waveY[i] = y;
		this.waveZ[i] = z;
		this.waveCol[i * 3] = r;
		this.waveCol[i * 3 + 1] = g;
		this.waveCol[i * 3 + 2] = b;
	}

	update(dt: number, camera: PerspectiveCamera): void {
		// Ember trails behind falling meteors (and a hot glow streak).
		const sim = this.sim;
		const c = sim.views.curr;
		const p = sim.views.prev;
		this.emberAcc += dt;
		const emit = this.emberAcc > 1 / 60;
		if (emit) this.emberAcc = 0;
		for (let i = 0; emit && i < sim.rockCount; i++) {
			if (sim.rockKind[i] !== KIND.METEOR) continue;
			const o = (sim.rockSlot[i] as number) * 8;
			const y = c[o + 1] as number;
			if ((y - (p[o + 1] as number)) * 60 > -3) continue;
			for (let j = 0; j < 3; j++)
				this.embers.spawn(
					(c[o] as number) + rr(-0.4, 0.4),
					y + rr(0, 0.8),
					(c[o + 2] as number) + rr(-0.4, 0.4),
					rr(-0.6, 0.6),
					rr(0, 2),
					rr(-0.6, 0.6),
					rr(0.4, 0.9),
					rr(0.12, 0.3),
					3.2,
					1.0,
					0.25,
				);
		}
		this.dust.update(dt, camera);
		this.chips.update(dt, camera);
		this.sparks.update(dt, camera);
		this.embers.update(dt, camera);
		this.glints.update(dt, camera);
		const e = this.waves.instanceMatrix.array as Float32Array;
		let i = 0;
		while (i < this.waveN) {
			const a = (this.waveAge[i] as number) + dt;
			this.waveAge[i] = a;
			const life = this.waveLife[i] as number;
			if (a >= life) {
				const last = --this.waveN;
				this.waveAge[i] = this.waveAge[last] as number;
				this.waveLife[i] = this.waveLife[last] as number;
				this.waveSize[i] = this.waveSize[last] as number;
				this.waveX[i] = this.waveX[last] as number;
				this.waveY[i] = this.waveY[last] as number;
				this.waveZ[i] = this.waveZ[last] as number;
				for (let k = 0; k < 3; k++)
					this.waveCol[i * 3 + k] = this.waveCol[last * 3 + k] as number;
				continue;
			}
			const k = a / life;
			const ease = 1 - (1 - k) * (1 - k);
			const s = (this.waveSize[i] as number) * (0.15 + 0.85 * ease);
			const j = i * 16;
			e.fill(0, j, j + 16);
			e[j] = s;
			e[j + 5] = 1;
			e[j + 10] = s;
			e[j + 12] = this.waveX[i] as number;
			e[j + 13] = this.waveY[i] as number;
			e[j + 14] = this.waveZ[i] as number;
			e[j + 15] = 1;
			const f = (1 - k) * (1 - k);
			_c.setRGB(
				(this.waveCol[i * 3] as number) * f,
				(this.waveCol[i * 3 + 1] as number) * f,
				(this.waveCol[i * 3 + 2] as number) * f,
			);
			this.waves.setColorAt(i, _c);
			i++;
		}
		this.waves.count = this.waveN;
		this.waves.instanceMatrix.needsUpdate = true;
		if (this.waves.instanceColor) this.waves.instanceColor.needsUpdate = true;
	}
}
