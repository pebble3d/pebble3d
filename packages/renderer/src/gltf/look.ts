import { materialColor, saturation, vec4 } from "three/tsl";
import {
	type Material,
	type Mesh,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial,
	MeshStandardNodeMaterial,
	type Node,
	type NodeMaterial,
	type Object3D,
} from "three/webgpu";
import type { LookSpec } from "../types.ts";

type NodeMaterialCtor = new () => NodeMaterial;

/** Node pendant for a classic material (mirrors `NodeLibrary.fromMaterial`). */
function nodeClassFor(mat: Material): NodeMaterialCtor | null {
	const m = mat as {
		isMeshPhysicalMaterial?: boolean;
		isMeshStandardMaterial?: boolean;
		isMeshBasicMaterial?: boolean;
	};
	if (m.isMeshPhysicalMaterial) return MeshPhysicalNodeMaterial;
	if (m.isMeshStandardMaterial) return MeshStandardNodeMaterial;
	if (m.isMeshBasicMaterial) return MeshBasicNodeMaterial;
	return null;
}

/**
 * A look-adjusted copy of `src`. With saturation, a classic material becomes its node
 * pendant (copied key by key, as WebGPURenderer itself converts it) so `colorNode` is
 * honoured; otherwise it's a plain clone.
 */
function lookedCopy(
	src: Material,
	envIntensity: number | undefined,
	sat: number | undefined,
): Material {
	let out: Material;
	const isNode = (src as { isNodeMaterial?: boolean }).isNodeMaterial === true;
	const Ctor = sat !== undefined && !isNode ? nodeClassFor(src) : null;
	if (Ctor) {
		const nm = new Ctor();
		const from = src as unknown as Record<string, unknown>;
		const to = nm as unknown as Record<string, unknown>;
		for (const key in from) {
			if (key === "uuid" || key === "id") continue;
			const v = from[key] as { clone?: () => unknown; isTexture?: boolean };
			// Value objects (Color, Vector2…) are cloned so the copy never aliases the
			// cached source; textures stay shared (one GPU upload per glTF).
			to[key] =
				v && typeof v.clone === "function" && v.isTexture !== true
					? v.clone()
					: v;
		}
		out = nm;
	} else {
		out = src.clone();
	}
	if (envIntensity !== undefined && "envMapIntensity" in out)
		(out as { envMapIntensity: number }).envMapIntensity = envIntensity;
	if (
		sat !== undefined &&
		(out as { isNodeMaterial?: boolean }).isNodeMaterial
	) {
		// Declared vec3, but COLOR is color * map: vec4 with the map's alpha when a map is set.
		const c = materialColor as unknown as Node<"vec4">;
		(out as NodeMaterial).colorNode = vec4(saturation(c.rgb, sat), c.a);
	}
	out.needsUpdate = true;
	return out;
}

/**
 * Applies `look` to every mesh under `root` (load time, once per glTF + look). Shared
 * source materials are never mutated: each is replaced by one look-adjusted copy, reused
 * across the meshes of `root` that shared it. Undefined / empty look: no-op.
 */
export function applyLook(root: Object3D, look: LookSpec | undefined): void {
	if (!look) return;
	const env = look.envIntensity;
	const sat =
		look.saturation !== undefined && look.saturation !== 1
			? look.saturation
			: undefined;
	if (env === undefined && sat === undefined) return;
	const copies = new Map<Material, Material>();
	const swap = (m: Material): Material => {
		let c = copies.get(m);
		if (!c) {
			c = lookedCopy(m, env, sat);
			copies.set(m, c);
		}
		return c;
	};
	root.traverse((o) => {
		const mesh = o as Mesh;
		if (!mesh.isMesh) return;
		mesh.material = Array.isArray(mesh.material)
			? mesh.material.map(swap)
			: swap(mesh.material);
	});
}
