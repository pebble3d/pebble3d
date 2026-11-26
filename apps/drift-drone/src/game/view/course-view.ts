import {
	BoxGeometry,
	Color,
	CylinderGeometry,
	EdgesGeometry,
	Group,
	LineBasicNodeMaterial,
	LineSegments,
	type Material,
	Mesh,
	MeshStandardNodeMaterial,
	type Scene,
} from "three/webgpu";
import {
	BAR,
	type Gate,
	gateBars,
	type SiteDef,
	type TrackFile,
} from "../track.ts";
import { mergeByMaterial } from "./merge.ts";

/** Per-gate light state. */
export const LIGHT = { NEXT: 0, AHEAD: 1, DONE: 2, AFTER: 3 } as const;
export type Light = (typeof LIGHT)[keyof typeof LIGHT];

interface GateMesh {
	strip: MeshStandardNodeMaterial;
	light: Light;
	flash: number;
}

const _c = new Color();
const _a = new Color();
const _b = new Color();

/**
 * Gates, the launch pad and (debug) the proxy colliders. Each gate is a powder-coated frame
 * with an LED strip on the inner face of the opening: the next gate burns in the track's hot
 * colour, the one after it glows in the cool colour, flown gates dim. The frame boxes are the
 * same boxes the sim spawns as colliders, so what you see is what you hit.
 */
export class CourseView {
	readonly root = new Group();
	readonly gates: GateMesh[] = [];
	private readonly hot: Color;
	private readonly cool: Color;
	private readonly dim = new Color("#2a3344");
	private t = 0;

