import {
	AdditiveBlending,
	CanvasTexture,
	CircleGeometry,
	Color,
	CylinderGeometry,
	DodecahedronGeometry,
	DoubleSide,
	Euler,
	Group,
	IcosahedronGeometry,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	OctahedronGeometry,
	PlaneGeometry,
	PointLight,
	Quaternion,
	type Scene,
	SRGBColorSpace,
	TorusGeometry,
	Vector3,
} from "three/webgpu";
import { CELLS, CORE_X, CORE_Z, HALF, LANE_HALF } from "../constants.ts";
import { cellCenter, type PathSamples, ROCKS } from "../path.ts";
import { Rng } from "../rng.ts";

const GROUND = 100;
const TEX = 2048;

/** World (x, z) to ground-texture pixels. */
function px(v: number): number {
	return ((v + GROUND / 2) / GROUND) * TEX;
}

function groundTextures(
	paths: readonly PathSamples[],
	mask: Uint8Array,
): [CanvasTexture, CanvasTexture] {
	const base = document.createElement("canvas");
	base.width = base.height = TEX;
	const g = base.getContext("2d") as CanvasRenderingContext2D;
	const glow = document.createElement("canvas");
	glow.width = glow.height = TEX;
	const e = glow.getContext("2d") as CanvasRenderingContext2D;
	const r = new Rng(91);
	// Salt-flat base: cool slate, darker toward the rim.
	const grad = g.createRadialGradient(
		TEX / 2,
		TEX / 2,
		TEX * 0.05,
		TEX / 2,
		TEX / 2,
		TEX * 0.62,
	);
	grad.addColorStop(0, "#23253a");
	grad.addColorStop(0.7, "#17182a");
	grad.addColorStop(1, "#0c0c16");
	g.fillStyle = grad;
	g.fillRect(0, 0, TEX, TEX);
	for (let i = 0; i < 26000; i++) {
		const l = r.next();
		g.fillStyle =
			l < 0.5
				? `rgba(10,10,20,${0.08 + l * 0.2})`
				: `rgba(170,175,210,${(l - 0.5) * 0.12})`;
		const s = 1 + r.next() * 4;
		g.fillRect(r.next() * TEX, r.next() * TEX, s, s);
	}
	// Salt-crust polygons: faint pale crack network.
	g.strokeStyle = "rgba(190,195,230,0.10)";
	g.lineWidth = 1.5;
	for (let i = 0; i < 260; i++) {
		let x = r.next() * TEX;
		let y = r.next() * TEX;
		g.beginPath();
		g.moveTo(x, y);
		for (let k = 0; k < 5; k++) {
			x += r.range(-60, 60);
			y += r.range(-60, 60);
			g.lineTo(x, y);
		}
		g.stroke();
	}
	// Build pads: a faint dot at each buildable cell centre.
	g.fillStyle = "rgba(150,200,255,0.16)";
	for (let c = 0; c < CELLS * CELLS; c++) {
		if (mask[c] !== 1) continue;
		const [x, z] = cellCenter(c);
		g.fillRect(px(x) - 2, px(z) - 2, 4, 4);
	}
	g.strokeStyle = "rgba(150,200,255,0.06)";
	g.lineWidth = 1;
	g.strokeRect(
		px(-HALF),
		px(-HALF),
		px(HALF) - px(-HALF),
		px(HALF) - px(-HALF),
	);
	// Lanes: a dark worn trench in the albedo, glowing ember edges in the emissive map.
	const stroke = (
		ctx: CanvasRenderingContext2D,
		p: PathSamples,
		w: number,
		style: string,
	): void => {
		ctx.strokeStyle = style;
		ctx.lineWidth = (w / GROUND) * TEX;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.beginPath();
		ctx.moveTo(px(p.x[0] as number), px(p.z[0] as number));
		for (let i = 1; i < p.n; i++)
			ctx.lineTo(px(p.x[i] as number), px(p.z[i] as number));
		ctx.stroke();
	};
	e.fillStyle = "#000";
	e.fillRect(0, 0, TEX, TEX);
	for (const p of paths) stroke(g, p, LANE_HALF * 2 + 1.4, "rgba(8,7,14,0.55)");
	for (const p of paths) stroke(g, p, LANE_HALF * 2 + 0.4, "#100d16");
	for (const p of paths) stroke(g, p, LANE_HALF * 2 - 0.6, "#1a1420");
	for (const p of paths) stroke(e, p, LANE_HALF * 2 + 0.55, "#ff7a2a");
	for (const p of paths) stroke(e, p, LANE_HALF * 2 + 0.05, "#000");
	// A dim centre vein.
	for (const p of paths) stroke(e, p, 0.25, "rgba(255,90,40,0.35)");
	const map = new CanvasTexture(base);
	map.colorSpace = SRGBColorSpace;
	map.anisotropy = 8;
	const em = new CanvasTexture(glow);
	em.colorSpace = SRGBColorSpace;
	em.anisotropy = 8;
	return [map, em];
}

