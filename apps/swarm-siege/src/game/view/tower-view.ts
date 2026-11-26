import {
	AdditiveBlending,
	BoxGeometry,
	type BufferGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DynamicDrawUsage,
	Euler,
	Group,
	IcosahedronGeometry,
	InstancedMesh,
	type Material,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	OctahedronGeometry,
	Quaternion,
	RingGeometry,
	type Scene,
	TorusGeometry,
	Vector3,
} from "three/webgpu";
import { MAX_TOWERS } from "../constants.ts";
import { TOWER, TOWERS } from "../defs.ts";
import { OFF_TOWERS, T_STRIDE } from "../snapshot.ts";

const ceramic = new MeshStandardNodeMaterial({
	color: 0xf4f5ff,
	roughness: 0.3,
	metalness: 0.12,
});
const dark = new MeshStandardNodeMaterial({
	color: 0x2a2d3c,
	roughness: 0.5,
	metalness: 0.6,
});
/** Accent emissive per tower type. */
export const ACCENT = [0x58e8ff, 0xffa040, 0x9ad8ff, 0xc77dff];
const accents = ACCENT.map(
	(c) =>
		new MeshStandardNodeMaterial({
			color: 0x101018,
			emissive: new Color(c),
			emissiveIntensity: 2.6,
			roughness: 0.3,
		}),
);

/** Per-frame animation of a part (its local transform is multiplied by this). */
const ANIM = { NONE: 0, PULSE: 1, SPIN: 2, HALO: 3, PIP2: 4, PIP3: 5 } as const;

interface PartDef {
	geo: BufferGeometry;
	mat: Material;
	head: boolean;
	local: Matrix4;
	anim: number;
	shadow: boolean;
}

const _e = new Euler();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

function mat(
	px: number,
	py: number,
	pz: number,
	rx = 0,
	ry = 0,
	rz = 0,
	sx = 1,
	sy = 1,
	sz = 1,
): Matrix4 {
	return new Matrix4().compose(
		_p.set(px, py, pz),
		_q.setFromEuler(_e.set(rx, ry, rz)),
		_s.set(sx, sy, sz),
	);
}

/** Head pivot height per type. */
const HEAD_Y = [2.1, 1.15, 2.2, 2.45];

function parts(type: number): PartDef[] {
	const acc = accents[type] as Material;
	const out: PartDef[] = [];
	const add = (
		geo: BufferGeometry,
		m: Material,
		head: boolean,
		local: Matrix4,
		anim: number = ANIM.NONE,
		shadow = false,
	): void => {
		out.push({ geo, mat: m, head, local, anim, shadow });
	};
	add(
		new CylinderGeometry(0.95, 1.05, 0.45, 6),
		ceramic,
		false,
		mat(0, 0.22, 0),
		ANIM.NONE,
		true,
	);
	const pip = new BoxGeometry(0.14, 0.14, 0.14);
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
		add(
			pip,
			acc,
			false,
			mat(Math.cos(a) * 0.98, 0.5, Math.sin(a) * 0.98),
			i === 0 ? ANIM.NONE : i === 1 ? ANIM.PIP2 : ANIM.PIP3,
		);
	}
	if (type === TOWER.SPARK) {
		add(
			new CylinderGeometry(0.28, 0.38, 1.5, 8),
			ceramic,
			false,
			mat(0, 1.2, 0),
			ANIM.NONE,
			true,
		);
		add(new IcosahedronGeometry(0.38, 1), acc, true, mat(0, 0, 0), ANIM.PULSE);
		const prong = new ConeGeometry(0.07, 0.6, 4);
		for (let i = 0; i < 3; i++) {
			const a = (i / 3) * Math.PI * 2;
			add(
				prong,
				dark,
				true,
				mat(
					Math.cos(a) * 0.42,
					0.1,
					Math.sin(a) * 0.42,
					Math.sin(a) * 0.5,
					0,
					-Math.cos(a) * 0.5,
				),
			);
		}
	} else if (type === TOWER.MORTAR) {
		add(
			new CylinderGeometry(0.72, 0.8, 0.75, 10),
			ceramic,
			false,
			mat(0, 0.8, 0),
			ANIM.NONE,
			true,
		);
		add(
			new TorusGeometry(0.76, 0.06, 6, 24),
			acc,
			false,
			mat(0, 0.95, 0, Math.PI / 2),
		);
		add(
			new CylinderGeometry(0.22, 0.28, 1.3, 10),
			dark,
			true,
			mat(0, 0.35, 0.3, 0.85),
			ANIM.NONE,
			true,
		);
		add(new BoxGeometry(0.3, 0.3, 0.5), acc, true, mat(0, 0.05, -0.35));
	} else if (type === TOWER.FROST) {
		add(
			new CylinderGeometry(0.28, 0.38, 1.5, 8),
			ceramic,
			false,
			mat(0, 0.95, 0, 0, 0, 0, 0.8, 0.8, 0.8),
			ANIM.NONE,
			true,
		);
		add(
			new OctahedronGeometry(0.55, 0),
			acc,
			true,
			mat(0, 0, 0, 0, 0, 0, 0.8, 1.6, 0.8),
			ANIM.SPIN,
		);
		add(
			new TorusGeometry(0.75, 0.05, 6, 32),
			acc,
			true,
			mat(0, 0, 0, Math.PI / 2),
			ANIM.HALO,
		);
	} else {
		add(
			new BoxGeometry(0.6, 1.9, 0.6),
			ceramic,
			false,
			mat(0, 1.35, 0),
			ANIM.NONE,
			true,
		);
		add(
			new BoxGeometry(0.22, 0.22, 2.0),
			dark,
			true,
			mat(0, 0, 0.5),
			ANIM.NONE,
			true,
		);
		add(new BoxGeometry(0.36, 0.36, 1.1), acc, true, mat(0, 0, 0.4));
	}
	return out;
}

