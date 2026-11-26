import { readSlot } from "@pebble3d/renderer";
import {
	color,
	float,
	mx_noise_float,
	positionLocal,
	positionWorld,
	smoothstep,
} from "three/tsl";
import {
	AdditiveBlending,
	Color,
	CylinderGeometry,
	DynamicDrawUsage,
	Group,
	IcosahedronGeometry,
	InstancedMesh,
	Matrix4,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	Quaternion,
	RingGeometry,
	Vector3,
} from "three/webgpu";
import type { TileDef } from "../arena.ts";
import { RINGS, TILE } from "../constants.ts";
import { Rng } from "../rng.ts";
import type { RoundSim } from "../sim.ts";

const _m = new Matrix4();
const _local = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _c = new Color();
const ZERO = new Matrix4().makeScale(0, 0, 0);

const BASALT = new Color("#3b3540");
const BASALT_HI = new Color("#5a5060");
const EMBER = new Color("#ff5a1f");
const SEAM = new Color("#57e1ff");

/**
 * The floating basalt arena: one InstancedMesh each for the tile slabs, the columns hanging
 * under them and the glowing seams, driven from the round's kinematic tile slots. Plus the
 * static set dressing (distant islands, drifting embers). Allocation-free per frame.
 */
export class ArenaView {
	readonly root = new Group();
	private readonly caps: InstancedMesh;
	private readonly roots: InstancedMesh;
	private readonly seams: InstancedMesh;
	private readonly motes: InstancedMesh;
	private readonly rootLocal: Matrix4[] = [];
	private readonly seamLocal = new Matrix4();
	private readonly capTint: Color[] = [];
	private readonly n: number;
	/** The three per-tile instanced meshes (hoisted: no array literal per frame). */
	private readonly live: InstancedMesh[];
	private readonly moteX: Float32Array;
	private readonly moteY: Float32Array;
	private readonly moteZ: Float32Array;
	private readonly moteV: Float32Array;
	private time = 0;

	constructor(tiles: TileDef[]) {
		const n = tiles.length;
		this.n = n;
		const R = TILE.radius;
		const H = TILE.height;
		const rng = new Rng(77);

		// slab: a hex prism (a 6-sided cylinder lines up with pointy-top hexes)
		const capGeo = new CylinderGeometry(R * 0.965, R * 0.9, H, 6, 1);
		const capMat = new MeshStandardNodeMaterial({
			roughness: 0.82,
			metalness: 0,
			flatShading: true,
		});
		// speckled basalt with a lighter worn top edge
		const speck = mx_noise_float(positionWorld.mul(2.7)).mul(0.5).add(0.5);
		const top = smoothstep(float(H * 0.3), float(H * 0.5), positionLocal.y);
		capMat.colorNode = color(1, 1, 1)
			.mul(speck.mul(0.35).add(0.75))
			.mul(top.mul(0.35).add(0.85));
		this.caps = new InstancedMesh(capGeo, capMat, n);
		this.caps.castShadow = true;
		this.caps.receiveShadow = true;

		// hanging columns: top at y = 0, tapering to a point-ish base at y = -1 (scaled per tile)
		const rootGeo = new CylinderGeometry(R * 0.88, R * 0.28, 1, 6, 3);
		rootGeo.translate(0, -0.5, 0);
		const rootMat = new MeshStandardNodeMaterial({
			roughness: 0.9,
			metalness: 0,
			flatShading: true,
		});
		const strata = mx_noise_float(
			positionWorld.mul(float(1.3)).mul(color(0.6, 3.5, 0.6)),
		)
			.mul(0.5)
			.add(0.5);
		const glow = smoothstep(float(-6), float(-14), positionWorld.y);
		rootMat.colorNode = color("#2a2430").mul(strata.mul(0.5).add(0.6));
		rootMat.emissiveNode = color("#ff5a2a").mul(glow.mul(0.25));
		this.roots = new InstancedMesh(rootGeo, rootMat, n);
		this.roots.castShadow = true;

		// seams: a thin glowing hex outline on each slab's top
		const seamGeo = new RingGeometry(R * 0.86, R * 0.95, 6, 1, Math.PI / 6);
		seamGeo.rotateX(-Math.PI / 2);
		const seamMat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		this.seams = new InstancedMesh(seamGeo, seamMat, n);
		this.seamLocal.makeTranslation(0, H / 2 + 0.004, 0);

		for (let i = 0; i < n; i++) {
			const t = tiles[i] as TileDef;
			this.rootLocal.push(
				new Matrix4().compose(
					_p.set(0, -H / 2 + 0.02, 0),
					_q.identity(),
					_s.set(1, t.root, 1),
				),
			);
			const tint = BASALT.clone().lerp(
				BASALT_HI,
				rng.next() * 0.8 + (t.ring === 0 ? 0.3 : 0),
			);
			this.capTint.push(tint);
			this.caps.setColorAt(i, tint);
			this.seams.setColorAt(i, _c.copy(SEAM).multiplyScalar(0.3));
		}
		_s.set(1, 1, 1);
		for (const m of [this.caps, this.roots, this.seams]) {
			m.instanceMatrix.setUsage(DynamicDrawUsage);
			m.instanceColor?.setUsage(DynamicDrawUsage);
			m.frustumCulled = false;
		}
		this.root.add(this.caps, this.roots, this.seams);
		this.live = [this.caps, this.roots, this.seams];

		// distant floating islands (static)
		const isl: Matrix4[] = [];
		for (let k = 0; k < 11; k++) {
			const a = (k / 11) * Math.PI * 2 + rng.range(-0.15, 0.15);
			const r = rng.range(42, 70);
			const cx = Math.cos(a) * r;
			const cz = Math.sin(a) * r;
			const cy = rng.range(-22, -6);
			const cols = 4 + Math.floor(rng.next() * 6);
			const sc = rng.range(0.9, 1.7);
			for (let c = 0; c < cols; c++) {
				const ca = rng.next() * Math.PI * 2;
				const cr = rng.next() * 1.6 * sc;
				const len = rng.range(2, 7) * sc;
				isl.push(
					new Matrix4().compose(
						_p.set(
							cx + Math.cos(ca) * cr,
							cy + rng.range(-0.4, 0.4) * sc,
							cz + Math.sin(ca) * cr,
						),
						_q.identity(),
						_s.set(sc, len, sc),
					),
				);
			}
		}
		_s.set(1, 1, 1);
		const islands = new InstancedMesh(rootGeo, rootMat, isl.length);
		const islandTops = new InstancedMesh(capGeo, capMat, isl.length);
		for (let i = 0; i < isl.length; i++) {
			const m = isl[i] as Matrix4;
			islands.setMatrixAt(i, m);
			_m.copy(m);
			const e = _m.elements;
			// slab on top: same x/z scale, unit-ish height
			_local.makeScale(1, 1 / (e[5] as number), 1);
			_m.multiply(_local);
			_m.multiply(_local.makeTranslation(0, -H / 2 + 0.3, 0));
			islandTops.setMatrixAt(i, _m);
			islandTops.setColorAt(i, BASALT);
		}
		this.root.add(islands, islandTops);

		// drifting embers rising out of the abyss
		const MOTES = 160;
		this.moteX = new Float32Array(MOTES);
		this.moteY = new Float32Array(MOTES);
		this.moteZ = new Float32Array(MOTES);
		this.moteV = new Float32Array(MOTES);
		const moteMat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		this.motes = new InstancedMesh(
			new IcosahedronGeometry(0.05, 0),
			moteMat,
			MOTES,
		);
		this.motes.frustumCulled = false;
		this.motes.instanceMatrix.setUsage(DynamicDrawUsage);
		for (let i = 0; i < MOTES; i++) {
			const a = rng.next() * Math.PI * 2;
			const r = rng.range(3, 26);
			this.moteX[i] = Math.cos(a) * r;
			this.moteZ[i] = Math.sin(a) * r;
			this.moteY[i] = rng.range(-18, 10);
			this.moteV[i] = rng.range(0.3, 1.1);
			this.motes.setColorAt(
				i,
				_c.set("#ff9a5a").multiplyScalar(rng.range(1.5, 4)),
			);
		}
		this.root.add(this.motes);
	}

