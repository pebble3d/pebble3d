import { readSlot } from "@pebble3d/renderer";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
	color,
	float,
	fract,
	mix,
	mx_worley_noise_vec2,
	positionLocal,
	positionWorld,
	sin,
	smoothstep,
	texture,
	time,
	uniform,
	uv,
	vec2,
	vec3,
} from "three/tsl";
import {
	AdditiveBlending,
	BoxGeometry,
	type BufferGeometry,
	Color,
	CylinderGeometry,
	DoubleSide,
	Group,
	LatheGeometry,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	OctahedronGeometry,
	PlaneGeometry,
	Quaternion,
	TorusGeometry,
	Vector2,
	Vector3,
} from "three/webgpu";
import {
	allBlocks,
	type BlockDef,
	type Course,
	type IslandDef,
	type MoverDef,
	yawTilt,
} from "../course.ts";
import { Rng } from "../rng.ts";
import { PHASE, type SkyrunSim } from "../sim.ts";
import { noiseTexture } from "./noise.ts";

const _p = new Vector3();
const _q = new Quaternion();

function std(
	opts: { roughness?: number; metalness?: number } = {},
): MeshStandardNodeMaterial {
	return new MeshStandardNodeMaterial({
		roughness: opts.roughness ?? 0.85,
		metalness: opts.metalness ?? 0,
	});
}

/** Shared procedural materials (TSL, no textures). */
function makeMaterials() {
	const wp = positionWorld;
	const tex = noiseTexture();
	const grass = std({ roughness: 0.95 });
	const gn = texture(tex, wp.xz.mul(1 / 24)).r;
	const gn2 = texture(tex, wp.xz.mul(1 / 3)).g;
	grass.colorNode = mix(
		color(new Color("#4f9a48")),
		color(new Color("#a8d05c")),
		smoothstep(0.25, 0.75, gn).add(gn2.sub(0.5).mul(0.35)),
	);

	const sand = std({ roughness: 0.95 });
	sand.colorNode = mix(
		color(new Color("#e2c193")),
		color(new Color("#f3dcb2")),
		texture(tex, wp.xz.mul(1 / 8)).r,
	);

	const flag = std({ roughness: 0.8 });
	const cell = mx_worley_noise_vec2(wp.xz.mul(0.9));
	const joint = smoothstep(0.0, 0.05, cell.y.sub(cell.x));
	flag.colorNode = mix(
		color(new Color("#8f8494")),
		mix(color(new Color("#d9cfc4")), color(new Color("#efe6da")), cell.x),
		joint,
	);

	// Rock undersides: warm sandstone strata fading to a lilac shadow toward the tip.
	const rock = std({ roughness: 0.92 });
	const band = sin(
		wp.y
			.mul(2.3)
			.add(texture(tex, wp.xz.mul(1 / 14).add(wp.y.mul(0.04))).b.mul(5)),
	);
	const strata = mix(
		color(new Color("#c58f6e")),
		color(new Color("#e2b48c")),
		band.mul(0.5).add(0.5),
	);
	rock.colorNode = mix(
		color(new Color("#665585")),
		strata,
		smoothstep(-7, -0.5, positionLocal.y),
	);
	rock.flatShading = true;

	const stone = std({ roughness: 0.75 });
	stone.colorNode = mix(
		color(new Color("#bfb09f")),
		color(new Color("#ddd0bf")),
		texture(tex, vec2(wp.x.add(wp.y), wp.z.sub(wp.y)).mul(1 / 5)).g,
	);

	const wood = std({ roughness: 0.7 });
	const plank = fract(wp.x.add(wp.z).mul(2.4));
	const seam = smoothstep(0.0, 0.03, plank).mul(smoothstep(1.0, 0.97, plank));
	wood.colorNode = mix(
		color(new Color("#7a4a30")),
		mix(
			color(new Color("#a86c43")),
			color(new Color("#c98d5a")),
			texture(tex, vec2(wp.x.add(wp.z).mul(0.1), wp.y.mul(1.5)))
				.g.mul(0.5)
				.add(0.5),
		),
		seam,
	);

	const brass = std({ roughness: 0.4, metalness: 0.6 });
	brass.colorNode = color(new Color("#e8b968"));

	const crystal = std({ roughness: 0.12, metalness: 0.1 });
	crystal.colorNode = color(new Color("#7fd6d2"));
	crystal.emissiveNode = color(new Color("#3fbfc8")).mul(
		smoothstep(
			0.3,
			1.0,
			sin(wp.y.mul(3).add(time.mul(1.5)))
				.mul(0.5)
				.add(0.5),
		).mul(0.35),
	);

	const enamel = std({ roughness: 0.4 });
	enamel.colorNode = color(new Color("#f4eee4"));

	const glow = new MeshBasicNodeMaterial();
	glow.colorNode = color(new Color("#7ff6ff")).mul(1.7);
	const gold = new MeshBasicNodeMaterial();
	gold.colorNode = color(new Color("#ffcf6a")).mul(3.4);

	return {
		grass,
		sand,
		flag,
		rock,
		stone,
		wood,
		brass,
		crystal,
		enamel,
		glow,
		gold,
	};
}
type Mats = ReturnType<typeof makeMaterials>;