	constructor(
		scene: Scene,
		track: TrackFile,
		gates: Gate[],
		site: SiteDef,
		debug: boolean,
	) {
		this.hot = new Color(track.colors[0]);
		this.cool = new Color(track.colors[1]);
		const frame = new MeshStandardNodeMaterial({
			color: "#1d2129",
			roughness: 0.48,
			metalness: 0.55,
		});
		const foot = new MeshStandardNodeMaterial({
			color: "#3a3f48",
			roughness: 0.7,
			metalness: 0.2,
		});
		const frames = new Group();
		for (const g of gates) {
			const group = new Group();
			const lights = new Group();
			group.position.set(g.cx, 0, g.cz);
			group.quaternion.set(0, g.qy, 0, g.qw);
			const strip = new MeshStandardNodeMaterial({
				color: "#0c0f14",
				roughness: 0.4,
			});
			strip.emissive.set(track.colors[1]);
			strip.emissiveIntensity = 2;
			for (const b of gateBars(g)) {
				const m = new Mesh(
					new BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2),
					frame,
				);
				m.position.set(b.lx, b.ly, 0);
				m.castShadow = true;
				m.receiveShadow = true;
				group.add(m);
			}
			// LED strips lining the opening (inner faces), front and back
			const iw = g.w;
			const ih = g.h;
			const y0 = g.cy;
			const t = 0.04;
			for (const z of [-BAR / 2 - 0.001, BAR / 2 + 0.001]) {
				const top = new Mesh(new BoxGeometry(iw, t, 0.012), strip);
				top.position.set(0, y0 + ih / 2 - t / 2, z);
				const bottom = new Mesh(new BoxGeometry(iw, t, 0.012), strip);
				bottom.position.set(0, y0 - ih / 2 + t / 2, z);
				const left = new Mesh(new BoxGeometry(t, ih, 0.012), strip);
				left.position.set(-iw / 2 + t / 2, y0, z);
				const right = new Mesh(new BoxGeometry(t, ih, 0.012), strip);
				right.position.set(iw / 2 - t / 2, y0, z);
				lights.add(top, bottom, left, right);
			}
			// weighted feet under the legs
			for (const sx of [-1, 1]) {
				const f = new Mesh(new BoxGeometry(0.16, 0.05, 0.42), foot);
				f.position.set(sx * (g.w / 2 + BAR / 2), 0.025, 0);
				f.castShadow = true;
				group.add(f);
			}
			frames.add(group);
			// one draw per gate for its LEDs (its own material, so it lights alone)
			lights.position.copy(group.position);
			lights.quaternion.copy(group.quaternion);
			this.root.add(mergeByMaterial(lights));
			this.gates.push({ strip, light: LIGHT.AFTER, flash: 0 });
		}
		// every frame and foot of the course in two draws
		this.root.add(mergeByMaterial(frames));
		frames.traverse((o) => {
			const m = o as Mesh;
			if (m.isMesh) m.geometry.dispose();
		});
		// launch pad: a carbon plate with a lit ring
		const pad = new Group();
		pad.position.set(track.pad.p[0], 0, track.pad.p[2]);
		const plate = new Mesh(
			new BoxGeometry(0.72, 0.08, 0.72),
			new MeshStandardNodeMaterial({
				color: "#16191f",
				roughness: 0.55,
				metalness: 0.3,
			}),
		);
		plate.position.y = 0.04;
		plate.receiveShadow = true;
		plate.castShadow = true;
		const ringM = new MeshStandardNodeMaterial({ color: "#000000" });
		ringM.emissive.set(track.colors[0]);
		ringM.emissiveIntensity = 2.4;
		const ring = new Mesh(
			new CylinderGeometry(0.3, 0.3, 0.006, 40, 1, true),
			ringM,
		);
		ring.position.y = 0.083;
		const bars = new MeshStandardNodeMaterial({
			color: "#d8dde4",
			roughness: 0.6,
		});
		for (const sx of [-1, 1]) {
			const s = new Mesh(new BoxGeometry(0.05, 0.004, 0.36), bars);
			s.position.set(sx * 0.1, 0.082, 0);
			pad.add(s);
		}
		pad.add(plate, ring);
		this.root.add(pad);
		if (debug) this.root.add(proxyWire(site));
		scene.add(this.root);
	}

	/** Removes the course and frees its geometries and materials (track change). */
	dispose(scene: Scene): void {
		scene.remove(this.root);
		const mats = new Set<Material>();
		this.root.traverse((o) => {
			const m = o as Mesh;
			if (!m.isMesh && !(o as LineSegments).isLineSegments) return;
			m.geometry.dispose();
			for (const mat of Array.isArray(m.material) ? m.material : [m.material])
				mats.add(mat);
		});
		for (const m of mats) m.dispose();
	}

	setLight(i: number, l: Light): void {
		const g = this.gates[i];
		if (g) g.light = l;
	}

	/** Flash a gate white (flown through). */
	flash(i: number): void {
		const g = this.gates[i];
		if (g) g.flash = 1;
	}

	update(dt: number): void {
		this.t += dt;
		const pulse = 0.5 + 0.5 * Math.sin(this.t * 7);
		for (const g of this.gates) {
			let k: number;
			switch (g.light) {
				case LIGHT.NEXT:
					_c.copy(this.hot);
					k = 3 + pulse * 1.6;
					break;
				case LIGHT.AHEAD:
					_c.copy(this.cool);
					k = 2.6;
					break;
				case LIGHT.DONE:
					_c.copy(this.dim);
					k = 1.2;
					break;
				default:
					_c.copy(this.cool);
					k = 2.2;
			}
			if (g.flash > 0) {
				_a.copy(_c);
				_b.set("#ffe6f0");
				_c.copy(_a).lerp(_b, g.flash * 0.6);
				k += g.flash * 3;
				g.flash = Math.max(0, g.flash - dt * 2.5);
			}
			g.strip.emissive.copy(_c);
			g.strip.emissiveIntensity = k;
		}
	}
}

/** Wireframes of the site's proxy colliders and flight volume (`?debug=colliders`). */
function proxyWire(site: SiteDef): Group {
	const g = new Group();
	const m = new LineBasicNodeMaterial({
		color: "#00ff9c",
		depthTest: false,
		transparent: true,
	});
	const add = (c: number[], h: number[]): void => {
		const box = new BoxGeometry(
			(h[0] as number) * 2,
			(h[1] as number) * 2,
			(h[2] as number) * 2,
		);
		const l = new LineSegments(new EdgesGeometry(box), m);
		box.dispose();
		l.position.set(c[0] as number, c[1] as number, c[2] as number);
		l.renderOrder = 10;
		g.add(l);
	};
	for (const p of site.proxies) add(p.c, p.h);
	const { min, max } = site.bounds;
	add(
		[(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
		[(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
	);
	return g;
}
