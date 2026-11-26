import {
	CanvasTexture,
	CircleGeometry,
	Color,
	DodecahedronGeometry,
	Euler,
	GridHelper,
	InstancedMesh,
	type LineBasicMaterial,
	Matrix4,
	Mesh,
	MeshStandardNodeMaterial,
	Quaternion,
	RepeatWrapping,
	type Scene,
	SRGBColorSpace,
	Vector2,
	Vector3,
} from "three/webgpu";

/**
 * The garden floor: raked sand (a canvas-painted colour map plus a matching normal map of
 * the rake grooves, generated once at load), a round bed edged by a darker border, and a
 * faint placement grid that shows only while editing.
 */
const BED_RADIUS = 13;
const TILE_M = 2.4;
const GROOVES = 16;

function rakedSand(): { map: CanvasTexture; normal: CanvasTexture } {
	const n = 512;
	const c = document.createElement("canvas");
	c.width = n;
	c.height = n;
	const g = c.getContext("2d") as CanvasRenderingContext2D;
	const nc = document.createElement("canvas");
	nc.width = n;
	nc.height = n;
	const ng = nc.getContext("2d") as CanvasRenderingContext2D;
	const img = g.createImageData(n, n);
	const nimg = ng.createImageData(n, n);
	// Deterministic grain (no Math.random: captures repeat exactly).
	let seed = 12345;
	const rnd = (): number => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const base = new Color("#e9dcc2");
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			// Grooves run along x with a gentle sway; phase in [0, 1) across one groove.
			const sway = Math.sin((x / n) * Math.PI * 2) * 0.35;
			const v = (y / n) * GROOVES + sway;
			const ph = v - Math.floor(v);
			const h = Math.cos(ph * Math.PI * 2); // ridge +1, furrow -1
			const slope = -Math.sin(ph * Math.PI * 2);
			const grain = (rnd() - 0.5) * 0.05;
			const shade = 1 + h * 0.03 + grain;
			const i = (y * n + x) * 4;
			img.data[i] = Math.min(255, base.r * 255 * shade);
			img.data[i + 1] = Math.min(255, base.g * 255 * shade);
			img.data[i + 2] = Math.min(255, base.b * 255 * shade * 0.98);
			img.data[i + 3] = 255;
			// Tangent-space normal: tilt along v (the canvas y axis) by the groove slope.
			const ny = slope * 0.55 + (rnd() - 0.5) * 0.12;
			const nx = (rnd() - 0.5) * 0.12;
			const len = Math.hypot(nx, ny, 1);
			nimg.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
			nimg.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
			nimg.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
			nimg.data[i + 3] = 255;
		}
	}
	g.putImageData(img, 0, 0);
	ng.putImageData(nimg, 0, 0);
	const map = new CanvasTexture(c);
	map.colorSpace = SRGBColorSpace;
	const normal = new CanvasTexture(nc);
	for (const t of [map, normal]) {
		t.wrapS = RepeatWrapping;
		t.wrapT = RepeatWrapping;
		t.repeat.set((BED_RADIUS * 2) / TILE_M, (BED_RADIUS * 2) / TILE_M);
		t.anisotropy = 8;
	}
	return { map, normal };
}

export class Ground {
	private readonly grid: GridHelper;
	private gridAlpha = 1;
	private gridTarget = 1;

	constructor(scene: Scene) {
		const { map, normal } = rakedSand();
		const sand = new MeshStandardNodeMaterial({
			map,
			normalMap: normal,
			roughness: 0.95,
			metalness: 0,
		});
		sand.normalScale = new Vector2(0.4, 0.4);
		const bed = new Mesh(new CircleGeometry(BED_RADIUS, 96), sand);
		bed.rotation.x = -Math.PI / 2;
		bed.receiveShadow = true;
		scene.add(bed);
		// The surround: a darker gravel apron beyond the bed, fading into the fog.
		const apron = new Mesh(
			new CircleGeometry(60, 64),
			new MeshStandardNodeMaterial({
				color: new Color("#a99a83"),
				roughness: 1,
			}),
		);
		apron.rotation.x = -Math.PI / 2;
		apron.position.y = -0.004;
		apron.receiveShadow = true;
		scene.add(apron);
		// A border of dark river stones around the bed.
		const n = 120;
		const stones = new InstancedMesh(
			new DodecahedronGeometry(0.5, 1),
			new MeshStandardNodeMaterial({
				color: new Color("#5a524b"),
				roughness: 0.75,
			}),
			n,
		);
		const m = new Matrix4();
		const q = new Quaternion();
		const e = new Euler();
		const p = new Vector3();
		const sc = new Vector3();
		let seed = 99;
		const rnd = (): number => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		const tint = new Color();
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2 + rnd() * 0.02;
			const r = BED_RADIUS + 0.25 + rnd() * 0.2;
			const s = 0.45 + rnd() * 0.3;
			p.set(Math.cos(a) * r, s * 0.12, Math.sin(a) * r);
			e.set(rnd() * 3, rnd() * 3, rnd() * 3);
			q.setFromEuler(e);
			sc.set(s * (1.3 + rnd() * 0.5), s * 0.8, s * (1.1 + rnd() * 0.4));
			m.compose(p, q, sc);
			stones.setMatrixAt(i, m);
			tint.setHSL(
				0.07 + rnd() * 0.04,
				0.08 + rnd() * 0.08,
				0.22 + rnd() * 0.16,
			);
			stones.setColorAt(i, tint);
		}
		stones.castShadow = true;
		stones.receiveShadow = true;
		scene.add(stones);
		this.grid = new GridHelper(
			BED_RADIUS * 2,
			BED_RADIUS * 4,
			"#8a7a62",
			"#8a7a62",
		);
		this.grid.position.y = 0.003;
		const mat = this.grid.material as LineBasicMaterial;
		mat.transparent = true;
		mat.opacity = 0.22;
		mat.depthWrite = false;
		scene.add(this.grid);
	}

	/** Shows the placement grid while editing. */
	showGrid(on: boolean): void {
		this.gridTarget = on ? 1 : 0;
	}

	frame(dt: number): void {
		const k = Math.min(1, dt * 6);
		this.gridAlpha += (this.gridTarget - this.gridAlpha) * k;
		const mat = this.grid.material as LineBasicMaterial;
		mat.opacity = 0.12 * this.gridAlpha;
		this.grid.visible = this.gridAlpha > 0.01;
	}
}
