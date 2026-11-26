import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
	type BufferGeometry,
	Group,
	type Material,
	Mesh,
	type Object3D,
} from "three/webgpu";

/**
 * Bakes every mesh under `root` into one mesh per material (world transforms applied), for
 * static props: tens of draw calls (times the shadow cascades) become a handful. Meshes must
 * share attribute layouts per material (three's primitive geometries do).
 */
export function mergeByMaterial(root: Object3D): Group {
	root.updateMatrixWorld(true);
	const groups = new Map<Material, BufferGeometry[]>();
	root.traverse((o) => {
		const m = o as Mesh;
		if (!m.isMesh || Array.isArray(m.material)) return;
		const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
		const list = groups.get(m.material as Material) ?? [];
		list.push(g);
		groups.set(m.material as Material, list);
	});
	const out = new Group();
	for (const [mat, geos] of groups) {
		const merged = mergeGeometries(geos, false);
		for (const g of geos) g.dispose();
		if (!merged) continue;
		const mesh = new Mesh(merged, mat);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		out.add(mesh);
	}
	return out;
}
