import {
	abs,
	checker,
	color,
	float,
	fract,
	max,
	mix,
	mx_noise_float,
	positionWorld,
	smoothstep,
	step,
	time,
	uv,
	vec2,
} from "three/tsl";
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	Color,
	CylinderGeometry,
	DoubleSide,
	FrontSide,
	Group,
	InstancedMesh,
	type Material,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	Quaternion,
	Vector3,
} from "three/webgpu";
import { MARBLE_RADIUS } from "../constants.ts";
import type { CourseLook } from "../course.ts";
import { TUNE } from "../sim.ts";
import type { Track } from "../track.ts";

const DECK_RES = 17;
const WALL_FLARE = 0.15;
const SAG_PER_M = 0.06;
const RAIL_W = 0.09;
const RAIL_H = 0.1;
const HULL_DEPTH = 0.45;

/** One cross-section strip: 2D points (x across r, y along u), 2D normals, u coordinates. */
interface Strip {
	n: number;
	group: number;
	build(
		i: number,
		track: Track,
		px: Float64Array,
		nx: Float64Array,
		uu: Float64Array,
	): void;
}

function sag(track: Track, i: number, x: number): number {
	const w = track.width[i] as number;
	const k = (2 * x) / w;
	return SAG_PER_M * w * k * k;
}

const G_DECK = 0;
const G_WALL = 1;
const G_RAIL = 2;
const G_HULL = 3;

function strips(): Strip[] {
	const deck: Strip = {
		n: DECK_RES,
		group: G_DECK,
		build(i, t, p, nn, uu) {
			const w = t.width[i] as number;
			for (let j = 0; j < DECK_RES; j++) {
				const x = -w / 2 + (w * j) / (DECK_RES - 1);
				p[j * 2] = x;
				p[j * 2 + 1] = sag(t, i, x);
				const slope = (8 * SAG_PER_M * x) / w;
				const l = Math.hypot(slope, 1);
				nn[j * 2] = -slope / l;
				nn[j * 2 + 1] = 1 / l;
				uu[j] = j / (DECK_RES - 1);
			}
		},
	};
	const wall = (side: -1 | 1): Strip => ({
		n: 2,
		group: G_WALL,
		build(i, t, p, nn, uu) {
			const hw = (t.width[i] as number) / 2;
			const y0 = sag(t, i, hw);
			const h = t.wall[i] as number;
			p[0] = side * hw;
			p[1] = y0;
			p[2] = side * (hw + WALL_FLARE);
			p[3] = y0 + h;
			const l = Math.hypot(h, WALL_FLARE);
			for (let k = 0; k < 2; k++) {
				nn[k * 2] = (-side * h) / l;
				nn[k * 2 + 1] = WALL_FLARE / l;
			}
			uu[0] = 0;
			uu[1] = 1;
		},
	});
	// rail: inner face, top, outer face (hard edges: 6 points, normals per face)
	const rail = (side: -1 | 1): Strip => ({
		n: 6,
		group: G_RAIL,
		build(i, t, p, nn, uu) {
			const hw = (t.width[i] as number) / 2;
			const top = sag(t, i, hw) + (t.wall[i] as number);
			const xc = side * (hw + WALL_FLARE);
			const xi = xc - side * RAIL_W;
			const xo = xc + side * RAIL_W;
			const pts = [
				xi,
				top - RAIL_H * 0.4,
				xi,
				top + RAIL_H,
				xi,
				top + RAIL_H,
				xo,
				top + RAIL_H,
				xo,
				top + RAIL_H,
				xo,
				top - RAIL_H,
			];
			const nrm = [-side, 0, -side, 0, 0, 1, 0, 1, side, 0, side, 0];
			for (let k = 0; k < 12; k++) {
				p[k] = pts[k] as number;
				nn[k] = nrm[k] as number;
			}
			for (let k = 0; k < 6; k++) uu[k] = k / 5;
		},
	});
	// hull under the deck: left lip -> bottom -> right lip
	const hull: Strip = {
		n: 8,
		group: G_HULL,
		build(i, t, p, nn, uu) {
			const hw = (t.width[i] as number) / 2;
			const y0 = sag(t, i, hw);
			const bw = hw * 0.55;
			const pts = [
				-hw,
				y0,
				-bw,
				-HULL_DEPTH,
				-bw,
				-HULL_DEPTH,
				bw,
				-HULL_DEPTH,
				bw,
				-HULL_DEPTH,
				hw,
				y0,
				-hw,
				y0,
				-hw,
				y0,
			];
			// faces: left slope (outward-left-down), bottom (down), right slope
			const ls = Math.hypot(HULL_DEPTH + y0, hw - bw);
			const lnx = -(HULL_DEPTH + y0) / ls;
			const lny = -(hw - bw) / ls;
			const nrm = [
				lnx,
				lny,
				lnx,
				lny,
				0,
				-1,
				0,
				-1,
				-lnx,
				lny,
				-lnx,
				lny,
				0,
				0,
				0,
				0,
			];
			for (let k = 0; k < 16; k++) {
				p[k] = pts[k] as number;
				nn[k] = nrm[k] as number;
			}
			for (let k = 0; k < 8; k++) uu[k] = k / 7;
		},
	};
	return [deck, wall(-1), wall(1), rail(-1), rail(1), hull];
}