/** Island underside: a jagged lathe, flat-shaded, seeded per island. */
function undersideGeo(i: IslandDef): BufferGeometry {
	const rng = new Rng(i.seed * 7919 + 13);
	const pts: Vector2[] = [];
	const r = i.radius;
	const steps = 7;
	pts.push(new Vector2(r * 0.985, -0.3));
	pts.push(new Vector2(r * 1.03, -0.75));
	for (let k = 1; k <= steps; k++) {
		const t = k / steps;
		const rad = r * (1 - t) ** 1.35 * (0.92 + rng.next() * 0.16);
		pts.push(new Vector2(Math.max(0.05, rad), -0.75 - t * i.depth));
	}
	const g = new LatheGeometry(pts, 14).toNonIndexed();
	const pos = g.getAttribute("position");
	// Jitter by quantised position so shared vertices of adjacent faces move together.
	const key = (x: number, y: number, z: number) =>
		`${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
	const offs = new Map<string, [number, number, number]>();
	for (let v = 0; v < pos.count; v++) {
		const x = pos.getX(v);
		const y = pos.getY(v);
		const z = pos.getZ(v);
		const k = key(x, y, z);
		let o = offs.get(k);
		if (!o) {
			const top = y > -0.5;
			const amp = top ? 0.04 : 0.35 * Math.min(1, -y / 2);
			o = [
				(rng.next() - 0.5) * amp,
				top ? 0 : (rng.next() - 0.5) * amp,
				(rng.next() - 0.5) * amp,
			];
			offs.set(k, o);
		}
		pos.setXYZ(v, x + o[0], y + o[1], z + o[2]);
	}
	g.computeVertexNormals();
	return g;
}

function blockGeo(b: BlockDef): BufferGeometry {
	const g = new BoxGeometry(b.size[0], b.size[1], b.size[2]);
	const [x, y, z, w] = yawTilt(b.yaw, b.tilt);
	g.applyQuaternion(_q.set(x, y, z, w));
	g.translate(b.pos[0], b.pos[1], b.pos[2]);
	return g;
}

interface MoverVisual {
	slot: number;
	root: Group;
}

/** A shard: spinning, bobbing crystal; hidden once taken. */
interface ShardVisual {
	mesh: Mesh;
	base: Vector3;
	phase: number;
}

interface CheckpointVisual {
	banner: Mesh;
	idle: Material;
	ring: Mesh;
	lit: boolean;
}

/**
 * Everything drawn for one course: merged static islands and blocks, mover meshes driven by
 * their sim slots, checkpoints, shards and the goal gate. `update` does not allocate.
 */
export class WorldView {
	readonly group = new Group();
	private readonly movers: MoverVisual[] = [];
	private readonly shards: ShardVisual[] = [];
	private readonly checkpoints: CheckpointVisual[] = [];
	private readonly owned: (BufferGeometry | Material)[] = [];
	private readonly mats: Mats;
	private readonly litBanner: Material;
	private readonly litRing: Material;
	private readonly beamOn = uniform(1);
	private t = 0;

	constructor(
		readonly course: Course,
		sim: SkyrunSim,
	) {
		const m = makeMaterials();
		this.mats = m;
		this.owned.push(...Object.values(m));

		// --- islands: tops per surface, undersides merged ---
		// Distant scenery islands (visual only) on a loose ring around the course.
		const decor: IslandDef[] = [];
		{
			let cx = 0;
			let cz = 0;
			for (const i of course.islands) {
				cx += i.pos[0] / course.islands.length;
				cz += i.pos[2] / course.islands.length;
			}
			const rng = new Rng(
				course.islands.length * 31 + Math.round(Math.abs(cx)),
			);
			for (let k = 0; k < 16; k++) {
				const a = (k / 16) * Math.PI * 2 + rng.next() * 0.3;
				const d = 85 + rng.next() * 140;
				const radius = 4 + rng.next() * 12;
				decor.push({
					pos: [
						cx + Math.cos(a) * d,
						-18 + rng.next() * 40,
						cz + Math.sin(a) * d,
					],
					radius,
					depth: radius * (1.2 + rng.next()),
					seed: 100 + k,
					top: rng.next() < 0.8 ? "grass" : "sand",
				});
			}
			// A few near pebbles hanging around the route, below the play height.
			for (let k = 0; k < 10; k++) {
				const base = course.islands[k % course.islands.length] as IslandDef;
				const a = rng.next() * Math.PI * 2;
				const d = base.radius + 6 + rng.next() * 10;
				const radius = 0.8 + rng.next() * 1.6;
				decor.push({
					pos: [
						base.pos[0] + Math.cos(a) * d,
						base.pos[1] - 4 - rng.next() * 8,
						base.pos[2] + Math.sin(a) * d,
					],
					radius,
					depth: radius * 2.2,
					seed: 200 + k,
					top: "grass",
				});
			}
		}
		// Course islands cast and receive shadows; distant scenery does neither (it would only
		// cost shadow-map passes).
		for (const [list, shadows] of [
			[course.islands, true],
			[decor, false],
		] as const) {
			const tops: Record<"grass" | "sand" | "stone", BufferGeometry[]> = {
				grass: [],
				sand: [],
				stone: [],
			};
			const rocks: BufferGeometry[] = [];
			for (const i of list) {
				const top = new CylinderGeometry(
					i.radius,
					i.radius * 0.985,
					0.3,
					shadows ? 40 : 20,
					1,
				);
				top.translate(i.pos[0], i.pos[1] - 0.15, i.pos[2]);
				tops[i.top].push(top);
				const u = undersideGeo(i);
				u.translate(i.pos[0], i.pos[1], i.pos[2]);
				rocks.push(u);
			}
			this.addMerged(tops.grass, m.grass, shadows, shadows);
			this.addMerged(tops.sand, m.sand, shadows, shadows);
			this.addMerged(tops.stone, m.flag, shadows, shadows);
			this.addMerged(rocks, m.rock, shadows, false);
		}

		// --- blocks, merged per kind ---
		const byKind: Record<string, BufferGeometry[]> = {};
		for (const b of allBlocks(course)) {
			const list = byKind[b.kind] ?? [];
			list.push(blockGeo(b));
			byKind[b.kind] = list;
		}
		for (const [kind, list] of Object.entries(byKind)) {
			const mat =
				kind === "wood"
					? m.wood
					: kind === "brass"
						? m.brass
						: kind === "crystal"
							? m.crystal
							: m.stone;
			this.addMerged(list, mat);
		}

		// --- movers ---
		course.movers.forEach((mv, k) => {
			const root = this.moverVisual(mv);
			this.group.add(root);
			this.movers.push({ slot: sim.moverSlots[k] as number, root });
		});

		// --- checkpoints ---
		const litBanner = std({ roughness: 0.6 });
		litBanner.colorNode = color(new Color("#ffcf6a"));
		litBanner.emissiveNode = color(new Color("#ff9a3a")).mul(0.6);
		litBanner.side = DoubleSide;
		this.litBanner = litBanner;
		this.litRing = m.gold;
		this.owned.push(litBanner);
		const banner = std({ roughness: 0.7 });
		banner.colorNode = color(new Color("#5ec8d8"));
		banner.side = DoubleSide;
		// Flutter: a travelling wave along the banner, stronger toward its free end.
		banner.positionNode = positionLocal.add(
			vec3(
				0,
				0,
				sin(positionLocal.x.mul(5).sub(time.mul(5))).mul(
					positionLocal.x.add(0.6).mul(0.08),
				),
			),
		);
		litBanner.positionNode = banner.positionNode;
		this.owned.push(banner);
		const poleGeo = new CylinderGeometry(0.06, 0.07, 3.2, 8);
		const bannerGeo = new PlaneGeometry(1.2, 0.7, 12, 2);
		bannerGeo.translate(0.6, 0, 0);
		const ringGeo = new TorusGeometry(1.25, 0.06, 6, 40);
		ringGeo.rotateX(Math.PI / 2);
		this.owned.push(poleGeo, bannerGeo, ringGeo);
		for (const cp of course.checkpoints) {
			const g = new Group();
			g.position.set(cp.pos[0], cp.pos[1], cp.pos[2]);
			const pole = new Mesh(poleGeo, m.brass);
			pole.position.set(-1.1, 1.6, 0);
			pole.castShadow = true;
			const b = new Mesh(bannerGeo, banner);
			b.position.set(-1.1, 2.75, 0);
			b.castShadow = true;
			const ring = new Mesh(ringGeo, m.glow);
			ring.position.y = 0.05;
			g.add(pole, b, ring);
			g.rotation.y = (cp.yaw * Math.PI) / 180;
			this.group.add(g);
			this.checkpoints.push({ banner: b, idle: banner, ring, lit: false });
		}

		// --- goal gate: two brass pillars, a lintel and a soft light column ---
		const goal = new Group();
		goal.position.set(
			course.goal.pos[0],
			course.goal.pos[1],
			course.goal.pos[2],
		);
		const pillarGeo = new BoxGeometry(0.45, 3.6, 0.45);
		const lintelGeo = new BoxGeometry(4.2, 0.4, 0.6);
		const trimGeo = new BoxGeometry(4.25, 0.08, 0.65);
		this.owned.push(pillarGeo, lintelGeo, trimGeo);
		for (const sx of [-1.9, 1.9]) {
			const pl = new Mesh(pillarGeo, m.enamel);
			pl.position.set(sx, 1.8, 0);
			pl.castShadow = true;
			goal.add(pl);
		}
		const lintel = new Mesh(lintelGeo, m.brass);
		lintel.position.y = 3.75;
		lintel.castShadow = true;
		const trim = new Mesh(trimGeo, m.gold);
		trim.position.y = 3.5;
		goal.add(lintel, trim);
		const beamMat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			side: DoubleSide,
		});
		const fade = float(1).sub(uv().y).pow(1.6);
		beamMat.colorNode = color(new Color("#ffcf7a"))
			.mul(fade.mul(0.55))
			.mul(this.beamOn);
		const beamGeo = new CylinderGeometry(1.6, 1.6, 26, 32, 1, true);
		beamGeo.translate(0, 13, 0);
		this.owned.push(beamMat, beamGeo);
		const beam = new Mesh(beamGeo, beamMat);
		beam.renderOrder = 3;
		goal.add(beam);
		const pad = new Mesh(ringGeo, m.gold);
		pad.scale.setScalar(1.4);
		pad.position.y = 0.05;
		goal.add(pad);
		// Face the gate across the approach: lintel perpendicular to the last checkpoint's way in.
		const last = course.checkpoints[course.checkpoints.length - 1];
		if (last)
			goal.rotation.y = Math.atan2(
				course.goal.pos[0] - last.pos[0],
				course.goal.pos[2] - last.pos[2],
			);
		this.group.add(goal);

		// --- shards ---
		const shardGeo = new OctahedronGeometry(0.3, 0);
		shardGeo.scale(1, 1.7, 1);
		const shardMat = new MeshStandardNodeMaterial({
			roughness: 0.15,
			metalness: 0.2,
		});
		shardMat.colorNode = color(new Color("#b9f6ff"));
		shardMat.emissiveNode = color(new Color("#53e6ff")).mul(2.2);
		this.owned.push(shardGeo, shardMat);
		course.shards.forEach((p, i) => {
			const mesh = new Mesh(shardGeo, shardMat);
			mesh.position.set(p[0], p[1], p[2]);
			mesh.castShadow = true;
			this.group.add(mesh);
			this.shards.push({
				mesh,
				base: new Vector3(p[0], p[1], p[2]),
				phase: i * 1.7,
			});
		});
	}

	private addMerged(
		list: BufferGeometry[],
		mat: Material,
		cast = true,
		receive = true,
	): void {
		if (list.length === 0) return;
		const merged = mergeGeometries(list, false);
		for (const g of list) g.dispose();
		if (!merged) return;
		this.owned.push(merged);
		const mesh = new Mesh(merged, mat);
		mesh.castShadow = cast;
		mesh.receiveShadow = receive;
		this.group.add(mesh);
	}

	private moverVisual(mv: MoverDef): Group {
		const m = this.mats;
		const g = new Group();
		const [sx, sy, sz] = mv.size;
		if (mv.shape === "disc") {
			const r = sx / 2;
			const body = new CylinderGeometry(r, r, sy, 48);
			const rim = new TorusGeometry(r - 0.06, 0.07, 6, 64);
			rim.rotateX(Math.PI / 2);
			rim.translate(0, sy / 2 + 0.01, 0);
			const spokes = new BoxGeometry(sx * 0.92, 0.04, 0.16);
			spokes.translate(0, sy / 2 + 0.03, 0);
			const spokes2 = spokes.clone().rotateY(Math.PI / 2);
			const under = new CylinderGeometry(r * 0.35, r * 0.1, 1.4, 16);
			under.translate(0, -sy / 2 - 0.7, 0);
			const brassParts = mergeGeometries([spokes, spokes2, under], false);
			spokes.dispose();
			spokes2.dispose();
			under.dispose();
			this.owned.push(body, rim, brassParts);
			const b = new Mesh(body, m.enamel);
			b.castShadow = true;
			b.receiveShadow = true;
			const u = new Mesh(brassParts, m.brass);
			u.castShadow = true;
			// A wooden deck inside the rim, so the top is not a bright white plate.
			const deckGeo = new CylinderGeometry(r - 0.16, r - 0.16, 0.04, 48);
			deckGeo.translate(0, sy / 2 + 0.005, 0);
			this.owned.push(deckGeo);
			const deck = new Mesh(deckGeo, m.wood);
			deck.receiveShadow = true;
			g.add(b, deck, new Mesh(rim, m.glow), u);
		} else {
			const body = new BoxGeometry(sx, sy, sz);
			const deck = new BoxGeometry(sx - 0.24, 0.04, sz - 0.24);
			deck.translate(0, sy / 2 + 0.005, 0);
			this.owned.push(body, deck);
			const b = new Mesh(body, m.enamel);
			b.castShadow = true;
			b.receiveShadow = true;
			const d = new Mesh(deck, m.wood);
			d.receiveShadow = true;
			g.add(b, d);
			// Glowing trim along the four top edges, merged into one mesh.
			const t = 0.045;
			const trims: BufferGeometry[] = [];
			for (const [w, dpt, x, z] of [
				[sx, t, 0, sz / 2],
				[sx, t, 0, -sz / 2],
				[t, sz, sx / 2, 0],
				[t, sz, -sx / 2, 0],
			] as const) {
				trims.push(new BoxGeometry(w + t, t, dpt + t).translate(x, sy / 2, z));
			}
			const trim = mergeGeometries(trims, false);
			for (const e of trims) e.dispose();
			if (trim) {
				this.owned.push(trim);
				g.add(new Mesh(trim, m.glow));
			}
			// A small brass keel so platforms read as machines, not slabs.
			const keel = new BoxGeometry(sx * 0.4, 0.5, sz * 0.4);
			keel.translate(0, -sy / 2 - 0.25, 0);
			this.owned.push(keel);
			const k = new Mesh(keel, m.brass);
			k.castShadow = true;
			g.add(k);
		}
		return g;
	}

	update(
		sim: SkyrunSim,
		prev: Float32Array,
		curr: Float32Array,
		alpha: number,
		dt: number,
	): void {
		this.t += dt;
		for (const mv of this.movers) {
			if (readSlot(prev, curr, mv.slot, alpha, _p, _q)) {
				mv.root.position.copy(_p);
				mv.root.quaternion.copy(_q);
			}
		}
		for (let i = 0; i < this.shards.length; i++) {
			const s = this.shards[i] as ShardVisual;
			const taken = sim.shardTaken[i] === 1;
			s.mesh.visible = !taken;
			if (taken) continue;
			s.mesh.position.set(
				s.base.x,
				s.base.y + Math.sin(this.t * 2 + s.phase) * 0.15,
				s.base.z,
			);
			s.mesh.rotation.y = this.t * 1.8 + s.phase;
		}
		for (let i = 0; i < this.checkpoints.length; i++) {
			const c = this.checkpoints[i] as CheckpointVisual;
			const lit = i < sim.nextCheckpoint;
			if (lit !== c.lit) {
				c.lit = lit;
				c.banner.material = lit ? this.litBanner : c.idle;
				c.ring.material = lit ? this.litRing : this.mats.glow;
			}
		}
		this.beamOn.value =
			sim.phase === PHASE.DONE
				? 0.12
				: sim.nextCheckpoint >= this.course.checkpoints.length
					? 1
					: 0.25;
	}

	dispose(): void {
		this.group.removeFromParent();
		for (const o of this.owned) o.dispose();
	}
}
