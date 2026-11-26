import { color, float, smoothstep, uniform, uv } from "three/tsl";
import {
	AdditiveBlending,
	Color,
	CylinderGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	RingGeometry,
} from "three/webgpu";

interface Pulse {
	mesh: Mesh;
	opacity: { value: number };
	tint: { value: Color };
	age: number;
	life: number;
	size: number;
}

/**
 * Pooled one-shot effects: floor shockwave rings (impacts, dashes, drops) and tall light
 * pillars where an orb left the ring. Fixed pools, no allocation after construction.
 */
export class Fx {
	readonly root = new Group();
	private readonly rings: Pulse[] = [];
	private readonly beams: Pulse[] = [];
	private ringNext = 0;
	private beamNext = 0;

	constructor() {
		const ringGeo = new RingGeometry(0.82, 1, 48, 1);
		ringGeo.rotateX(-Math.PI / 2);
		for (let i = 0; i < 12; i++) this.rings.push(this.make(ringGeo, false));
		const beamGeo = new CylinderGeometry(0.55, 0.9, 30, 24, 1, true);
		beamGeo.translate(0, 3, 0);
		for (let i = 0; i < 4; i++) this.beams.push(this.make(beamGeo, true));
	}

	private make(geo: RingGeometry | CylinderGeometry, beam: boolean): Pulse {
		const opacity = uniform(0);
		const tint = uniform(new Color(1, 1, 1));
		const mat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			side: DoubleSide,
		});
		mat.colorNode = color(tint);
		// beams fade toward both ends
		mat.opacityNode = beam
			? opacity
					.mul(smoothstep(float(0), float(0.35), uv().y))
					.mul(smoothstep(float(1), float(0.6), uv().y))
			: opacity;
		const mesh = new Mesh(geo, mat);
		mesh.visible = false;
		mesh.renderOrder = 5;
		mesh.frustumCulled = false;
		this.root.add(mesh);
		return { mesh, opacity, tint, age: 0, life: 0, size: 1 };
	}

	ring(
		x: number,
		y: number,
		z: number,
		size: number,
		c: Color,
		intensity: number,
		life = 0.45,
	): void {
		const p = this.rings[this.ringNext] as Pulse;
		this.ringNext = (this.ringNext + 1) % this.rings.length;
		p.mesh.position.set(x, y, z);
		p.tint.value.copy(c).multiplyScalar(intensity);
		p.age = 0;
		p.life = life;
		p.size = size;
		p.mesh.visible = true;
	}

	beam(x: number, z: number, c: Color): void {
		const p = this.beams[this.beamNext] as Pulse;
		this.beamNext = (this.beamNext + 1) % this.beams.length;
		p.mesh.position.set(x, -14, z);
		p.tint.value.copy(c).multiplyScalar(3);
		p.age = 0;
		p.life = 1.6;
		p.size = 1;
		p.mesh.visible = true;
	}

	clear(): void {
		for (const p of this.rings) p.mesh.visible = false;
		for (const p of this.beams) p.mesh.visible = false;
	}

	update(dt: number): void {
		for (const p of this.rings) {
			if (!p.mesh.visible) continue;
			p.age += dt;
			const k = p.age / p.life;
			if (k >= 1) {
				p.mesh.visible = false;
				continue;
			}
			const s = p.size * (0.3 + 0.7 * (1 - (1 - k) * (1 - k)));
			p.mesh.scale.set(s, 1, s);
			p.opacity.value = (1 - k) * (1 - k);
		}
		for (const p of this.beams) {
			if (!p.mesh.visible) continue;
			p.age += dt;
			const k = p.age / p.life;
			if (k >= 1) {
				p.mesh.visible = false;
				continue;
			}
			const w = 1 + k * 0.6;
			p.mesh.scale.set(w * (1 - k * 0.5), 1, w * (1 - k * 0.5));
			p.opacity.value = Math.min(1, k * 8) * (1 - k);
		}
	}
}