interface Part extends PartDef {
	mesh: InstancedMesh;
}

const _root = new Matrix4();
const _headM = new Matrix4();
const _anim = new Matrix4();
const _tmp = new Matrix4();
const _ry = new Matrix4();

/**
 * Towers drawn with one InstancedMesh per (type, part): about 30 draw calls for any number
 * of towers. Heads turn toward their target and recoil when they fire. Also the selection
 * ring, the Frost field rings and the placement ghost.
 */
export class TowerView {
	private readonly parts: Part[][] = [];
	private readonly aim = new Float32Array(MAX_TOWERS);
	private readonly known = new Int8Array(MAX_TOWERS).fill(-1);
	private readonly ring: Mesh;
	private readonly ghost: Group;
	private readonly ghostMat: MeshBasicNodeMaterial;
	private readonly ghostRing: Mesh;
	private readonly frost: InstancedMesh;
	private t = 0;

	constructor(scene: Scene) {
		for (let ty = 0; ty < TOWERS.length; ty++) {
			const list: Part[] = [];
			for (const d of parts(ty)) {
				const mesh = new InstancedMesh(d.geo, d.mat, MAX_TOWERS);
				mesh.instanceMatrix.setUsage(DynamicDrawUsage);
				mesh.frustumCulled = false;
				mesh.castShadow = d.shadow;
				mesh.receiveShadow = true;
				mesh.count = 0;
				scene.add(mesh);
				list.push({ ...d, mesh });
			}
			this.parts.push(list);
		}
		this.frost = new InstancedMesh(
			new RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
			new MeshBasicNodeMaterial({
				color: new Color(0.25, 0.6, 1.0),
				transparent: true,
				opacity: 0.35,
				blending: AdditiveBlending,
				depthWrite: false,
			}),
			MAX_TOWERS,
		);
		this.frost.frustumCulled = false;
		this.frost.count = 0;
		scene.add(this.frost);
		this.ring = new Mesh(
			new RingGeometry(0.96, 1, 96),
			new MeshBasicNodeMaterial({
				color: new Color(0.6, 1.4, 1.8),
				transparent: true,
				opacity: 0.8,
				blending: AdditiveBlending,
				depthWrite: false,
			}),
		);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.position.y = 0.06;
		this.ring.visible = false;
		scene.add(this.ring);
		this.ghostMat = new MeshBasicNodeMaterial({
			color: new Color(0.3, 1.6, 0.8),
			transparent: true,
			opacity: 0.45,
			blending: AdditiveBlending,
			depthWrite: false,
		});
		this.ghost = new Group();
		const gb = new Mesh(
			new CylinderGeometry(0.95, 1.05, 2.2, 6),
			this.ghostMat,
		);
		gb.position.y = 1.1;
		this.ghost.add(gb);
		this.ghostRing = new Mesh(new RingGeometry(0.95, 1, 96), this.ghostMat);
		this.ghostRing.rotation.x = -Math.PI / 2;
		this.ghost.visible = false;
		this.ghostRing.visible = false;
		scene.add(this.ghostRing, this.ghost);
	}

