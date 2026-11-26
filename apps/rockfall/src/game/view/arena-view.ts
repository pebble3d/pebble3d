import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
	color,
	float,
	floor,
	fract,
	min,
	mix,
	mx_fractal_noise_float,
	mx_worley_noise_vec2,
	mx_worley_noise_vec3,
	positionWorld,
	smoothstep,
	vec2,
} from "three/tsl";
import {
	BoxGeometry,
	type BufferGeometry,
	Color,
	type Group,
	Mesh,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	type Scene,
	Vector3,
} from "three/webgpu";
import {
	ARENA_HALF,
	PILLAR_HALF,
	PILLAR_HEIGHT,
	PILLARS,
	WALL_HEIGHT,
	WALL_THICK,
} from "../constants.ts";
import { Rng } from "../rng.ts";

/**
 * The quarry pit: a packed-earth floor laid with worn flagstones, ashlar block walls with a
 * capstone lip, four pillars, and a ring of tall sandstone mesas outside to frame the sky.
 * All procedural (TSL), no textures.
 */
export function buildArena(scene: Scene): void {
	// --- floor: flagstones (worley cells) over packed earth ---
	const floorMat = new MeshStandardNodeMaterial({ roughness: 0.95 });
	const p = positionWorld.xz;
	// Worley F2 - F1 is small along cell borders: those are the joints between flagstones.
	const f = mx_worley_noise_vec2(p.mul(0.62));
	const grout = smoothstep(0.0, 0.045, f.y.sub(f.x));
	const n = mx_fractal_noise_float(p.mul(0.9), 4, 2, 0.5);
	const slab = mx_worley_noise_vec3(p.mul(0.62)).z;
	const stone = mix(
		color(new Color("#83664a")),
		color(new Color("#a8885f")),
		n.mul(0.35).add(0.5).add(slab.mul(0.3)),
	);
	const earth = color(new Color("#53402e"));
	floorMat.colorNode = mix(earth, stone, grout);
	floorMat.roughnessNode = mix(float(1), float(0.82), grout);
	const floorGeo = new PlaneGeometry(
		ARENA_HALF * 2 + 0.2,
		ARENA_HALF * 2 + 0.2,
	);
	floorGeo.rotateX(-Math.PI / 2);
	const floorMesh = new Mesh(floorGeo, floorMat);
	floorMesh.receiveShadow = true;
	floorMesh.position.y = 0.002;
	scene.add(floorMesh);

	// --- outside ground (desert hardpan) ---
	const outMat = new MeshStandardNodeMaterial({ roughness: 1 });
	const on = mx_fractal_noise_float(p.mul(0.08), 4, 2, 0.5);
	outMat.colorNode = mix(
		color(new Color("#9a7754")),
		color(new Color("#c49a6c")),
		on.mul(0.5).add(0.5),
	);
	const outGeo = new PlaneGeometry(400, 400);
	outGeo.rotateX(-Math.PI / 2);
	const out = new Mesh(outGeo, outMat);
	out.position.y = -0.02;
	out.receiveShadow = true;
	scene.add(out);

	// --- walls: ashlar courses (offset rows), darker mortar ---
	const wallMat = new MeshStandardNodeMaterial({ roughness: 0.9 });
	const course = 0.6;
	const blockLen = 1.4;
	const u = positionWorld.x.add(positionWorld.z);
	const row = floor(positionWorld.y.div(course));
	const along = fract(u.div(blockLen).add(row.mul(0.5)));
	const up = fract(positionWorld.y.div(course));
	const ea = min(along, float(1).sub(along)).mul(blockLen);
	const eu = min(up, float(1).sub(up)).mul(course);
	const edge = smoothstep(0.04, 0.012, min(ea, eu));
	const wn = mx_fractal_noise_float(
		vec2(u.mul(1.3), positionWorld.y.mul(1.3)),
		3,
		2,
		0.5,
	);
	const blockTone = fract(
		row.mul(0.37).add(floor(u.div(blockLen)).mul(0.61)),
	).mul(0.16);
	const wallBase = color(new Color("#a48766")).mul(
		wn.mul(0.22).add(0.9).add(blockTone),
	);
	wallMat.colorNode = mix(wallBase, color(new Color("#4a3b2e")), edge);
	const H = ARENA_HALF + WALL_THICK / 2;
	const L = (ARENA_HALF + WALL_THICK) * 2;
	const capMat = new MeshStandardNodeMaterial({ roughness: 0.85 });
	capMat.colorNode = color(new Color("#c2a682")).mul(wn.mul(0.15).add(0.92));
	// Walls, pillars and caps are merged per material: two draw calls (plus shadow passes).
	const blocks: BufferGeometry[] = [];
	const caps: BufferGeometry[] = [];
	const box = (
		sx: number,
		sy: number,
		sz: number,
		x: number,
		y: number,
		z: number,
	): BoxGeometry => new BoxGeometry(sx, sy, sz).translate(x, y, z);
	const wall = (x: number, z: number, sx: number, sz: number): void => {
		blocks.push(box(sx, WALL_HEIGHT, sz, x, WALL_HEIGHT / 2, z));
		caps.push(box(sx + 0.3, 0.25, sz + 0.3, x, WALL_HEIGHT + 0.12, z));
	};
	wall(0, -H, L, WALL_THICK);
	wall(0, H, L, WALL_THICK);
	wall(-H, 0, WALL_THICK, L);
	wall(H, 0, WALL_THICK, L);
	for (const [x, z] of PILLARS) {
		blocks.push(
			box(
				PILLAR_HALF * 2,
				PILLAR_HEIGHT,
				PILLAR_HALF * 2,
				x,
				PILLAR_HEIGHT / 2,
				z,
			),
		);
		caps.push(
			box(
				PILLAR_HALF * 2 + 0.35,
				0.3,
				PILLAR_HALF * 2 + 0.35,
				x,
				PILLAR_HEIGHT + 0.15,
				z,
			),
		);
	}
	for (const [list, mat] of [
		[blocks, wallMat],
		[caps, capMat],
	] as const) {
		const g = mergeGeometries(list);
		if (!g) continue;
		const m = new Mesh(g, mat);
		m.castShadow = true;
		m.receiveShadow = true;
		scene.add(m);
	}

	buildMesas(scene);
}

