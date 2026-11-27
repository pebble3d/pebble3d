/**
 * The late-night academy: a blue tatami floor with a gold border, dark walls, a belt rack,
 * a wall clock that shows the round clock, and a fixed pool of warm overhead lights.
 */

import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
	BoxGeometry,
	type BufferGeometry,
	CanvasTexture,
	CircleGeometry,
	Color,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	PointLight,
	RepeatWrapping,
	type Scene,
	SRGBColorSpace,
} from "three/webgpu";

export const PALETTE = {
	mat: "#2f5d8c",
	matEdge: "#d9b45a",
	wall: "#1e1f24",
	light: "#ffd9a0",
	giWhite: "#f2efe8",
	giBlue: "#2a4fb8",
	wood: "#c99a66",
};

export const BELT_COLORS: Record<string, string> = {
	white: "#ecebe6",
	blue: "#2346a8",
	purple: "#6b3fa0",
	brown: "#6b4224",
	black: "#18181a",
};

function tatamiTexture(): CanvasTexture {
	const c = document.createElement("canvas");
	c.width = 256;
	c.height = 256;
	const g = c.getContext("2d") as CanvasRenderingContext2D;
	g.fillStyle = PALETTE.mat;
	g.fillRect(0, 0, 256, 256);
	// faint woven-vinyl texture
	let s = 777;
	const rnd = (): number => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647;
	};
	for (let i = 0; i < 900; i++) {
		g.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`;
		g.fillRect(rnd() * 256, rnd() * 256, 2, 1);
		g.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`;
		g.fillRect(rnd() * 256, rnd() * 256, 1, 2);
	}
	// seams between two 1 m × 2 m tiles (the texture covers 2 m × 2 m)
	g.fillStyle = "rgba(8,20,36,0.55)";
	g.fillRect(0, 0, 256, 2);
	g.fillRect(0, 0, 2, 256);
	g.fillRect(128, 0, 2, 256);
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	t.wrapS = RepeatWrapping;
	t.wrapT = RepeatWrapping;
	t.anisotropy = 8;
	return t;
}

export class Academy {
	readonly root = new Group();
	private readonly clockHand: Mesh;
	private readonly clockMin: Mesh;
	readonly lights: PointLight[] = [];