	/** Ghost at (x, z) for tower `type` (-1 hides it). */
	setGhost(type: number, x: number, z: number, ok: boolean): void {
		const on = type >= 0;
		this.ghost.visible = on;
		this.ghostRing.visible = on;
		if (!on) return;
		this.ghost.position.set(x, 0, z);
		const r = (TOWERS[type]?.range[0] as number) ?? 5;
		this.ghostRing.position.set(x, 0.07, z);
		this.ghostRing.scale.set(r, r, 1);
		if (ok) this.ghostMat.color.setRGB(0.3, 1.6, 0.8);
		else this.ghostMat.color.setRGB(1.8, 0.25, 0.2);
	}

	update(dt: number, snap: Float32Array, selected: number): void {
		this.t += dt;
		this.ring.visible = false;
		for (const list of this.parts) for (const p of list) p.mesh.count = 0;
		let nFrost = 0;
		for (let t = 0; t < MAX_TOWERS; t++) {
			const o = OFF_TOWERS + t * T_STRIDE;
			const type = snap[o] as number;
			if (type < 0) {
				this.known[t] = -1;
				continue;
			}
			const target = snap[o + 4] as number;
			if (this.known[t] !== type) {
				this.known[t] = type;
				this.aim[t] = target;
			}
			const lv = snap[o + 1] as number;
			const x = snap[o + 2] as number;
			const z = snap[o + 3] as number;
			const since = snap[o + 5] as number;
			let d = target - (this.aim[t] as number);
			if (d > Math.PI) d -= Math.PI * 2;
			else if (d < -Math.PI) d += Math.PI * 2;
			const aim = (this.aim[t] as number) + d * Math.min(1, dt * 14);
			this.aim[t] = aim;
			const sc = 1 + 0.1 * (lv - 1);
			_root.compose(_p.set(x, 0, z), _q.identity(), _s.set(sc, sc, sc));
			const kick = Math.max(0, 1 - since / 10);
			const recoil =
				type === TOWER.MORTAR || type === TOWER.LANCE ? -kick * 0.18 : 0;
			_headM.makeTranslation(0, HEAD_Y[type] as number, 0);
			_ry.makeRotationY(aim);
			_headM.multiply(_ry);
			_headM.multiply(_tmp.makeTranslation(0, 0, recoil));
			_headM.premultiply(_root);
			for (const p of this.parts[type] as Part[]) {
				const a = p.anim;
				if ((a === ANIM.PIP2 && lv < 2) || (a === ANIM.PIP3 && lv < 3))
					continue;
				const base = p.head ? _headM : _root;
				if (a === ANIM.PULSE) {
					const s = 1 + kick * 0.35;
					_anim.makeScale(s, s, s);
					_tmp.multiplyMatrices(base, _anim).multiply(p.local);
				} else if (a === ANIM.SPIN) {
					_anim.makeRotationY(this.t * 1.5 - aim);
					_tmp.multiplyMatrices(base, _anim).multiply(p.local);
				} else if (a === ANIM.HALO) {
					const hs = 1 + Math.max(0, 1 - since / 20) * 0.6;
					_anim.compose(
						_p.set(0, Math.sin(this.t * 2 + t) * 0.15, 0),
						_q.identity(),
						_s.set(hs, hs, hs),
					);
					_tmp.multiplyMatrices(base, _anim).multiply(p.local);
				} else _tmp.multiplyMatrices(base, p.local);
				const m = p.mesh;
				m.setMatrixAt(m.count, _tmp);
				m.count++;
			}
			if (type === TOWER.FROST) {
				const r = TOWERS[TOWER.FROST]?.range[lv - 1] as number;
				_tmp.compose(_p.set(x, 0.05, z), _q.identity(), _s.set(r, 1, r));
				this.frost.setMatrixAt(nFrost++, _tmp);
			}
			if (t === selected) {
				const r = TOWERS[type]?.range[lv - 1] as number;
				this.ring.visible = true;
				this.ring.position.set(x, 0.06, z);
				this.ring.scale.set(r, r, 1);
			}
		}
		for (const list of this.parts)
			for (const p of list)
				if (p.mesh.count > 0) p.mesh.instanceMatrix.needsUpdate = true;
		this.frost.count = nFrost;
		if (nFrost > 0) this.frost.instanceMatrix.needsUpdate = true;
	}
}
