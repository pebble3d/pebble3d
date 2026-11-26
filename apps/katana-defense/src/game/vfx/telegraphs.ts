import { float, length, positionLocal, smoothstep, vec3 } from "three/tsl";
import {
	AdditiveBlending,
	CircleGeometry,
	Color,
	DynamicDrawUsage,
	InstancedMesh,
	Matrix4,
	MeshBasicNodeMaterial,
	Quaternion,
	type Scene,
	Vector3,
} from "three/webgpu";
import type { Archetype } from "../ai/archetypes.ts";
import { MAX_ZOMBIES } from "../constants.ts";
import { type GameSim, ZS } from "../sim.ts";

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Color();
const UP = new Vector3(0, 1, 0);

/**
 * Readable enemy wind-ups: every zombie in WINDUP draws its strike area on the ground,
 * filling from the zombie outward as the strike approaches (a sector for swipes, a full
 * disc for the brute's slam), red and pulsing near the end.
 */
export class Telegraphs {
	private readonly sectors: InstancedMesh;
	private readonly discs: InstancedMesh;
	private readonly sim: GameSim;
	private t = 0;

	constructor(scene: Scene, sim: GameSim) {
		this.sim = sim;
		const mat = (): MeshBasicNodeMaterial => {
			const m = new MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
			});
			const r = length(positionLocal.xz);
			// bright rim, faint fill
			m.colorNode = vec3(1, 1, 1).mul(
				float(0.28)
					.add(smoothstep(0.82, 0.97, r).mul(1.1))
					.mul(float(1).sub(smoothstep(0.97, 1, r))),
			);
			return m;
		};
		// sector spanning +-55 deg around +Z (built in XY, rotated flat)
		const arc = (110 * Math.PI) / 180;
		const sg = new CircleGeometry(1, 24, Math.PI / 2 - arc / 2, arc);
		sg.rotateX(-Math.PI / 2);
		sg.rotateY(Math.PI); // face +Z after the flat rotation
		const dg = new CircleGeometry(1, 48);
		dg.rotateX(-Math.PI / 2);
		const mk = (g: CircleGeometry): InstancedMesh => {
			const m = new InstancedMesh(g, mat(), MAX_ZOMBIES);
			m.instanceMatrix.setUsage(DynamicDrawUsage);
			m.setColorAt(0, _c.set(1, 0, 0));
			m.instanceColor?.setUsage(DynamicDrawUsage);
			m.frustumCulled = false;
			m.count = 0;
			m.renderOrder = 3;
			scene.add(m);
			return m;
		};
		this.sectors = mk(sg);
		this.discs = mk(dg);
	}

	update(dt: number, alpha: number): void {
		this.t += dt;
		let ns = 0;
		let nd = 0;
		for (const z of this.sim.zombies) {
			if (!z.alive || z.state !== ZS.WINDUP) continue;
			const a = this.sim.archetypes[z.type] as Archetype;
			const prog = 1 - z.stateT / a.windup;
			const ease = prog * prog * (3 - 2 * prog);
			const radius = a.slam ? a.reach + a.radius : a.reach + a.radius + 0.25;
			const pulse = prog > 0.7 ? 0.75 + 0.25 * Math.sin(this.t * 40) : 1;
			const k = (0.35 + 0.9 * ease) * pulse;
			_c.setRGB(1.6 * k, 0.16 * k, 0.06 * k);
			_p.set(z.px + (z.x - z.px) * alpha, 0.04, z.pz + (z.z - z.pz) * alpha);
			const r = radius * (0.25 + 0.75 * ease);
			_s.set(r, 1, r);
			if (a.slam) {
				_q.identity();
				_m.compose(_p, _q, _s);
				this.discs.setMatrixAt(nd, _m);
				this.discs.setColorAt(nd, _c);
				nd++;
			} else {
				_q.setFromAxisAngle(UP, z.heading);
				_m.compose(_p, _q, _s);
				this.sectors.setMatrixAt(ns, _m);
				this.sectors.setColorAt(ns, _c);
				ns++;
			}
		}
		flush(this.sectors, ns);
		flush(this.discs, nd);
	}
}

function flush(m: InstancedMesh, n: number): void {
	m.count = n;
	m.instanceMatrix.needsUpdate = true;
	if (m.instanceColor) m.instanceColor.needsUpdate = true;
}