/** A ring of flat-topped sandstone mesas and buttes (convex hulls of seeded points). */
function buildMesas(scene: Scene | Group): void {
	const mat = new MeshStandardNodeMaterial({
		flatShading: true,
		roughness: 0.95,
	});
	const y = positionWorld.y;
	const wob = mx_fractal_noise_float(positionWorld.mul(0.09), 3, 2, 0.5);
	const bands = smoothstep(-0.3, 0.3, y.mul(0.55).add(wob.mul(2.5)).sin());
	const deep = color(new Color("#7d3f24"));
	const light = color(new Color("#b8774a"));
	const base = color(new Color("#5a3220"));
	mat.colorNode = mix(
		mix(deep, light, bands.mul(0.7).add(wob.mul(0.3))),
		base,
		smoothstep(3, 0, y).mul(0.6),
	);
	const rng = new Rng(99);
	const count = 22;
	const parts: BufferGeometry[] = [];
	for (let i = 0; i < count; i++) {
		const a = (i / count) * Math.PI * 2 + rng.range(-0.1, 0.1);
		const dist = rng.range(34, 50);
		const w = rng.range(5, 12);
		const h = rng.range(8, 20) * (i % 4 === 0 ? 1.35 : 1);
		const top = rng.range(0.55, 0.85);
		const pts: Vector3[] = [];
		const sides = 9;
		for (let k = 0; k < sides; k++) {
			const th = (k / sides) * Math.PI * 2 + rng.range(-0.2, 0.2);
			const rr = w * rng.range(0.8, 1);
			pts.push(new Vector3(Math.cos(th) * rr, 0, Math.sin(th) * rr * 0.75));
			const rt = rr * top * rng.range(0.9, 1.05);
			pts.push(
				new Vector3(
					Math.cos(th) * rt,
					h * rng.range(0.97, 1),
					Math.sin(th) * rt * 0.75,
				),
			);
		}
		const g = new ConvexGeometry(pts);
		g.rotateY(rng.range(0, Math.PI));
		g.translate(Math.cos(a) * dist, -0.5, Math.sin(a) * dist);
		parts.push(g);
	}
	// One merged mesh: 22 mesas in one draw call.
	const merged = mergeGeometries(parts);
	if (!merged) return;
	merged.computeVertexNormals();
	const m = new Mesh(merged, mat);
	m.castShadow = true;
	m.receiveShadow = true;
	scene.add(m);
}