	constructor(scene: Scene) {
		const tex = tatamiTexture();
		const SIZE = 8;
		tex.repeat.set(SIZE / 2, SIZE / 2);
		const mat = new MeshStandardNodeMaterial({ map: tex, roughness: 0.78 });
		const floor = new Mesh(new BoxGeometry(SIZE, 0.06, SIZE), mat);
		floor.position.y = -0.03;
		floor.receiveShadow = true;
		this.root.add(floor);
		// gold border strip around the competition square, and an outer dark-blue zone
		const edgeMat = new MeshStandardNodeMaterial({
			color: new Color(PALETTE.matEdge),
			roughness: 0.75,
		});
		const W = 5.2;
		const t = 0.5;
		for (const [x, z, w, d] of [
			[0, -W / 2, W + t, t],
			[0, W / 2, W + t, t],
			[-W / 2, 0, t, W - t],
			[W / 2, 0, t, W - t],
		] as [number, number, number, number][]) {
			const m = new Mesh(new BoxGeometry(w, 0.062, d), edgeMat);
			m.position.set(x, -0.029, z);
			m.receiveShadow = true;
			this.root.add(m);
		}
		const outer = new Mesh(
			new BoxGeometry(30, 0.05, 30),
			new MeshStandardNodeMaterial({
				color: new Color("#1a2c42"),
				roughness: 0.85,
			}),
		);
		outer.position.y = -0.04;
		outer.receiveShadow = true;
		this.root.add(outer);
		// dark walls on three sides, a wainscot rail, a belt rack and a clock
		const wallMat = new MeshStandardNodeMaterial({
			color: new Color(PALETTE.wall),
			roughness: 0.95,
		});
		const railMat = new MeshStandardNodeMaterial({
			color: new Color("#3a2c22"),
			roughness: 0.6,
		});
		const walls: [number, number, number][] = [
			[0, -7, 0],
			[-7, 0, Math.PI / 2],
			[7, 0, -Math.PI / 2],
			[0, 7, Math.PI],
		];
		for (const [x, z, ry] of walls) {
			const w = new Mesh(new PlaneGeometry(14, 6), wallMat);
			w.position.set(x, 3, z);
			w.rotation.y = ry;
			this.root.add(w);
			const rail = new Mesh(new BoxGeometry(14, 0.08, 0.06), railMat);
			rail.position.set(x, 1.0, z);
			rail.rotation.y = ry;
			rail.translateZ(0.03);
			this.root.add(rail);
		}
		// belt rack on the back wall: pegs with hanging belts, every rank
		const rack = new Group();
		const pegMat = new MeshStandardNodeMaterial({
			color: new Color("#8a6a48"),
			roughness: 0.5,
		});
		const board = new Mesh(new BoxGeometry(3.2, 0.12, 0.05), railMat);
		board.position.set(0, 2.1, 0);
		rack.add(board);
		const ranks = [
			"white",
			"white",
			"blue",
			"blue",
			"purple",
			"brown",
			"black",
			"black",
		];
		for (let i = 0; i < ranks.length; i++) {
			const x = -1.4 + i * 0.4;
			const peg = new Mesh(new CylinderGeometry(0.018, 0.018, 0.08, 8), pegMat);
			peg.rotation.x = Math.PI / 2;
			peg.position.set(x, 2.06, 0.06);
			rack.add(peg);
			const col = new Color(BELT_COLORS[ranks[i] as string] as string);
			const bm = new MeshStandardNodeMaterial({ color: col, roughness: 0.75 });
			for (const dx of [-0.035, 0.035]) {
				const strip = new Mesh(
					new BoxGeometry(0.045, 0.62 + (i % 3) * 0.06, 0.012),
					bm,
				);
				strip.position.set(x + dx, 1.73 - (i % 3) * 0.03, 0.08);
				rack.add(strip);
			}
		}
		rack.position.set(-1.5, 0, -6.95);
		this.root.add(rack);
		// a framed calligraphy-free poster: two plain panels for depth
		for (const [x, w] of [
			[2.6, 1.1],
			[4.0, 0.7],
		] as [number, number][]) {
			const frame = new Mesh(new BoxGeometry(w, w * 1.3, 0.04), railMat);
			frame.position.set(x, 2.3, -6.97);
			this.root.add(frame);
			const panel = new Mesh(
				new PlaneGeometry(w * 0.86, w * 1.3 * 0.88),
				new MeshStandardNodeMaterial({
					color: new Color("#2b3a4a"),
					roughness: 0.9,
				}),
			);
			panel.position.set(x, 2.3, -6.945);
			this.root.add(panel);
		}
		// wall clock (shows the round clock)
		const clock = new Group();
		const face = new Mesh(
			new CircleGeometry(0.42, 40),
			new MeshStandardNodeMaterial({
				color: new Color("#efe6d2"),
				roughness: 0.5,
			}),
		);
		const rim = new Mesh(new CylinderGeometry(0.46, 0.46, 0.06, 40), railMat);
		rim.rotation.x = Math.PI / 2;
		rim.position.z = -0.03;
		clock.add(rim, face);
		const handMat = new MeshBasicNodeMaterial({ color: new Color("#1b1b1f") });
		for (let i = 0; i < 12; i++) {
			const tick = new Mesh(new BoxGeometry(0.02, 0.06, 0.01), handMat);
			const a = (i / 12) * Math.PI * 2;
			tick.position.set(Math.sin(a) * 0.36, Math.cos(a) * 0.36, 0.01);
			tick.rotation.z = -a;
			clock.add(tick);
		}
		this.clockMin = new Mesh(new BoxGeometry(0.03, 0.26, 0.012), handMat);
		this.clockMin.geometry.translate(0, 0.11, 0);
		this.clockMin.position.z = 0.015;
		const redMat = new MeshBasicNodeMaterial({ color: new Color("#c8352b") });
		this.clockHand = new Mesh(new BoxGeometry(0.012, 0.36, 0.01), redMat);
		this.clockHand.geometry.translate(0, 0.14, 0);
		this.clockHand.position.z = 0.02;
		clock.add(this.clockMin, this.clockHand);
		clock.position.set(1.0, 3.6, -6.95);
		this.root.add(clock);
		this.merge([this.clockHand, this.clockMin]);
		scene.add(this.root);
		// warm overhead pool + a cool back rim (fixed pool, no shadows)
		const specs: [number, number, number, string, number, number][] = [
			[0, 3.2, 0.2, PALETTE.light, 16, 6.5],
			[-2.2, 3.2, -1.8, PALETTE.light, 4, 6],
			[2.4, 3.0, 2.0, "#9fb8ff", 2.6, 7],
		];
		for (const [x, y, z, c, i, d] of specs) {
			const l = new PointLight(new Color(c), i, d, 1.6);
			l.position.set(x, y, z);
			l.castShadow = false;
			scene.add(l);
			this.lights.push(l);
		}
	}

	/**
	 * Bakes every static mesh into one mesh per material (the set is ~70 small pieces; merged
	 * it is a handful of draw calls). `keep` stays separate (the moving clock hands).
	 */
	private merge(keep: Mesh[]): void {
		this.root.updateMatrixWorld(true);
		const groups = new Map<unknown, { geos: BufferGeometry[]; mesh: Mesh }>();
		const old: Mesh[] = [];
		this.root.traverse((o) => {
			const m = o as Mesh;
			if (!m.isMesh || keep.includes(m)) return;
			const g = m.geometry.index ? m.geometry.clone() : m.geometry.clone();
			g.applyMatrix4(m.matrixWorld);
			const key = m.material;
			const e = groups.get(key) ?? { geos: [], mesh: m };
			e.geos.push(g);
			groups.set(key, e);
			old.push(m);
		});
		for (const m of old) m.parent?.remove(m);
		for (const { geos, mesh } of groups.values()) {
			const merged = mergeGeometries(geos, false);
			if (!merged) continue;
			const out = new Mesh(merged, mesh.material);
			out.receiveShadow = true;
			this.root.add(out);
		}
	}

	/** Sweep hand = seconds, short hand = minutes left in the round. */
	setClock(seconds: number): void {
		this.clockHand.rotation.z = -((seconds % 60) / 60) * Math.PI * 2;
		this.clockMin.rotation.z = (-((seconds / 60) % 12) / 12) * Math.PI * 2 * 4;
	}
}