/** Builds one deck piece (samples i0..i1) as an indexed geometry with 4 material groups. */
function pieceGeometry(t: Track, i0: number, i1: number): BufferGeometry {
	const ss = strips();
	const rings = i1 - i0 + 1;
	let perRing = 0;
	for (const s of ss) perRing += s.n;
	const pos = new Float32Array(rings * perRing * 3);
	const nor = new Float32Array(rings * perRing * 3);
	const uvs = new Float32Array(rings * perRing * 2);
	const p2 = new Float64Array(64);
	const n2 = new Float64Array(64);
	const u1 = new Float64Array(32);
	let base = 0;
	const groupIdx: number[][] = [[], [], [], []];
	for (const s of ss) {
		for (let r = 0; r < rings; r++) {
			const i = i0 + r;
			s.build(i, t, p2, n2, u1);
			const px = t.px[i] as number;
			const py = t.py[i] as number;
			const pz = t.pz[i] as number;
			const rx = t.rx[i] as number;
			const ry = t.ry[i] as number;
			const rz = t.rz[i] as number;
			const ux = t.ux[i] as number;
			const uy = t.uy[i] as number;
			const uz = t.uz[i] as number;
			for (let j = 0; j < s.n; j++) {
				const v = base + r * s.n + j;
				const a = p2[j * 2] as number;
				const b = p2[j * 2 + 1] as number;
				pos[v * 3] = px + rx * a + ux * b;
				pos[v * 3 + 1] = py + ry * a + uy * b;
				pos[v * 3 + 2] = pz + rz * a + uz * b;
				const na = n2[j * 2] as number;
				const nb = n2[j * 2 + 1] as number;
				nor[v * 3] = rx * na + ux * nb;
				nor[v * 3 + 1] = ry * na + uy * nb;
				nor[v * 3 + 2] = rz * na + uz * nb;
				uvs[v * 2] = u1[j] as number;
				uvs[v * 2 + 1] = t.dist[i] as number;
			}
		}
		// Wind each quad so its geometric normal agrees with the shading normal: the face
		// normal of profile edge d = (dr, du) is (-du, dr). Double-sided materials flip the
		// shading normal on back faces, so a mis-wound wall would light (and AO) inside out.
		s.build(i0, t, p2, n2, u1);
		const flip: boolean[] = [];
		for (let j = 0; j + 1 < s.n; j++) {
			const dr = (p2[(j + 1) * 2] as number) - (p2[j * 2] as number);
			const du = (p2[(j + 1) * 2 + 1] as number) - (p2[j * 2 + 1] as number);
			const nr = ((n2[j * 2] as number) + (n2[(j + 1) * 2] as number)) / 2;
			const nu =
				((n2[j * 2 + 1] as number) + (n2[(j + 1) * 2 + 1] as number)) / 2;
			flip.push(-du * nr + dr * nu < 0);
		}
		const idx = groupIdx[s.group] as number[];
		for (let r = 0; r + 1 < rings; r++) {
			const a = base + r * s.n;
			const b = base + (r + 1) * s.n;
			for (let j = 0; j + 1 < s.n; j++) {
				// skip the zero-width joints between hard-edged faces
				if (s.n > 2 && s.group !== G_DECK && j % 2 === 1) continue;
				if (flip[j])
					idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
				else idx.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
			}
		}
		base += rings * s.n;
	}
	const g = new BufferGeometry();
	g.setAttribute("position", new BufferAttribute(pos, 3));
	g.setAttribute("normal", new BufferAttribute(nor, 3));
	g.setAttribute("uv", new BufferAttribute(uvs, 2));
	const all: number[] = [];
	for (let k = 0; k < 4; k++) {
		const list = groupIdx[k] as number[];
		g.addGroup(all.length, list.length, k);
		for (const v of list) all.push(v);
	}
	g.setIndex(all);
	g.computeBoundingSphere();
	return g;
}