	/** Pose every tile from the round's state buffers; warn/drop tint from its schedule. */
	update(sim: RoundSim, alpha: number, dt: number): void {
		this.time += dt;
		const v = sim.views;
		const ft = sim.fightTick;
		for (let i = 0; i < this.n; i++) {
			const slot = sim.tileSlots[i] as number;
			if (slot < 0 || !readSlot(v.prev, v.curr, slot, alpha, _p, _q)) {
				this.caps.setMatrixAt(i, ZERO);
				this.roots.setMatrixAt(i, ZERO);
				this.seams.setMatrixAt(i, ZERO);
				continue;
			}
			_m.compose(_p, _q, _s);
			this.caps.setMatrixAt(i, _m);
			this.roots.setMatrixAt(
				i,
				_local.multiplyMatrices(_m, this.rootLocal[i] as Matrix4),
			);
			this.seams.setMatrixAt(i, _local.multiplyMatrices(_m, this.seamLocal));
			const t = sim.tiles[i] as TileDef;
			const tint = this.capTint[i] as Color;
			let warn = 0;
			if (ft >= t.dropTick) warn = 1;
			else if (ft >= t.warnTick)
				warn = (ft - t.warnTick) / (t.dropTick - t.warnTick);
			if (warn > 0) {
				const pulse = 0.55 + 0.45 * Math.sin(this.time * (8 + warn * 10));
				this.caps.setColorAt(i, _c.copy(tint).lerp(EMBER, warn * 0.45 * pulse));
				this.seams.setColorAt(
					i,
					_c.copy(EMBER).multiplyScalar(0.6 + warn * 4 * pulse),
				);
			} else {
				this.caps.setColorAt(i, tint);
				// a slow ripple of light from the centre out keeps the arena alive
				const wave = 0.5 + 0.5 * Math.sin(this.time * 1.6 - t.ring * 0.9);
				const edge = t.ring === RINGS - 1 - sim.collapsed ? 0.25 : 0;
				this.seams.setColorAt(
					i,
					_c.copy(SEAM).multiplyScalar(0.18 + wave * 0.28 + edge),
				);
			}
		}
		for (const m of this.live) {
			m.instanceMatrix.needsUpdate = true;
			if (m.instanceColor) m.instanceColor.needsUpdate = true;
		}
		// embers
		for (let i = 0; i < this.moteX.length; i++) {
			let y = (this.moteY[i] as number) + (this.moteV[i] as number) * dt;
			if (y > 10) y = -18;
			this.moteY[i] = y;
			const sway = Math.sin(this.time * 0.7 + i) * 0.4;
			const k = Math.min(1, (10 - y) / 4, (y + 18) / 4);
			_p.set((this.moteX[i] as number) + sway, y, this.moteZ[i] as number);
			_s.setScalar(Math.max(0, k));
			_m.compose(_p, _q.identity(), _s);
			this.motes.setMatrixAt(i, _m);
		}
		_s.set(1, 1, 1);
		this.motes.instanceMatrix.needsUpdate = true;
	}
}
