import { attribute, mix, vec3 } from "three/tsl";
import {
	AdditiveBlending,
	BufferAttribute,
	BufferGeometry,
	DoubleSide,
	DynamicDrawUsage,
	Mesh,
	MeshBasicNodeMaterial,
	type Scene,
	type Vector3,
} from "three/webgpu";

const SAMPLES = 64;
/** Seconds a trail sample stays visible. */
const LIFE = 0.14;

/**
 * The katana's slash ribbon: a strip between the blade's base and tip over its last
 * samples, fading with age (and toward the hilt), additive white-to-steel-blue. The ring
 * buffer and its GPU buffers are preallocated; `push`/`update` do not allocate.
 */
export class SlashTrail {
	readonly mesh: Mesh;
	private readonly pos: Float32Array;
	private readonly fade: Float32Array;
	private readonly posAttr: BufferAttribute;
	private readonly fadeAttr: BufferAttribute;
	private readonly base = new Float32Array(SAMPLES * 3);
	private readonly tip = new Float32Array(SAMPLES * 3);
	private readonly born = new Float32Array(SAMPLES);
	private head = 0;
	private count = 0;
	private time = 0;
	/** 0..1: brightness multiplier (heavy moves glow hotter). */
	intensity = 1;

	constructor(scene: Scene) {
		const g = new BufferGeometry();
		this.pos = new Float32Array(SAMPLES * 2 * 3);
		this.fade = new Float32Array(SAMPLES * 2);
		this.posAttr = new BufferAttribute(this.pos, 3);
		this.posAttr.setUsage(DynamicDrawUsage);
		this.fadeAttr = new BufferAttribute(this.fade, 1);
		this.fadeAttr.setUsage(DynamicDrawUsage);
		g.setAttribute("position", this.posAttr);
		g.setAttribute("fade", this.fadeAttr);
		const idx: number[] = [];
		for (let i = 0; i < SAMPLES - 1; i++) {
			const a = i * 2;
			idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
		}
		g.setIndex(idx);
		const m = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			side: DoubleSide,
		});
		const f = attribute<"float">("fade", "float");
		// hot white core near the edge of the arc, cooling to steel blue
		m.colorNode = mix(vec3(0.25, 0.55, 1.4), vec3(2.2, 2.1, 1.9), f.mul(f)).mul(
			f,
		);
		this.mesh = new Mesh(g, m);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 5;
		scene.add(this.mesh);
	}

	push(base: Vector3, tip: Vector3): void {
		const i = this.head;
		this.base[i * 3] = base.x;
		this.base[i * 3 + 1] = base.y;
		this.base[i * 3 + 2] = base.z;
		this.tip[i * 3] = tip.x;
		this.tip[i * 3 + 1] = tip.y;
		this.tip[i * 3 + 2] = tip.z;
		this.born[i] = this.time;
		this.head = (i + 1) % SAMPLES;
		if (this.count < SAMPLES) this.count++;
	}

	/** Clears the ribbon so the next swing does not connect to the last. */
	cut(): void {
		this.count = 0;
	}

	update(dt: number): void {
		this.time += dt;
		const n = this.count;
		let visible = false;
		// oldest -> newest
		for (let k = 0; k < SAMPLES; k++) {
			const v = k * 2;
			if (k >= n) {
				// collapse unused vertices onto the newest sample
				const src = (this.head - 1 + SAMPLES) % SAMPLES;
				this.writeVertex(v, src, 0);
				continue;
			}
			const src = (this.head - n + k + SAMPLES) % SAMPLES;
			const age = this.time - (this.born[src] as number);
			const life = Math.max(0, 1 - age / LIFE);
			const a = life * life * this.intensity;
			if (a > 0.01) visible = true;
			this.writeVertex(v, src, a);
		}
		this.mesh.visible = visible;
		this.posAttr.needsUpdate = true;
		this.fadeAttr.needsUpdate = true;
	}

	private writeVertex(v: number, src: number, a: number): void {
		const p = this.pos;
		const b = src * 3;
		// base vertex: a quarter of the way up the blade, so the ribbon hugs the edge
		const bx = this.base[b] as number;
		const by = this.base[b + 1] as number;
		const bz = this.base[b + 2] as number;
		const tx = this.tip[b] as number;
		const ty = this.tip[b + 1] as number;
		const tz = this.tip[b + 2] as number;
		p[v * 3] = bx + (tx - bx) * 0.25;
		p[v * 3 + 1] = by + (ty - by) * 0.25;
		p[v * 3 + 2] = bz + (tz - bz) * 0.25;
		p[v * 3 + 3] = tx + (tx - bx) * 0.08;
		p[v * 3 + 4] = ty + (ty - by) * 0.08;
		p[v * 3 + 5] = tz + (tz - bz) * 0.08;
		this.fade[v] = a * 0.15;
		this.fade[v + 1] = a;
	}
}
