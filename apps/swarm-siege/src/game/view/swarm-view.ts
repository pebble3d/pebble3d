import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
	float,
	instancedBufferAttribute,
	normalView,
	positionViewDirection,
} from "three/tsl";
import {
	type BufferGeometry,
	ConeGeometry,
	DodecahedronGeometry,
	DynamicDrawUsage,
	InstancedBufferAttribute,
	InstancedMesh,
	MeshStandardNodeMaterial,
	OctahedronGeometry,
	type Scene,
} from "three/webgpu";
import { MAX_AGENTS } from "../constants.ts";
import { A_STRIDE, H, OFF_AGENTS } from "../snapshot.ts";

/** Non-indexed copy (polyhedra already are; cones are indexed). */
function flat(g: BufferGeometry): BufferGeometry {
	return g.index ? g.toNonIndexed() : g;
}

const CAPS = [MAX_AGENTS, 4096, 1024];
/** Rest height and size per kind. */
const LIFT = [0.2, 1.05, 0.95];
const SIZE = [1.3, 1.1, 1];

function miteGeometry(): BufferGeometry {
	// 16 triangles: an octahedron body and a four-sided sting (thousands are drawn).
	const body = new OctahedronGeometry(0.28, 0).scale(0.95, 0.6, 1.4);
	const tail = new ConeGeometry(0.12, 0.34, 4, 1, true)
		.rotateX(-Math.PI / 2)
		.translate(0, 0.03, -0.5);
	const g = mergeGeometries([body, tail].map(flat));
	g.computeVertexNormals();
	return g;
}

function gliderGeometry(): BufferGeometry {
	const body = new OctahedronGeometry(0.45, 0).scale(1.6, 0.42, 1.1);
	const fin = new ConeGeometry(0.16, 0.7, 3)
		.rotateX(Math.PI / 2)
		.translate(0, 0.1, 0.55);
	const g = mergeGeometries([body, fin].map(flat));
	g.computeVertexNormals();
	return g;
}

function bruteGeometry(): BufferGeometry {
	const body = new DodecahedronGeometry(0.85, 0).scale(1.05, 0.85, 1.25);
	const parts: BufferGeometry[] = [body];
	for (let i = 0; i < 5; i++) {
		const a = (i / 5) * Math.PI * 2;
		parts.push(
			new ConeGeometry(0.16, 0.7, 4)
				.translate(0, 0.35, 0)
				.rotateZ(Math.cos(a) * 0.8)
				.rotateX(Math.sin(a) * 0.8)
				.translate(Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.35),
		);
	}
	const g = mergeGeometries(parts.map(flat));
	g.computeVertexNormals();
	return g;
}

/** Per-kind palette: base glow, slowed glow. Hit flash goes white. */
const GLOW = [
	[1.0, 0.08, 0.45],
	[1.0, 0.5, 0.12],
	[1.0, 0.12, 0.08],
];
const ICE = [0.35, 0.8, 1.0];

/**
 * Thousands of enemies as one InstancedMesh per kind. Each frame writes instance matrices
 * (yaw about Y, scale, bob) and a per-instance glow colour read by the material's
 * emissive node, interpolating between the last two snapshots. No allocation per frame.
 */
export class SwarmView {
	readonly meshes: InstancedMesh[] = [];
	private readonly glow: InstancedBufferAttribute[] = [];
	private t = 0;
	/** Instances drawn last frame (all kinds). */
	drawn = 0;
	private readonly n = new Int32Array(3);
	private readonly mats: Float32Array[] = [];
	private readonly glows: Float32Array[] = [];

	constructor(scene: Scene) {
		const geos = [miteGeometry(), gliderGeometry(), bruteGeometry()];
		const base = [0x12040c, 0x160a04, 0x140404];
		for (let k = 0; k < 3; k++) {
			const cap = CAPS[k] as number;
			const g = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
			g.setUsage(DynamicDrawUsage);
			const mat = new MeshStandardNodeMaterial({
				color: base[k],
				roughness: 0.35,
				metalness: 0.4,
				flatShading: true,
			});
			// Bioluminescent rim: a dark carapace whose silhouette glows (fresnel), so a dense
			// swarm reads as lit edges instead of flat blobs. The glow colour is per instance.
			const facing = normalView.dot(positionViewDirection).clamp(0, 1);
			const rim = float(1).sub(facing).pow(2);
			mat.emissiveNode = (
				instancedBufferAttribute(g, "vec3") as unknown as ReturnType<
					typeof float
				>
			).mul(rim.mul(1.8).add(0.18));
			const mesh = new InstancedMesh(geos[k] as BufferGeometry, mat, cap);
			mesh.instanceMatrix.setUsage(DynamicDrawUsage);
			mesh.frustumCulled = false;
			// Mites are too small and too many for the shadow cascades; bigger kinds cast.
			mesh.castShadow = k > 0;
			mesh.receiveShadow = false;
			mesh.count = 0;
			scene.add(mesh);
			this.meshes.push(mesh);
			this.glow.push(g);
		}
		for (const m of this.meshes)
			this.mats.push(m.instanceMatrix.array as Float32Array);
		for (const g of this.glow) this.glows.push(g.array as Float32Array);
	}

