/**
 * A jointed wooden artist's mannequin wearing a cloth gi and belt, built from primitives.
 * The rig is position-based: every frame `apply(solved)` places each segment between two
 * solved joints and orients the torso pieces from the solved frames. No skinning, no assets.
 */
import {
	BoxGeometry,
	type BufferGeometry,
	CanvasTexture,
	Color,
	CylinderGeometry,
	Group,
	Matrix4,
	Mesh,
	MeshStandardNodeMaterial,
	Quaternion,
	RepeatWrapping,
	SphereGeometry,
	SRGBColorSpace,
	TorusGeometry,
	Vector3,
} from "three/webgpu";
import { J, type Solved } from "./body.ts";

export interface Look {
	gi: string;
	belt: string;
	/** Black belts get a red bar near the tip. */
	bar?: string;
}

const Y = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();
const _l = new Vector3();
const _u = new Vector3();
const _f = new Vector3();
const _s = new Vector3();

let woodTex: CanvasTexture | null = null;
let weaveTex: CanvasTexture | null = null;

/** Procedural wood grain: warm stripes with soft noise. Seeded, so identical every run. */
function woodTexture(): CanvasTexture {
	if (woodTex) return woodTex;
	const c = document.createElement("canvas");
	c.width = 128;
	c.height = 256;
	const g = c.getContext("2d") as CanvasRenderingContext2D;
	g.fillStyle = "#c99a66";
	g.fillRect(0, 0, 128, 256);
	let s = 12345;
	const rnd = (): number => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647;
	};
	for (let i = 0; i < 46; i++) {
		const x = rnd() * 128;
		const w = 0.6 + rnd() * 2.2;
		g.strokeStyle = `rgba(${120 + rnd() * 30},${78 + rnd() * 20},${44},${0.12 + rnd() * 0.2})`;
		g.lineWidth = w;
		g.beginPath();
		for (let y = 0; y <= 256; y += 16) {
			const xx = x + Math.sin(y * 0.03 + i) * 3 + (rnd() - 0.5) * 1.5;
			if (y === 0) g.moveTo(xx, y);
			else g.lineTo(xx, y);
		}
		g.stroke();
	}
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	t.wrapS = RepeatWrapping;
	t.wrapT = RepeatWrapping;
	woodTex = t;
	return t;
}

/** Cloth weave: faint crossing threads, tinted by the material colour. */
function weaveTexture(): CanvasTexture {
	if (weaveTex) return weaveTex;
	const c = document.createElement("canvas");
	c.width = 64;
	c.height = 64;
	const g = c.getContext("2d") as CanvasRenderingContext2D;
	g.fillStyle = "#ffffff";
	g.fillRect(0, 0, 64, 64);
	for (let i = 0; i < 64; i += 4) {
		g.fillStyle = "rgba(0,0,0,0.07)";
		g.fillRect(i, 0, 2, 64);
		g.fillStyle = "rgba(0,0,0,0.05)";
		g.fillRect(0, i + 1, 64, 2);
	}
	const t = new CanvasTexture(c);
	t.colorSpace = SRGBColorSpace;
	t.wrapS = RepeatWrapping;
	t.wrapT = RepeatWrapping;
	t.repeat.set(3, 3);
	weaveTex = t;
	return t;
}

interface Seg {
	mesh: Mesh;
	a: number;
	b: number;
	/** Fraction of the a→b span covered, from `from` to `to`. */
	from: number;
	to: number;
	r: number;
}
interface Ball {
	mesh: Mesh;
	j: number;
}

const cyl = new CylinderGeometry(1, 1, 1, 14, 1, false);
const cylTaper = new CylinderGeometry(0.86, 1, 1, 14, 1, false);
const sph = new SphereGeometry(1, 20, 14);
const box = new BoxGeometry(1, 1, 1);
const torus = new TorusGeometry(1, 0.13, 8, 28);
const skirtGeo = new CylinderGeometry(1, 1.16, 1, 18, 1, true);

