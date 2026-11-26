import {
	abs,
	attribute,
	float,
	length,
	max,
	mix,
	positionGeometry,
	smoothstep,
	vec3,
} from "three/tsl";
import {
	CircleGeometry,
	Color,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	InstancedMesh,
	MeshBasicNodeMaterial,
	type Scene,
} from "three/webgpu";
import { KIND, ROCK_KINDS } from "../rocks.ts";
import type { RockfallSim } from "../sim.ts";

const MAX_RINGS = 384;
/** Rings show this long before impact (s). */
const LEAD = 2.6;
const G = 9.81;
/** The landing circle sits at this fraction of the instance radius; the closing ring starts at 1. */
const INNER = 0.42;
const TINTS = ROCK_KINDS.map((k) => new Color(k.tint));

/**
 * Impact telegraphs. For every falling rock (not pebbles) a marker on the ground where it
 * will land, predicted ballistically from its interpolated position and velocity (slanted
 * meteors are marked where they will hit, not under them), at the height of whatever lies
 * below (an engine raycast, so markers sit on top of the rubble). Each marker is a dark
 * "shadow" core that deepens as the rock nears, a fixed landing circle, and a closing ring
 * that shrinks onto it at impact. Per-instance tint and progress ride in one vec4 attribute.
 */
export class TelegraphView {
	private readonly mesh: InstancedMesh;
	private readonly attr: InstancedBufferAttribute;
	private readonly sim: RockfallSim;
	/** Number of markers drawn last frame (diagnostics, audio). */
	count = 0;

	constructor(scene: Scene, sim: RockfallSim) {
		this.sim = sim;
		const g = new CircleGeometry(1, 56);
		g.rotateX(-Math.PI / 2);
		this.attr = new InstancedBufferAttribute(
			new Float32Array(MAX_RINGS * 4),
			4,
		);
		this.attr.setUsage(DynamicDrawUsage);
		g.setAttribute("ringData", this.attr);
		const data = attribute<"vec4">("ringData", "vec4");
		const tint = data.xyz;
		const k = data.w;
		const r = length(positionGeometry.xz);
		// biome-ignore lint/suspicious/noExplicitAny: TSL node arithmetic types are too narrow here
		const line = (at: any, w: number) =>
			float(1).sub(smoothstep(0, w, abs(r.sub(at))));
		const landing = line(float(INNER), 0.06);
		const closing = line(mix(float(1), float(INNER), k), 0.075);
		const core = float(1).sub(smoothstep(INNER * 0.25, INNER * 0.95, r));
		const m = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
		});
		const glow = tint.mul(k.mul(3.2).add(0.9));
		m.colorNode = mix(vec3(0.05, 0.03, 0.02), glow, max(landing, closing));
		m.opacityNode = max(
			max(landing.mul(k.mul(0.4).add(0.6)), closing.mul(k.mul(0.6).add(0.4))),
			core.mul(k.mul(k).mul(0.6).add(0.15)),
		);
		this.mesh = new InstancedMesh(g, m, MAX_RINGS);
		this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.count = 0;
		this.mesh.renderOrder = 3;
		scene.add(this.mesh);
	}

	update(_dt: number, alpha: number): void {
		const sim = this.sim;
		const c = sim.views.curr;
		const p = sim.views.prev;
		const w = sim.world;
		const sc = sim.views.scratch;
		const e = this.mesh.instanceMatrix.array as Float32Array;
		const d = this.attr.array as Float32Array;
		let n = 0;
		for (let i = 0; i < sim.rockCount && n < MAX_RINGS; i++) {
			const kind = sim.rockKind[i] as number;
			if (kind === KIND.PEBBLE) continue;
			const o = (sim.rockSlot[i] as number) * 8;
			const cy = c[o + 1] as number;
			const py = p[o + 1] as number;
			const vy = (cy - py) * 60;
			if (vy > -1.5 || cy < 1.2) continue;
			const cx = c[o] as number;
			const cz = c[o + 2] as number;
			const px = p[o] as number;
			const pz = p[o + 2] as number;
			const x = px + (cx - px) * alpha;
			const y = py + (cy - py) * alpha;
			const z = pz + (cz - pz) * alpha;
			const vx = (cx - px) * 60;
			const vz = (cz - pz) * 60;
			const r = sim.rockR[i] as number;
			// Ground height under the rock (statics, rubble, the player), cast from its centre
			// with the rock itself excluded (its hull can reach past `r`).
			let ground = 0;
			if (w.raycast(x, y, z, 0, -1, 0, y + 0.5, 2, sim.rockId[i] as number))
				ground = y - (sc[0] as number);
			const h = y - r - ground;
			if (h <= 0) continue;
			const tl = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
			if (tl > LEAD) continue;
			const k = Math.max(0, Math.min(1, 1 - tl / LEAD));
			const s = (r * 1.08 + 0.1) / INNER;
			const j = n * 16;
			e[j] = s;
			e[j + 1] = 0;
			e[j + 2] = 0;
			e[j + 3] = 0;
			e[j + 4] = 0;
			e[j + 5] = 1;
			e[j + 6] = 0;
			e[j + 7] = 0;
			e[j + 8] = 0;
			e[j + 9] = 0;
			e[j + 10] = s;
			e[j + 11] = 0;
			e[j + 12] = x + vx * tl;
			e[j + 13] = ground + 0.03 + n * 0.0004;
			e[j + 14] = z + vz * tl;
			e[j + 15] = 1;
			const t = TINTS[kind] as Color;
			d[n * 4] = t.r;
			d[n * 4 + 1] = t.g;
			d[n * 4 + 2] = t.b;
			d[n * 4 + 3] = k;
			n++;
		}
		this.count = n;
		this.mesh.count = n;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.attr.needsUpdate = true;
	}
}