function deckMaterial(look: CourseLook): Material {
	const m = new MeshPhysicalNodeMaterial({
		roughness: look.deck.roughness,
		metalness: 0,
		clearcoat: look.deck.clearcoat,
		clearcoatRoughness: 0.08,
		side: DoubleSide,
	});
	const u = uv().x;
	const v = uv().y;
	const c = abs(u.mul(2).sub(1));
	// lane lines near the edges, centre dashes, distance ticks every 10 m
	const lanes = step(0.8, c).mul(step(c, 0.835));
	const dash = step(c, 0.018).mul(step(fract(v.div(4)), 0.5));
	const tick = step(fract(v.div(10)), 0.03)
		.mul(step(c, 0.7))
		.mul(0.55);
	const mask = max(max(lanes, dash), tick);
	// subtle large-scale tone variation so the surface never reads as flat CG
	const grain = mx_noise_float(vec2(u.mul(6), v.mul(0.35))).mul(0.04);
	m.colorNode = mix(
		color(look.deck.color).add(grain),
		color(look.deck.stripe),
		mask,
	);
	m.shadowSide = FrontSide;
	if (look.rail.emissive)
		m.emissiveNode = color(look.deck.stripe).mul(mask.mul(2.2));
	return m;
}

function wallMaterial(look: CourseLook): Material {
	const w = look.wall;
	if (w.glass) {
		const m = new MeshPhysicalNodeMaterial({
			color: new Color(w.color),
			roughness: w.roughness,
			metalness: 0,
			transparent: true,
			opacity: 0.22,
			depthWrite: false,
			side: DoubleSide,
			clearcoat: 1,
		});
		// brighter toward the top edge, like thick glass catching light
		m.opacityNode = mix(float(0.12), float(0.5), smoothstep(0.55, 1, uv().x));
		return m;
	}
	return new MeshPhysicalNodeMaterial({
		color: new Color(w.color),
		roughness: w.roughness,
		metalness: w.metalness,
		clearcoat: 0.5,
		side: DoubleSide,
		shadowSide: FrontSide,
	});
}

