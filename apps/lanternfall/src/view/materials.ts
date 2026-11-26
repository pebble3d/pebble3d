import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
	abs,
	color,
	float,
	floor,
	fract,
	hash,
	min,
	mix,
	normalWorld,
	positionWorld,
	smoothstep,
	vec2,
} from "three/tsl";
import {
	type BufferGeometry,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	type Object3D,
} from "three/webgpu";

/**
 * Game-side procedural surfaces for the generated keep: the scene JSON gives flat colours
 * (so the dumped scene loads anywhere); here the floor slabs become flagstones and the walls
 * coursed ashlar, both from world position in TSL (no textures). Applied once after load by
 * entity-name prefix.
 */
function mortar(p: ReturnType<typeof vec2>, w: number) {
	const f = fract(p);
	const e = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus()));
	return smoothstep(w * 0.4, w, e);
}

function flagstone(base: string, dark: string): MeshStandardNodeMaterial {
	const m = new MeshStandardNodeMaterial({ roughness: 0.92 });
	const q = positionWorld.xz.div(1.25);
	const row = floor(q.y);
	const p = vec2(q.x.add(row.mul(0.5)), q.y);
	const cell = floor(p);
	const h = hash(cell.x.mul(17.0).add(cell.y.mul(131.0)));
	const stone = mix(color(dark), color(base), h.mul(0.7).add(0.3));
	m.colorNode = mix(color("#121216"), stone, mortar(p, 0.035));
	m.roughnessNode = float(0.8).add(h.mul(0.18));
	return m;
}

function ashlar(base: string, dark: string): MeshStandardNodeMaterial {
	const m = new MeshStandardNodeMaterial({ roughness: 0.95 });
	// Along-wall coordinate: x on walls facing z, z on walls facing x; tops use x.
	const n = normalWorld;
	const u = mix(
		positionWorld.x,
		positionWorld.z,
		abs(n.x).step(0.5).oneMinus(),
	);
	const q = vec2(u.div(0.95), positionWorld.y.div(0.5));
	const row = floor(q.y);
	const p = vec2(q.x.add(row.mul(0.5)), q.y);
	const cell = floor(p);
	const h = hash(cell.x.mul(23.0).add(cell.y.mul(71.0)));
	const block = mix(color(dark), color(base), h.mul(0.6).add(0.4));
	const top = abs(n.y).step(0.5);
	m.colorNode = mix(
		mix(color("#1d1e24"), block, mortar(p, 0.04)),
		color(base),
		top.mul(0.6),
	);
	return m;
}

/**
 * Swap in the procedural surfaces, then bake every static keep object (`staticIds`) into one
 * mesh per material and shadow flag: ~180 entities become ~20 draw calls (times the shadow
 * cascades). Call after the first `renderer.sync`, which places static bodies.
 */
/** An unlit HDR colour: blooms (the scene's bloom threshold is 1.4). */
export function glow(hex: string, gain: number): MeshBasicNodeMaterial {
	const m = new MeshBasicNodeMaterial();
	m.colorNode = color(hex).mul(gain);
	return m;
}

export function dressKeep(
	scene: Object3D,
	staticIds: ReadonlySet<string>,
): number {
	const floorMat = flagstone("#5a5860", "#36353b");
	const woodMat = flagstone("#5b4330", "#3a2a1e");
	const wallMat = ashlar("#6a6e7b", "#474a55");
	const outerMat = ashlar("#5a5f6c", "#3c3f49");
	const fireMat = glow("#ffa24a", 5);
	const lampMat = glow("#ffc070", 4);
	const roots: Object3D[] = [];
	for (const o of scene.children) if (staticIds.has(o.name)) roots.push(o);
	scene.updateMatrixWorld(true);
	const groups = new Map<
		string,
		{ mat: Material; cast: boolean; geos: BufferGeometry[] }
	>();
	for (const root of roots) {
		const name = root.name;
		let mat: MeshStandardNodeMaterial | null = null;
		if (name.startsWith("floor-"))
			mat = name.startsWith("floor-wood") ? woodMat : floorMat;
		else if (
			name.startsWith("wall-") ||
			name.startsWith("partition-") ||
			name.startsWith("lintel-") ||
			name.startsWith("post-")
		)
			mat = wallMat;
		else if (
			name.startsWith("outer-") ||
			name.startsWith("gate-pier") ||
			name.startsWith("gate-lintel") ||
			name.startsWith("tower-")
		)
			mat = outerMat;
		let m2: Material | null = mat;
		if (name.startsWith("fire-") || name.startsWith("gate-fire")) m2 = fireMat;
		else if (name.startsWith("lantern-")) m2 = lampMat;
		root.traverse((c) => {
			const mesh = c as Mesh;
			if (!mesh.isMesh || Array.isArray(mesh.material)) return;
			const m = m2 ?? (mesh.material as Material);
			const key = `${m.uuid}|${mesh.castShadow ? 1 : 0}`;
			let g = groups.get(key);
			if (!g) {
				g = { mat: m, cast: mesh.castShadow, geos: [] };
				groups.set(key, g);
			}
			g.geos.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
		});
		root.visible = false;
		root.removeFromParent();
	}
	let n = 0;
	for (const g of groups.values()) {
		const merged = mergeGeometries(g.geos, false);
		for (const x of g.geos) x.dispose();
		if (!merged) continue;
		const mesh = new Mesh(merged, g.mat);
		mesh.name = "keep-merged";
		mesh.castShadow = g.cast;
		mesh.receiveShadow = true;
		mesh.matrixAutoUpdate = false;
		scene.add(mesh);
		n++;
	}
	return n;
}
