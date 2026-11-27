/**
 * Chalk-dust puffs on the mat when bodies land: a fixed pool of soft billboards, no
 * allocation after construction.
 */
import {
	AdditiveBlending,
	type Camera,
	CanvasTexture,
	Color,
	Mesh,
	MeshBasicNodeMaterial,
	PlaneGeometry,
	type Scene,
} from "three/webgpu";

const N = 48;

export class Dust {
	private readonly meshes: Mesh[] = [];
	private readonly mats: MeshBasicNodeMaterial[] = [];
	private readonly life = new Float32Array(N);
	private readonly vel = new Float32Array(N * 3);
	private next = 0;
	private seed = 99;

	constructor(scene: Scene) {
		const geo = new PlaneGeometry(1, 1);
		const tex = (() => {
			const c = document.createElement("canvas");
			c.width = 64;
			c.height = 64;
			const g = c.getContext("2d") as CanvasRenderingContext2D;
			const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
			gr.addColorStop(0, "rgba(255,240,215,0.9)");
			gr.addColorStop(1, "rgba(255,240,215,0)");
			g.fillStyle = gr;
			g.fillRect(0, 0, 64, 64);
			return new CanvasTexture(c);
		})();
		for (let i = 0; i < N; i++) {
			const m = new MeshBasicNodeMaterial({
				color: new Color("#ffe6c4"),
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
				opacity: 0,
				map: tex,
			});
			const mesh = new Mesh(geo, m);
			mesh.visible = false;
			mesh.renderOrder = 5;
			scene.add(mesh);
			this.meshes.push(mesh);
			this.mats.push(m);
		}
	}

	private rnd(): number {
		this.seed = (this.seed * 16807) % 2147483647;
		return this.seed / 2147483647;
	}

	puff(x: number, z: number, n: number, power: number): void {
		for (let k = 0; k < n; k++) {
			const i = this.next;
			this.next = (this.next + 1) % N;
			const a = this.rnd() * Math.PI * 2;
			const sp = (0.4 + this.rnd() * 0.8) * power;
			const m = this.meshes[i] as Mesh;
			m.position.set(x + Math.cos(a) * 0.15, 0.04, z + Math.sin(a) * 0.15);
			this.vel[i * 3] = Math.cos(a) * sp;
			this.vel[i * 3 + 1] = 0.15 + this.rnd() * 0.25;
			this.vel[i * 3 + 2] = Math.sin(a) * sp;
			this.life[i] = 1;
			m.visible = true;
		}
	}

	update(dt: number, cam: Camera): void {
		for (let i = 0; i < N; i++) {
			if ((this.life[i] as number) <= 0) continue;
			const l = (this.life[i] as number) - dt * 1.4;
			this.life[i] = l;
			const m = this.meshes[i] as Mesh;
			if (l <= 0) {
				m.visible = false;
				continue;
			}
			m.position.x += (this.vel[i * 3] as number) * dt;
			m.position.y += (this.vel[i * 3 + 1] as number) * dt;
			m.position.z += (this.vel[i * 3 + 2] as number) * dt;
			this.vel[i * 3] = (this.vel[i * 3] as number) * (1 - dt * 3);
			this.vel[i * 3 + 2] = (this.vel[i * 3 + 2] as number) * (1 - dt * 3);
			const s = 0.18 + (1 - l) * 0.5;
			m.scale.set(s, s, s);
			m.quaternion.copy(cam.quaternion);
			(this.mats[i] as MeshBasicNodeMaterial).opacity = l * l * 0.35;
		}
	}
}