export class Mannequin {
	readonly root = new Group();
	private readonly segs: Seg[] = [];
	private readonly balls: Ball[] = [];
	private readonly chest: Mesh;
	private readonly belly: Mesh;
	private readonly hips: Mesh;
	private readonly skirt: Mesh;
	private readonly belt: Mesh;
	private readonly knot: Mesh;
	private readonly tailA: Mesh;
	private readonly tailB: Mesh;
	private readonly lapelL: Mesh;
	private readonly lapelR: Mesh;
	private readonly head: Mesh;
	private readonly handL: Mesh;
	private readonly handR: Mesh;
	private readonly footL: Mesh;
	private readonly footR: Mesh;
	readonly wood: MeshStandardNodeMaterial;
	readonly cloth: MeshStandardNodeMaterial;
	readonly beltMat: MeshStandardNodeMaterial;
	private readonly flashColor = new Color();
	private readonly baseEmissive = new Color(0, 0, 0);

	constructor(look: Look) {
		this.wood = new MeshStandardNodeMaterial({
			map: woodTexture(),
			roughness: 0.42,
			metalness: 0,
		});
		const joint = new MeshStandardNodeMaterial({
			map: woodTexture(),
			color: new Color("#b58552"),
			roughness: 0.35,
		});
		this.cloth = new MeshStandardNodeMaterial({
			color: new Color(look.gi),
			map: weaveTexture(),
			roughness: 0.92,
		});
		const lapel = new MeshStandardNodeMaterial({
			color: new Color(look.gi).multiplyScalar(0.86),
			map: weaveTexture(),
			roughness: 0.95,
		});
		this.beltMat = new MeshStandardNodeMaterial({
			color: new Color(look.belt),
			roughness: 0.7,
		});
		const mk = (geo: BufferGeometry, mat: MeshStandardNodeMaterial): Mesh => {
			const m = new Mesh(geo, mat);
			m.castShadow = false;
			m.receiveShadow = true;
			m.matrixAutoUpdate = true;
			this.root.add(m);
			return m;
		};
		const seg = (
			a: number,
			b: number,
			r: number,
			mat: MeshStandardNodeMaterial,
			from = 0,
			to = 1,
			taper = false,
		): void => {
			this.segs.push({
				mesh: mk(taper ? cylTaper : cyl, mat),
				a,
				b,
				from,
				to,
				r,
			});
		};
		const ball = (
			j: number,
			r: number,
			mat: MeshStandardNodeMaterial,
		): void => {
			const m = mk(sph, mat);
			m.scale.setScalar(r);
			this.balls.push({ mesh: m, j });
		};
		// wooden limbs under the gi (visible past the cuffs)
		seg(J.elL, J.wrL, 0.036, this.wood);
		seg(J.elR, J.wrR, 0.036, this.wood);
		seg(J.knL, J.anL, 0.045, this.wood);
		seg(J.knR, J.anR, 0.045, this.wood);
		seg(J.neck, J.head, 0.042, this.wood, 0, 0.5);
		// gi: sleeves to mid-forearm, pants to mid-shin
		seg(J.shL, J.elL, 0.064, this.cloth, -0.05, 1.02, true);
		seg(J.shR, J.elR, 0.064, this.cloth, -0.05, 1.02, true);
		seg(J.elL, J.wrL, 0.058, this.cloth, -0.02, 0.55);
		seg(J.elR, J.wrR, 0.058, this.cloth, -0.02, 0.55);
		seg(J.hipL, J.knL, 0.083, this.cloth, -0.04, 1.02, true);
		seg(J.hipR, J.knR, 0.083, this.cloth, -0.04, 1.02, true);
		seg(J.knL, J.anL, 0.066, this.cloth, -0.02, 0.62);
		seg(J.knR, J.anR, 0.066, this.cloth, -0.02, 0.62);
		// joint balls: wood where the mannequin shows, cloth where the gi covers
		ball(J.wrL, 0.04, joint);
		ball(J.wrR, 0.04, joint);
		ball(J.anL, 0.048, joint);
		ball(J.anR, 0.048, joint);
		ball(J.neck, 0.05, joint);
		ball(J.elL, 0.064, this.cloth);
		ball(J.elR, 0.064, this.cloth);
		ball(J.knL, 0.083, this.cloth);
		ball(J.knR, 0.083, this.cloth);
		ball(J.shL, 0.075, this.cloth);
		ball(J.shR, 0.075, this.cloth);
		ball(J.hipL, 0.088, this.cloth);
		ball(J.hipR, 0.088, this.cloth);
		this.chest = mk(sph, this.cloth);
		this.belly = mk(sph, this.cloth);
		this.hips = mk(sph, this.cloth);
		this.skirt = mk(skirtGeo, this.cloth);
		this.lapelL = mk(box, lapel);
		this.lapelR = mk(box, lapel);
		this.belt = mk(torus, this.beltMat);
		this.knot = mk(box, this.beltMat);
		const tailMat = look.bar
			? new MeshStandardNodeMaterial({
					color: new Color(look.bar),
					roughness: 0.7,
				})
			: this.beltMat;
		this.tailA = mk(box, tailMat);
		this.tailB = mk(box, this.beltMat);
		this.head = mk(sph, this.wood);
		this.handL = mk(sph, this.wood);
		this.handR = mk(sph, this.wood);
		this.footL = mk(sph, this.wood);
		this.footR = mk(sph, this.wood);
		// only the big shapes cast: every caster is drawn once per shadow cascade
		for (const m of [this.chest, this.belly, this.hips, this.head])
			m.castShadow = true;
		for (const sg of this.segs)
			if (sg.mesh.material === this.cloth && sg.r > 0.06)
				sg.mesh.castShadow = true;
	}