	update(
		dt: number,
		prev: Float32Array,
		curr: Float32Array,
		alpha: number,
	): void {
		this.t += dt;
		const t = this.t;
		const hw = curr[H.HW] as number;
		const prevHw = prev[H.HW] as number;
		const n = this.n;
		n.fill(0);
		const mats = this.mats;
		const glows = this.glows;
		for (let i = 0; i < hw; i++) {
			const o = OFF_AGENTS + i * A_STRIDE;
			const code = curr[o + 3] as number;
			if (code === 0) continue;
			const kind = (code & 3) - 1;
			const cap = CAPS[kind] as number;
			const k = n[kind] as number;
			if (k >= cap) continue;
			n[kind] = k + 1;
			let x = curr[o] as number;
			let z = curr[o + 1] as number;
			let yaw = curr[o + 2] as number;
			const pc = prev[o + 3] as number;
			if (i < prevHw && (pc & 63) === (code & 63)) {
				const px = prev[o] as number;
				const pz = prev[o + 1] as number;
				x = px + (x - px) * alpha;
				z = pz + (z - pz) * alpha;
				let dy = yaw - (prev[o + 2] as number);
				if (dy > Math.PI) dy -= Math.PI * 2;
				else if (dy < -Math.PI) dy += Math.PI * 2;
				yaw = yaw - dy * (1 - alpha);
			}
			const ph = t * (kind === 0 ? 14 : 3) + i * 1.37;
			const sw = Math.sin(ph);
			let y = LIFT[kind] as number;
			let s = SIZE[kind] as number;
			let sy = s;
			if (kind === 0) {
				y += Math.abs(sw) * 0.08;
				sy = s * (0.9 + 0.12 * Math.abs(sw));
			} else if (kind === 1) {
				y += sw * 0.18;
			} else {
				sy = s * (0.94 + 0.06 * Math.abs(sw));
				s *= 1 + 0.03 * sw;
			}
			const c = Math.cos(yaw);
			const sn = Math.sin(yaw);
			const m = mats[kind] as Float32Array;
			const b = k * 16;
			const roll = kind === 1 ? sw * 0.25 : 0;
			// R = Ry(yaw) * Rz(roll) * S, written column-major.
			const cr = Math.cos(roll);
			const sr = Math.sin(roll);
			m[b] = c * cr * s;
			m[b + 1] = sr * s;
			m[b + 2] = -sn * cr * s;
			m[b + 3] = 0;
			m[b + 4] = -c * sr * sy;
			m[b + 5] = cr * sy;
			m[b + 6] = sn * sr * sy;
			m[b + 7] = 0;
			m[b + 8] = sn * s;
			m[b + 9] = 0;
			m[b + 10] = c * s;
			m[b + 11] = 0;
			m[b + 12] = x;
			m[b + 13] = y;
			m[b + 14] = z;
			m[b + 15] = 1;
			const gl = glows[kind] as Float32Array;
			const gb = k * 3;
			const pal = GLOW[kind] as number[];
			const pulse = kind === 0 ? 1.1 : 1.3 + 0.35 * sw;
			if (code & 64) {
				gl[gb] = 3;
				gl[gb + 1] = 2.6;
				gl[gb + 2] = 2.6;
			} else if (code & 128) {
				gl[gb] = (ICE[0] as number) * pulse;
				gl[gb + 1] = (ICE[1] as number) * pulse;
				gl[gb + 2] = (ICE[2] as number) * pulse;
			} else {
				gl[gb] = (pal[0] as number) * pulse;
				gl[gb + 1] = (pal[1] as number) * pulse;
				gl[gb + 2] = (pal[2] as number) * pulse;
			}
		}
		let total = 0;
		for (let k = 0; k < 3; k++) {
			const mesh = this.meshes[k] as InstancedMesh;
			const c = n[k] as number;
			mesh.count = c;
			total += c;
			if (c > 0) {
				mesh.instanceMatrix.clearUpdateRanges();
				mesh.instanceMatrix.addUpdateRange(0, c * 16);
				mesh.instanceMatrix.needsUpdate = true;
				const g = this.glow[k] as InstancedBufferAttribute;
				g.clearUpdateRanges();
				g.addUpdateRange(0, c * 3);
				g.needsUpdate = true;
			}
		}
		this.drawn = total;
	}
}