function railMaterial(look: CourseLook): Material {
	const m = new MeshPhysicalNodeMaterial({
		color: new Color(look.rail.color),
		metalness: look.rail.emissive ? 0.2 : 1,
		roughness: look.rail.emissive ? 0.4 : 0.28,
		side: DoubleSide,
	});
	if (look.rail.emissive)
		m.emissiveNode = color(look.rail.emissive).mul(
			look.rail.emissiveIntensity ?? 3,
		);
	return m;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

/** Pose matrix of the track frame at sample i (X = right, Y = up, Z = forward). */
export function frameMatrix(t: Track, i: number, lift = 0, out = _m): Matrix4 {
	_x.set(t.rx[i] as number, t.ry[i] as number, t.rz[i] as number);
	_y.set(t.ux[i] as number, t.uy[i] as number, t.uz[i] as number);
	// Z = X x Y keeps the basis right-handed (it is -tangent)
	_z.crossVectors(_x, _y);
	out.makeBasis(_x, _y, _z);
	out.setPosition(
		(t.px[i] as number) + _y.x * lift,
		(t.py[i] as number) + _y.y * lift,
		(t.pz[i] as number) + _y.z * lift,
	);
	return out;
}

/** Everything static about a course: deck pieces, gates, pads, pillars, ground. */
export class TrackView {
	readonly root = new Group();
	readonly sweeperMeshes: Mesh[] = [];
	/** Checkpoint gate light strips (flash when crossed). */
	readonly gateGlow: MeshBasicNodeMaterial[] = [];
	readonly accent: Color;
	/** Deck, wall, rail, hull (look-dev toggles). */
	materials: Material[] = [];

	constructor(t: Track, look: CourseLook) {
		this.accent = new Color(look.accent);
		const mats = [deckMaterial(look), wallMaterial(look), railMaterial(look)];
		const hull = new MeshStandardNodeMaterial({
			color: new Color(look.hull.color),
			roughness: look.hull.roughness,
			metalness: look.hull.metalness,
			side: DoubleSide,
			shadowSide: FrontSide,
		});
		mats.push(hull);
		this.materials = mats;
		for (const pc of t.pieces) {
			const mesh = new Mesh(pieceGeometry(t, pc.i0, pc.i1), mats);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			mesh.name = "piece";
			this.root.add(mesh);
		}
		this.addGates(t, look);
		this.addBoosts(t, look);
		this.addSweepers(t, look);
		if (look.pillars) this.addPillars(t, look);
		this.addGround(t, look);
	}

	private gate(t: Track, i: number, look: CourseLook, finish: boolean): void {
		const w = t.width[i] as number;
		const span = w + 2 * WALL_FLARE + 0.6;
		const hgt = 3.4;
		const g = new Group();
		frameMatrix(t, i, 0).decompose(g.position, g.quaternion, g.scale);
		const frame = new MeshPhysicalNodeMaterial({
			color: new Color(finish ? "#f4f4f4" : look.hull.color),
			metalness: 0.9,
			roughness: 0.2,
		});
		const postG = new BoxGeometry(0.28, hgt, 0.28);
		for (const sx of [-1, 1]) {
			const p = new Mesh(postG, frame);
			p.position.set((sx * span) / 2, hgt / 2, 0);
			p.castShadow = true;
			g.add(p);
		}
		const beamH = finish ? 0.9 : 0.34;
		const beam = new Mesh(new BoxGeometry(span + 0.28, beamH, 0.3), frame);
		beam.position.set(0, hgt + beamH / 2, 0);
		beam.castShadow = true;
		g.add(beam);
		const glow = new MeshBasicNodeMaterial({ color: new Color(look.accent) });
		this.gateGlow.push(glow);
		const strip = new Mesh(new BoxGeometry(span - 0.1, 0.07, 0.32), glow);
		strip.position.set(0, hgt - 0.05, 0);
		g.add(strip);
		for (const sx of [-1, 1]) {
			const s = new Mesh(new BoxGeometry(0.07, hgt - 0.3, 0.3), glow);
			s.position.set((sx * (span - 0.36)) / 2 + sx * 0.18, hgt / 2, 0);
			g.add(s);
		}
		if (finish) {
			const banner = new MeshBasicNodeMaterial({ side: DoubleSide });
			const ck = checker(uv().mul(vec2(22, 2.2)));
			banner.colorNode = mix(color("#111111"), color("#f6f6f6"), ck).mul(1.4);
			const b = new Mesh(new PlaneGeometry(span + 0.2, beamH * 0.8), banner);
			b.position.set(0, hgt + beamH / 2, -0.16);
			g.add(b);
			const b2 = b.clone();
			b2.position.z = 0.16;
			g.add(b2);
		}
		g.name = "gate";
		this.root.add(g);
	}

	private addGates(t: Track, look: CourseLook): void {
		for (const i of t.checkpoints) this.gate(t, i, look, false);
		this.gate(t, t.finish, look, true);
		this.gate(t, 1, look, false);
	}

	private addBoosts(t: Track, look: CourseLook): void {
		const mat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
		});
		const u = uv().x;
		const v = uv().y;
		const across = abs(u.sub(0.5)).mul(2);
		// chevrons that race forward along the pad
		const chev = fract(v.mul(0.9).sub(across.mul(0.6)).sub(time.mul(2.4)));
		const band = smoothstep(0.0, 0.12, chev).mul(smoothstep(0.55, 0.4, chev));
		const edge = smoothstep(0.85, 1.0, across);
		const glow = max(band, edge);
		// a dark inlay with bright chevrons: reads on a white deck and a black one alike
		mat.colorNode = mix(
			color(look.accent).mul(0.16),
			color(look.accent).mul(1.15),
			glow,
		);
		mat.opacityNode = mix(float(0.78), float(1), glow);
		for (const pad of t.boosts) {
			const rings = pad.i1 - pad.i0 + 1;
			const pos = new Float32Array(rings * 2 * 3);
			const uvs = new Float32Array(rings * 2 * 2);
			const idx: number[] = [];
			for (let r = 0; r < rings; r++) {
				const i = pad.i0 + r;
				for (let k = 0; k < 2; k++) {
					const x = (k === 0 ? -1 : 1) * pad.half;
					const y = sag(t, i, x) + 0.03;
					const o = (r * 2 + k) * 3;
					pos[o] =
						(t.px[i] as number) +
						(t.rx[i] as number) * x +
						(t.ux[i] as number) * y;
					pos[o + 1] =
						(t.py[i] as number) +
						(t.ry[i] as number) * x +
						(t.uy[i] as number) * y;
					pos[o + 2] =
						(t.pz[i] as number) +
						(t.rz[i] as number) * x +
						(t.uz[i] as number) * y;
					uvs[(r * 2 + k) * 2] = k;
					uvs[(r * 2 + k) * 2 + 1] = (r * 0.5) / 2;
				}
				if (r + 1 < rings) {
					const a = r * 2;
					idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
				}
			}
			const g = new BufferGeometry();
			g.setAttribute("position", new BufferAttribute(pos, 3));
			g.setAttribute("uv", new BufferAttribute(uvs, 2));
			g.setIndex(idx);
			g.computeBoundingSphere();
			const m = new Mesh(g, mat);
			m.renderOrder = 2;
			m.name = "pad";
			this.root.add(m);
		}
	}

	private addSweepers(t: Track, look: CourseLook): void {
		const post = new MeshPhysicalNodeMaterial({
			color: new Color(look.hull.color),
			metalness: 0.8,
			roughness: 0.25,
		});
		const bar = new MeshPhysicalNodeMaterial({
			color: new Color("#e9ebef"),
			metalness: 1,
			roughness: 0.1,
		});
		// hazard tips glow in the course accent
		const tips = smoothstep(0.86, 0.97, abs(uv().x.sub(0.5)).mul(2)).mul(3);
		// on the neon course the whole bar glows faintly so it reads against the dark
		bar.emissiveNode = color(look.accent).mul(
			tips.add(look.rail.emissive ? 0.45 : 0),
		);
		for (const sw of t.sweepers) {
			const lift = MARBLE_RADIUS + 0.05;
			const p = new Mesh(new BoxGeometry(0.64, 1.8, 0.64), post);
			frameMatrix(t, sw.i, lift).decompose(p.position, p.quaternion, p.scale);
			p.castShadow = true;
			this.root.add(p);
			for (let k = 0; k < sw.count; k++) {
				const b = new Mesh(
					new BoxGeometry(
						sw.arm * 2,
						TUNE.sweeperThick * 2,
						TUNE.sweeperThick * 2,
					),
					bar,
				);
				b.castShadow = true;
				b.matrixAutoUpdate = false;
				this.root.add(b);
				this.sweeperMeshes.push(b);
			}
		}
	}

	private addPillars(t: Track, look: CourseLook): void {
		const every = Math.round((look.pillars?.every ?? 18) / 0.5);
		const spots: number[] = [];
		for (const pc of t.pieces)
			for (let i = pc.i0 + Math.floor(every / 2); i <= pc.i1 - 4; i += every) {
				// skip where another stretch of track runs underneath
				let blocked = false;
				for (let j = 0; j < t.n && !blocked; j += 2) {
					if (Math.abs(j - i) < 40) continue;
					if ((t.py[j] as number) > (t.py[i] as number)) continue;
					const d = Math.hypot(
						(t.px[j] as number) - (t.px[i] as number),
						(t.pz[j] as number) - (t.pz[i] as number),
					);
					if (d < (t.width[j] as number) / 2 + 2) blocked = true;
				}
				if (!blocked) spots.push(i);
			}
		const geo = new CylinderGeometry(0.35, 0.5, 1, 20, 1);
		geo.translate(0, -0.5, 0);
		const mat = new MeshStandardNodeMaterial({
			color: new Color(look.pillars?.color ?? "#ffffff"),
			roughness: 0.5,
			metalness: 0.1,
		});
		const inst = new InstancedMesh(geo, mat, spots.length);
		spots.forEach((i, k) => {
			const top = (t.py[i] as number) - HULL_DEPTH * 0.8;
			const h = Math.max(0.5, top - look.ground.y);
			_p.set(t.px[i] as number, top, t.pz[i] as number);
			_q.identity();
			_s.set(1, h, 1);
			_m.compose(_p, _q, _s);
			inst.setMatrixAt(k, _m);
		});
		inst.castShadow = true;
		inst.receiveShadow = true;
		inst.name = "pillars";
		this.root.add(inst);
		_s.set(1, 1, 1);
	}

	private addGround(t: Track, look: CourseLook): void {
		const gr = look.ground;
		// far larger than the fog range, so its edge never shows below the horizon
		const geo = new PlaneGeometry(gr.size * 12, gr.size * 12, 1, 1);
		geo.rotateX(-Math.PI / 2);
		const m = new MeshStandardNodeMaterial({
			roughness: gr.roughness,
			metalness: 0,
		});
		const wp = positionWorld.xz;
		if (gr.grid) {
			const cell = fract(wp.div(8));
			const line = max(
				smoothstep(0.96, 1, abs(cell.x.sub(0.5)).mul(2)),
				smoothstep(0.96, 1, abs(cell.y.sub(0.5)).mul(2)),
			);
			m.colorNode = mix(color(gr.color), color(gr.grid), line);
			if (look.rail.emissive)
				m.emissiveNode = color(gr.grid).mul(line.mul(1.6));
		} else {
			// meadow: two-scale noise for mown stripes and patches
			const n1 = mx_noise_float(wp.mul(0.02));
			const n2 = mx_noise_float(wp.mul(0.11));
			const stripes = step(0.5, fract(wp.x.mul(0.025))).mul(0.05);
			m.colorNode = color(gr.color).mul(
				n1.mul(0.18).add(n2.mul(0.08)).add(0.92).add(stripes),
			);
		}
		const g = new Mesh(geo, m);
		const cx = (t.bounds.min[0] + t.bounds.max[0]) / 2;
		const cz = (t.bounds.min[2] + t.bounds.max[2]) / 2;
		g.position.set(cx, gr.y, cz);
		g.receiveShadow = true;
		g.name = "ground";
		this.root.add(g);
	}
}