	/** Emissive flash (a landed move, a tap). 0 = off. */
	flash(amount: number, color: string): void {
		this.flashColor.set(color).multiplyScalar(amount);
		this.cloth.emissive.copy(this.baseEmissive).add(this.flashColor);
	}

	setBelt(belt: string): void {
		this.beltMat.color.set(belt);
	}

	apply(s: Solved): void {
		this.cur = s;
		const j = s.j;
		const P = (k: number, out: Vector3): Vector3 =>
			out.set(
				j[k * 3] as number,
				j[k * 3 + 1] as number,
				j[k * 3 + 2] as number,
			);
		for (const sg of this.segs) {
			P(sg.a, _a);
			P(sg.b, _b);
			_d.subVectors(_b, _a);
			const len = _d.length();
			if (len < 1e-5) continue;
			_d.multiplyScalar(1 / len);
			const l0 = sg.from * len;
			const l1 = sg.to * len;
			sg.mesh.position.copy(_a).addScaledVector(_d, (l0 + l1) * 0.5);
			sg.mesh.quaternion.setFromUnitVectors(Y, _d);
			sg.mesh.scale.set(sg.r, Math.max(0.001, l1 - l0), sg.r);
		}
		for (const b of this.balls) P(b.j, b.mesh.position);
		const f = s.f;
		// frames: pelvis (right 0, up 1, fwd 2), chest (3, 4, 5), head up 6
		const basis = (ri: number, ui: number, fi: number): void => {
			_l.set(
				-(f[ri * 3] as number),
				-(f[ri * 3 + 1] as number),
				-(f[ri * 3 + 2] as number),
			);
			_u.set(
				f[ui * 3] as number,
				f[ui * 3 + 1] as number,
				f[ui * 3 + 2] as number,
			);
			_f.set(
				f[fi * 3] as number,
				f[fi * 3 + 1] as number,
				f[fi * 3 + 2] as number,
			);
			_m.makeBasis(_l, _u, _f);
			_q.setFromRotationMatrix(_m);
		};
		// chest: a broad ellipsoid at the shoulders' level
		basis(3, 4, 5);
		P(J.chest, this.chest.position).addScaledVector(_u, 0.06);
		this.chest.quaternion.copy(_q);
		this.chest.scale.set(0.185, 0.17, 0.125);
		// lapels: two bands crossing into a V on the chest front
		for (const [mesh, side] of [
			[this.lapelL, -1],
			[this.lapelR, 1],
		] as [Mesh, number][]) {
			mesh.position
				.copy(this.chest.position)
				.addScaledVector(_f, 0.112)
				.addScaledVector(_l, side * 0.045)
				.addScaledVector(_u, 0.02);
			mesh.quaternion.copy(_q);
			_s.set(0, 0, 1);
			mesh.rotateOnAxis(_s, -side * 0.38);
			mesh.scale.set(0.05, 0.27, 0.03);
		}
		// pelvis and belly
		basis(0, 1, 2);
		P(J.pelvis, this.hips.position).addScaledVector(_u, -0.01);
		this.hips.quaternion.copy(_q);
		this.hips.scale.set(0.165, 0.12, 0.12);
		P(J.pelvis, _a);
		P(J.chest, _b);
		this.belly.position.lerpVectors(_a, _b, 0.45);
		this.belly.quaternion.copy(_q);
		this.belly.scale.set(0.145, 0.16, 0.112);
		// jacket skirt flares below the belt
		this.skirt.position.copy(_a).addScaledVector(_u, -0.0);
		this.skirt.quaternion.copy(_q);
		this.skirt.scale.set(0.158, 0.13, 0.124);
		// belt: an ellipse around the waist, knot in front, tails hanging
		this.belt.position.copy(_a).addScaledVector(_u, 0.075);
		this.belt.quaternion.copy(_q);
		_s.set(1, 0, 0);
		this.belt.rotateOnAxis(_s, Math.PI / 2);
		this.belt.scale.set(0.152, 0.122, 0.16);
		this.knot.position
			.copy(_a)
			.addScaledVector(_u, 0.075)
			.addScaledVector(_f, 0.128);
		this.knot.quaternion.copy(_q);
		this.knot.scale.set(0.05, 0.035, 0.03);
		for (const [mesh, side] of [
			[this.tailA, -1],
			[this.tailB, 1],
		] as [Mesh, number][]) {
			mesh.position
				.copy(_a)
				.addScaledVector(_u, 0.0)
				.addScaledVector(_f, 0.135)
				.addScaledVector(_l, side * 0.03);
			mesh.quaternion.copy(_q);
			_s.set(0, 0, 1);
			mesh.rotateOnAxis(_s, side * 0.18);
			mesh.scale.set(0.034, 0.15, 0.012);
		}
		// head: a wooden egg on the neck
		P(J.head, this.head.position);
		_u.set(f[18] as number, f[19] as number, f[20] as number);
		this.head.quaternion.setFromUnitVectors(Y, _u);
		this.head.scale.set(0.098, 0.122, 0.108);
		// hands and feet: wooden mitts along the forearm / ankle→toe
		this.mitt(this.handL, J.wrL, J.handL, 0.05, 0.036, 0.075);
		this.mitt(this.handR, J.wrR, J.handR, 0.05, 0.036, 0.075);
		this.mitt(this.footL, J.anL, J.toeL, 0.05, 0.04, 0.11);
		this.mitt(this.footR, J.anR, J.toeR, 0.05, 0.04, 0.11);
	}

	private mitt(
		m: Mesh,
		a: number,
		b: number,
		w: number,
		t: number,
		l: number,
	): void {
		const s = this.cur;
		if (!s) return;
		const jj = s.j;
		_a.set(
			jj[a * 3] as number,
			jj[a * 3 + 1] as number,
			jj[a * 3 + 2] as number,
		);
		_b.set(
			jj[b * 3] as number,
			jj[b * 3 + 1] as number,
			jj[b * 3 + 2] as number,
		);
		_d.subVectors(_b, _a).normalize();
		m.position.copy(_a).addScaledVector(_d, l * 0.55);
		m.quaternion.setFromUnitVectors(Y, _d);
		m.scale.set(w, l * 0.62, t);
	}
	private cur: Solved | null = null;
}