/** The static diorama: ground, outcrops, rifts, the core and the rim of crystal spires. */
export class WorldView {
	readonly core: Group;
	private readonly crystal: Mesh;
	private readonly crystalMat: MeshStandardNodeMaterial;
	private readonly rings: Mesh[] = [];
	private readonly coreLight: PointLight;
	private readonly riftDiscs: Mesh[] = [];
	private readonly gridMesh: Mesh;
	private t = 0;
	private hurt = 0;

	constructor(scene: Scene, paths: readonly PathSamples[], mask: Uint8Array) {
		const [map, em] = groundTextures(paths, mask);
		const ground = new Mesh(
			new PlaneGeometry(GROUND, GROUND),
			new MeshStandardNodeMaterial({
				map,
				emissiveMap: em,
				emissive: new Color(1, 1, 1),
				emissiveIntensity: 2.4,
				roughness: 0.92,
				metalness: 0,
			}),
		);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);
		const outer = new Mesh(
			new PlaneGeometry(400, 400),
			new MeshStandardNodeMaterial({ color: 0x12121c, roughness: 1 }),
		);
		outer.rotation.x = -Math.PI / 2;
		outer.position.y = -0.02;
		scene.add(outer);

		// Build grid overlay (shown while placing).
		const gc = document.createElement("canvas");
		gc.width = gc.height = 1024;
		const gx = gc.getContext("2d") as CanvasRenderingContext2D;
		const cpx = 1024 / CELLS;
		for (let c = 0; c < CELLS * CELLS; c++) {
			if (mask[c] !== 1) continue;
			const i = c % CELLS;
			const k = Math.floor(c / CELLS);
			gx.strokeStyle = "rgba(120,220,255,0.5)";
			gx.lineWidth = 1.5;
			gx.strokeRect(i * cpx + 3, k * cpx + 3, cpx - 6, cpx - 6);
		}
		const gt = new CanvasTexture(gc);
		gt.colorSpace = SRGBColorSpace;
		this.gridMesh = new Mesh(
			new PlaneGeometry(HALF * 2, HALF * 2),
			new MeshBasicNodeMaterial({
				map: gt,
				color: new Color(0.035, 0.08, 0.12),
				transparent: true,
				opacity: 1,
				depthWrite: false,
				blending: AdditiveBlending,
			}),
		);
		this.gridMesh.rotation.x = -Math.PI / 2;
		this.gridMesh.position.y = 0.03;
		this.gridMesh.visible = false;
		scene.add(this.gridMesh);

		this.addRocks(scene);
		this.addRim(scene);

		// Rifts at the two path heads.
		for (const p of paths) {
			const g = new Group();
			const yaw = p.yaw[2] as number;
			g.position.set(p.x[0] as number, 0, p.z[0] as number);
			g.rotation.y = yaw;
			const ring = new Mesh(
				new TorusGeometry(2.7, 0.22, 10, 48),
				new MeshStandardNodeMaterial({
					color: 0x220814,
					emissive: new Color(0xff2a8a),
					emissiveIntensity: 3.2,
				}),
			);
			ring.position.y = 2.6;
			g.add(ring);
			const disc = new Mesh(
				new CircleGeometry(2.55, 40),
				new MeshBasicNodeMaterial({
					color: new Color(0.9, 0.12, 0.55),
					transparent: true,
					opacity: 0.55,
					blending: AdditiveBlending,
					depthWrite: false,
					side: DoubleSide,
				}),
			);
			disc.position.y = 2.6;
			g.add(disc);
			this.riftDiscs.push(disc);
			const base = new Mesh(
				new CylinderGeometry(3.4, 3.8, 0.4, 10),
				new MeshStandardNodeMaterial({ color: 0x1d1a26, roughness: 0.8 }),
			);
			base.position.y = 0.2;
			base.receiveShadow = true;
			g.add(base);
			const light = new PointLight(0xff3a8a, 40, 18, 1.6);
			light.position.y = 2.6;
			g.add(light);
			scene.add(g);
		}

