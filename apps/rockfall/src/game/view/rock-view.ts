import type { EngineRenderer } from "@pebble3d/renderer";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import {
	color,
	float,
	mx_fractal_noise_float,
	mx_worley_noise_float,
	positionLocal,
	smoothstep,
	time,
	vec3,
} from "three/tsl";
import {
	type BufferGeometry,
	Color,
	MeshStandardNodeMaterial,
	Vector3,
} from "three/webgpu";
import { Rng } from "../rng.ts";
import { KIND, ROCK_KINDS, rockPoints } from "../rocks.ts";
import type { RockfallSim } from "../sim.ts";

/** Base albedo per kind (sRGB): sandstone pebbles and rocks, slate slabs, red boulders, basalt meteors. */
const KIND_COLOR = ["#7a6650", "#88674a", "#5f5c5a", "#80513a", "#2a2220"];
const _c = new Color();

/**
 * Rock visuals. Every kind/variant gets the exact convex hull the engine simulates (three's
 * ConvexGeometry over the same seeded points), flat-shaded so the facets read, and each rock
 * is one instance in the engine renderer's `InstanceRegistry`, keyed by kind and variant.
 * The registry syncs every instance from the wasm state buffers (prev/curr interpolated).
 */
export class RockView {
	private readonly renderer: EngineRenderer;
	private readonly geos: BufferGeometry[][];
	private readonly mats: MeshStandardNodeMaterial[];
	private readonly keys: string[][];
	/** Per-instance tint jitter, deterministic per slot. */
	private readonly tint = new Rng(4242);
	/** Slots currently drawn (for a full clear on world reset). */
	private readonly live = new Set<number>();

	constructor(renderer: EngineRenderer) {
		this.renderer = renderer;
		this.geos = ROCK_KINDS.map((k) =>
			Array.from({ length: k.variants }, (_, v) => {
				const pts = rockPoints(k.id, v);
				const vs: Vector3[] = [];
				for (let i = 0; i < pts.length; i += 3)
					vs.push(
						new Vector3(
							pts[i] as number,
							pts[i + 1] as number,
							pts[i + 2] as number,
						),
					);
				const g = new ConvexGeometry(vs);
				g.computeVertexNormals();
				return g;
			}),
		);
		this.mats = ROCK_KINDS.map((k) => rockMaterial(k.id));
		this.keys = ROCK_KINDS.map((k) =>
			Array.from({ length: k.variants }, (_, v) => `rock|${k.name}|${v}`),
		);
	}

	/** Mirrors the sim's per-tick spawn/despawn lists into the instance registry. */
	apply(sim: RockfallSim): void {
		const inst = this.renderer.instances;
		for (let i = 0; i < sim.addedN; i++) {
			const slot = sim.addedSlot[i] as number;
			const kind = sim.addedKind[i] as number;
			const v = sim.addedVar[i] as number;
			const geo = this.geos[kind]?.[v];
			const mat = this.mats[kind];
			const key = this.keys[kind]?.[v];
			if (!geo || !mat || !key) continue;
			const j = kind === KIND.METEOR ? 0 : this.tint.range(-0.13, 0.13);
			const warm = this.tint.range(-0.05, 0.05);
			_c.setRGB(1 + j + warm, 1 + j, 1 + j - warm);
			inst.add(key, geo, mat, slot, _c);
			// Pebbles are many and tiny: their shadows cost a cascade pass and add nothing.
			if (kind === KIND.PEBBLE) {
				const m = inst.mesh(key);
				if (m) m.castShadow = false;
			}
			this.live.add(slot);
		}
		for (let i = 0; i < sim.removedN; i++) {
			const slot = sim.removedSlot[i] as number;
			inst.removeSlot(slot);
			this.live.delete(slot);
		}
	}

	/** World reset: drop every rock instance. */
	clear(): void {
		for (const slot of this.live) this.renderer.instances.removeSlot(slot);
		this.live.clear();
	}

	material(kind: number): MeshStandardNodeMaterial | undefined {
		return this.mats[kind];
	}
}

/**
 * Faceted stone: a world-space fractal noise mottles the albedo and roughness (so instances
 * sharing a geometry still differ), and darker strata bands run horizontally. Meteors are
 * basalt with glowing magma veins (worley cracks), pulsing, which feed the bloom.
 */
function rockMaterial(kind: number): MeshStandardNodeMaterial {
	const m = new MeshStandardNodeMaterial({
		flatShading: true,
		roughness: 0.92,
		metalness: 0,
	});
	const base = color(new Color(KIND_COLOR[kind] ?? "#888888"));
	const n = mx_fractal_noise_float(positionLocal.mul(3.1), 3, 2, 0.5);
	if (kind === KIND.METEOR) {
		const cells = mx_worley_noise_float(positionLocal.mul(4.2));
		const vein = float(1).sub(smoothstep(0.04, 0.16, cells));
		const pulse = time.mul(5).sin().mul(0.25).add(1);
		m.colorNode = base.mul(n.mul(0.4).add(0.8));
		m.emissiveNode = vec3(5.5, 1.5, 0.35).mul(vein).mul(pulse);
		m.roughnessNode = float(0.75);
		return m;
	}
	const strata = positionLocal.y.mul(9).add(n.mul(4)).sin().mul(0.06);
	m.colorNode = base.mul(n.mul(0.32).add(0.92).add(strata));
	m.roughnessNode = float(0.86).add(n.mul(0.12));
	return m;
}