		// The core: a plinth, a floating crystal and two counter-rotating rings.
		this.core = new Group();
		this.core.position.set(CORE_X, 0, CORE_Z);
		const plinth = new Mesh(
			new CylinderGeometry(2.6, 3.2, 0.9, 8),
			new MeshStandardNodeMaterial({
				color: 0x8a8ca0,
				roughness: 0.45,
				metalness: 0.2,
			}),
		);
		plinth.position.y = 0.45;
		plinth.castShadow = plinth.receiveShadow = true;
		this.core.add(plinth);
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			const pylon = new Mesh(
				new CylinderGeometry(0.22, 0.34, 3.2, 6),
				new MeshStandardNodeMaterial({
					color: 0x9a9cb0,
					roughness: 0.4,
					metalness: 0.3,
				}),
			);
			pylon.position.set(Math.cos(a) * 2.3, 2.2, Math.sin(a) * 2.3);
			pylon.castShadow = true;
			this.core.add(pylon);
			const tip = new Mesh(
				new OctahedronGeometry(0.25),
				new MeshStandardNodeMaterial({
					color: 0x0a2030,
					emissive: new Color(0x5ff0ff),
					emissiveIntensity: 4,
				}),
			);
			tip.position.set(Math.cos(a) * 2.3, 3.95, Math.sin(a) * 2.3);
			this.core.add(tip);
		}
		this.crystalMat = new MeshStandardNodeMaterial({
			color: 0x0b2a38,
			emissive: new Color(0x6ff6ff),
			emissiveIntensity: 3.5,
			roughness: 0.15,
			metalness: 0.1,
			flatShading: true,
		});
		this.crystal = new Mesh(new OctahedronGeometry(1.5, 0), this.crystalMat);
		this.crystal.scale.set(1, 1.7, 1);
		this.crystal.position.y = 4.4;
		this.crystal.castShadow = true;
		this.core.add(this.crystal);
		for (let i = 0; i < 2; i++) {
			const ring = new Mesh(
				new TorusGeometry(2.4 + i * 0.6, 0.07, 6, 64),
				new MeshStandardNodeMaterial({
					color: 0x0a1a22,
					emissive: new Color(0x8ff8ff),
					emissiveIntensity: 1.2,
				}),
			);
			ring.position.y = 4.4;
			this.rings.push(ring);
			this.core.add(ring);
		}
		this.coreLight = new PointLight(0x6ff6ff, 90, 26, 1.5);
		this.coreLight.position.y = 4.4;
		this.core.add(this.coreLight);
		scene.add(this.core);
	}

	private addRocks(scene: Scene): void {
		const r = new Rng(17);
		const rocks = new InstancedMesh(
			new DodecahedronGeometry(1, 0),
			new MeshStandardNodeMaterial({
				color: 0x23212f,
				roughness: 0.88,
				flatShading: true,
			}),
			ROCKS.length * 4,
		);
		const shards = new InstancedMesh(
			new OctahedronGeometry(1, 0),
			new MeshStandardNodeMaterial({
				color: 0x1a0c2a,
				emissive: new Color(0x9a5cff),
				emissiveIntensity: 2.6,
				roughness: 0.2,
				flatShading: true,
			}),
			ROCKS.length * 4,
		);
		const m = new Matrix4();
		const q = new Quaternion();
		const p = new Vector3();
		const sc = new Vector3();
		const eu = new Euler();
		let ri = 0;
		let si = 0;
		for (const [x, z, h] of ROCKS) {
			for (let k = 0; k < 4; k++) {
				const s = h * (k === 0 ? 1 : 0.45 + r.next() * 0.35);
				sc.set(
					s * (0.9 + r.next() * 0.3),
					s * (0.55 + r.next() * 0.3),
					s * (0.9 + r.next() * 0.3),
				);
				const a = r.next() * 6.28;
				const d = k === 0 ? 0 : h * 0.8;
				p.set(x + Math.cos(a) * d, s * 0.35, z + Math.sin(a) * d);
				q.setFromEuler(eu.set(r.next(), r.next() * 6, r.next()));
				rocks.setMatrixAt(ri++, m.compose(p, q, sc));
			}
			const n = 2 + r.int(3);
			for (let k = 0; k < n; k++) {
				const s = 0.25 + r.next() * 0.35;
				sc.set(s, s * (2.5 + r.next() * 2), s);
				const a = r.next() * 6.28;
				p.set(x + Math.cos(a) * h * 0.7, h * 0.6, z + Math.sin(a) * h * 0.7);
				q.setFromEuler(
					eu.set((r.next() - 0.5) * 0.8, r.next() * 6, (r.next() - 0.5) * 0.8),
				);
				shards.setMatrixAt(si++, m.compose(p, q, sc));
			}
		}
		rocks.count = ri;
		shards.count = si;
		rocks.castShadow = rocks.receiveShadow = true;
		scene.add(rocks, shards);
	}

	private addRim(scene: Scene): void {
		const r = new Rng(29);
		const N = 160;
		const spires = new InstancedMesh(
			new IcosahedronGeometry(1, 0),
			new MeshStandardNodeMaterial({
				color: 0x1b1a2c,
				roughness: 0.85,
				flatShading: true,
			}),
			N,
		);
		const glow = new InstancedMesh(
			new OctahedronGeometry(1, 0),
			new MeshStandardNodeMaterial({
				color: 0x10061c,
				emissive: new Color(0x7a4cff),
				emissiveIntensity: 2.2,
				flatShading: true,
			}),
			60,
		);
		const m = new Matrix4();
		const q = new Quaternion();
		const p = new Vector3();
		const s = new Vector3();
		const e = new Vector3();
		let gi = 0;
		for (let i = 0; i < N; i++) {
			let x = 0;
			let z = 0;
			do {
				x = r.range(-58, 58);
				z = r.range(-58, 58);
			} while (Math.max(Math.abs(x), Math.abs(z)) < 43);
			const h = 1.5 + r.next() * 4;
			p.set(x, h * 0.4, z);
			q.setFromAxisAngle(
				e.set(r.next() - 0.5, 1, r.next() - 0.5).normalize(),
				r.next() * 6,
			);
			s.set(1 + r.next() * 1.8, h, 1 + r.next() * 1.8);
			spires.setMatrixAt(i, m.compose(p, q, s));
			if (gi < 60 && r.next() < 0.45) {
				p.set(x + r.range(-1, 1), h * 0.9, z + r.range(-1, 1));
				s.set(0.35, 1.2 + r.next() * 1.5, 0.35);
				glow.setMatrixAt(gi++, m.compose(p, q, s));
			}
		}
		glow.count = gi;
		spires.castShadow = true;
		spires.receiveShadow = true;
		scene.add(spires, glow);
	}

	showGrid(on: boolean): void {
		this.gridMesh.visible = on;
	}

	/** Core damage flash: `amount` in core HP. */
	hit(amount: number): void {
		this.hurt = Math.min(1, this.hurt + 0.15 + amount * 0.05);
	}

	update(dt: number, coreFrac: number): void {
		this.t += dt;
		this.hurt = Math.max(0, this.hurt - dt * 2);
		this.crystal.rotation.y += dt * 0.6;
		this.crystal.position.y = 4.4 + Math.sin(this.t * 1.4) * 0.25;
		(this.rings[0] as Mesh).rotation.set(
			Math.PI / 2 + Math.sin(this.t * 0.7) * 0.3,
			this.t * 0.9,
			0,
		);
		(this.rings[1] as Mesh).rotation.set(
			Math.PI / 2 - Math.sin(this.t * 0.5) * 0.35,
			-this.t * 0.6,
			0.2,
		);
		const live = Math.max(0.08, coreFrac);
		this.crystalMat.emissive.setRGB(
			0.44 + this.hurt * 0.56,
			0.96 * (1 - this.hurt * 0.7),
			1 * (1 - this.hurt * 0.75),
		);
		this.crystalMat.emissiveIntensity = 0.35 + 0.6 * live + this.hurt * 1.5;
		this.coreLight.intensity = 10 + 22 * live + this.hurt * 40;
		this.coreLight.color.setRGB(
			0.44 + this.hurt * 0.56,
			0.96 * (1 - this.hurt * 0.6),
			1 - this.hurt * 0.6,
		);
		for (const d of this.riftDiscs) d.rotation.z = this.t * 0.8;
		for (const d of this.riftDiscs)
			(d.material as MeshBasicNodeMaterial).opacity =
				0.45 + 0.15 * Math.sin(this.t * 3);
	}
}
