import {
	abs,
	float,
	max,
	mix,
	positionLocal,
	sin,
	smoothstep,
	uniform,
	uv,
	vec3,
} from "three/tsl";
import {
	AdditiveBlending,
	BoxGeometry,
	Color,
	CylinderGeometry,
	DoubleSide,
	Group,
	IcosahedronGeometry,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	type Object3D,
	OctahedronGeometry,
	PlaneGeometry,
	Quaternion,
	type Scene,
	Shape,
	ShapeGeometry,
	SphereGeometry,
	TorusGeometry,
	TorusKnotGeometry,
	Vector3,
} from "three/webgpu";
import { ANOMALIES } from "../anomalies.ts";
import type { FieldSim } from "../sim.ts";

const MOTES_PER = 9;
/** Seconds an anomaly takes to materialise once revealed. */
const MATERIALISE = 1.3;

type U = { value: number };

interface Built {
	root: Group;
	/** 0..1 glow multiplier, animated. */
	glow: U;
	animate(t: number, root: Group): void;
}

function glowMat(
	hex: string,
	intensity: number,
	glow: U,
): MeshBasicNodeMaterial {
	const m = new MeshBasicNodeMaterial();
	const c = new Color(hex);
	m.colorNode = vec3(c.r, c.g, c.b)
		.mul(float(intensity))
		.mul(glow as never);
	return m;
}

function chrome(): MeshStandardNodeMaterial {
	return new MeshStandardNodeMaterial({
		color: "#e6e8ec",
		metalness: 1,
		roughness: 0.07,
	});
}

function obsidian(): MeshStandardNodeMaterial {
	return new MeshStandardNodeMaterial({
		color: "#15161a",
		metalness: 0.35,
		roughness: 0.18,
	});
}

function shadowed<T extends Object3D>(o: T): T {
	o.traverse((c) => {
		if ((c as Mesh).isMesh) {
			c.castShadow = true;
			c.receiveShadow = true;
		}
	});
	return o;
}

/** Lantern Moth: a hot faceted core with two fanned, slow-beating wings. */
function moth(hue: string): Built {
	const glow = uniform(1);
	const root = new Group();
	const core = new Mesh(
		new IcosahedronGeometry(0.13, 0),
		glowMat(hue, 3.2, glow),
	);
	const shell = new Mesh(
		new IcosahedronGeometry(0.2, 0),
		new MeshStandardNodeMaterial({
			color: "#2a1a0a",
			metalness: 0.6,
			roughness: 0.25,
			wireframe: true,
		}),
	);
	const wingShape = new Shape();
	wingShape.moveTo(0, 0);
	wingShape.bezierCurveTo(0.12, 0.28, 0.42, 0.34, 0.46, 0.12);
	wingShape.bezierCurveTo(0.48, -0.04, 0.3, -0.16, 0, 0);
	const wingGeo = new ShapeGeometry(wingShape, 12);
	const wingMat = new MeshBasicNodeMaterial({
		side: DoubleSide,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
	const c = new Color(hue);
	// Brighter veins toward the wing's leading edge.
	wingMat.colorNode = vec3(c.r, c.g, c.b)
		.mul(smoothstep(0.0, 0.32, positionLocal.y).mul(0.9).add(0.12))
		.mul(glow as never);
	const wingL = new Group();
	const wingR = new Group();
	const mL = new Mesh(wingGeo, wingMat);
	const mR = new Mesh(wingGeo, wingMat);
	mR.scale.x = -1;
	wingL.add(mL);
	wingR.add(mR);
	root.add(core, shell, wingL, wingR);
	shadowed(shell);
	shadowed(core);
	return {
		root,
		glow,
		animate(t) {
			const beat = Math.sin(t * 2.4) * 0.65 + 0.25;
			wingL.rotation.y = -beat;
			wingR.rotation.y = beat;
			shell.rotation.set(t * 0.3, t * 0.5, 0);
			glow.value = 0.85 + 0.15 * Math.sin(t * 4.1);
		},
	};
}

/** Halo Knot: a mirror-chrome knot around a cold glowing ring. */
function knot(hue: string): Built {
	const glow = uniform(1);
	const root = new Group();
	const k = new Mesh(
		new TorusKnotGeometry(0.27, 0.055, 200, 20, 2, 3),
		chrome(),
	);
	const ring = new Mesh(
		new TorusGeometry(0.12, 0.018, 12, 48),
		glowMat(hue, 6, glow),
	);
	const inner = new Mesh(
		new SphereGeometry(0.05, 16, 12),
		glowMat(hue, 9, glow),
	);
	root.add(k, ring, inner);
	shadowed(k);
	return {
		root,
		glow,
		animate(t) {
			k.rotation.set(t * 0.21, t * 0.37, t * 0.11);
			ring.rotation.set(t * -0.8, t * 0.5, 0);
			glow.value = 0.8 + 0.2 * Math.sin(t * 1.7);
		},
	};
}

/** Drift Prism: three obsidian prisms turning against each other on seams of light. */
function prism(hue: string): Built {
	const glow = uniform(1);
	const root = new Group();
	const prismGeo = new CylinderGeometry(0.28, 0.28, 0.22, 3, 1);
	const seamGeo = new CylinderGeometry(0.2, 0.2, 0.012, 3, 1);
	const parts: Mesh[] = [];
	const seams: Mesh[] = [];
	for (let i = 0; i < 3; i++) {
		const p = new Mesh(prismGeo, obsidian());
		p.position.y = (i - 1) * 0.27;
		p.scale.setScalar(1 - Math.abs(i - 1) * 0.18);
		root.add(p);
		parts.push(p);
	}
	for (let i = 0; i < 2; i++) {
		const s = new Mesh(seamGeo, glowMat(hue, 7, glow));
		s.position.y = (i - 0.5) * 0.27;
		root.add(s);
		seams.push(s);
	}
	shadowed(root);
	return {
		root,
		glow,
		animate(t) {
			for (let i = 0; i < parts.length; i++)
				(parts[i] as Mesh).rotation.y = t * (i % 2 === 0 ? 0.6 : -0.9) + i;
			for (let i = 0; i < seams.length; i++)
				(seams[i] as Mesh).rotation.y = -t * 1.3 + i * 1.1;
			root.rotation.z = Math.sin(t * 0.7) * 0.12;
			glow.value = 0.75 + 0.25 * Math.sin(t * 3.0);
		},
	};
}

/** Seed Choir: fourteen lights orbiting an empty chrome bead on tilted rings. */
function choir(hue: string): Built {
	const glow = uniform(1);
	const root = new Group();
	const bead = new Mesh(new SphereGeometry(0.09, 32, 16), chrome());
	root.add(bead);
	const N = 14;
	const seeds = new InstancedMesh(
		new SphereGeometry(0.055, 14, 10),
		glowMat(hue, 8, glow),
		N,
	);
	seeds.frustumCulled = false;
	root.add(seeds);
	shadowed(root);
	const m = new Matrix4();
	return {
		root,
		glow,
		animate(t) {
			for (let i = 0; i < N; i++) {
				const ring = i % 3;
				const r = 0.3 + ring * 0.13;
				const sp = 0.9 - ring * 0.22;
				const a = t * sp + (i / N) * Math.PI * 2 * 3;
				const tilt = (ring - 1) * 0.55;
				const x = Math.cos(a) * r;
				const z = Math.sin(a) * r;
				m.makeTranslation(
					x,
					z * Math.sin(tilt) + Math.sin(t * 1.3 + i) * 0.03,
					z * Math.cos(tilt),
				);
				seeds.setMatrixAt(i, m);
			}
			seeds.instanceMatrix.needsUpdate = true;
			bead.rotation.y = t;
			glow.value = 0.8 + 0.2 * Math.sin(t * 2.2);
		},
	};
}

/** Static Bloom: crystal shards growing out of a point, glowing toward their tips. */
function bloomShards(hue: string): Built {
	const glow = uniform(1);
	const root = new Group();
	const shardGeo = new OctahedronGeometry(0.5, 0);
	shardGeo.translate(0, 0.5, 0); // base at the origin, tip at y = 1
	const c = new Color(hue);
	const mat = new MeshStandardNodeMaterial({
		color: "#4a3d6e",
		metalness: 0.2,
		roughness: 0.1,
	});
	mat.emissiveNode = vec3(c.r, c.g, c.b)
		.mul(smoothstep(0.05, 1.0, positionLocal.y).mul(5).add(0.25))
		.mul(glow as never);
	const N = 17;
	const shards = new InstancedMesh(shardGeo, mat, N);
	shards.frustumCulled = false;
	const quats: Quaternion[] = [];
	const lens: number[] = [];
	const dir = new Vector3();
	const up = new Vector3(0, 1, 0);
	// Golden-angle spread over the upper sphere: deterministic, even.
	for (let i = 0; i < N; i++) {
		const y = 1 - (i / 16) * 1.35;
		const rr = Math.sqrt(Math.max(0, 1 - y * y));
		const a = i * 2.39996;
		dir.set(Math.cos(a) * rr, y, Math.sin(a) * rr).normalize();
		quats.push(new Quaternion().setFromUnitVectors(up, dir));
		lens.push(0.32 + ((i * 7) % 5) * 0.07);
	}
	root.add(shards);
	shadowed(root);
	const m = new Matrix4();
	const zero = new Vector3();
	const sc = new Vector3();
	return {
		root,
		glow,
		animate(t) {
			for (let i = 0; i < N; i++) {
				sc.set(
					0.09,
					(lens[i] as number) * (0.88 + 0.12 * Math.sin(t * 2.6 + i)),
					0.09,
				);
				m.compose(zero, quats[i] as Quaternion, sc);
				shards.setMatrixAt(i, m);
			}
			shards.instanceMatrix.needsUpdate = true;
			root.rotation.y = t * 0.15;
			glow.value = 0.7 + 0.3 * Math.abs(Math.sin(t * 1.9));
		},
	};
}

/** Hollow Door: a weathered frame standing in the grass around a shimmering membrane. */
function door(hue: string): Built {
	const glow = uniform(1);
	const root = new Group();
	const frameMat = new MeshStandardNodeMaterial({
		color: "#3a3631",
		metalness: 0.15,
		roughness: 0.62,
	});
	const W = 1.0;
	const H = 2.05;
	const T = 0.1;
	const post = new BoxGeometry(T, H, T * 1.4);
	const lintel = new BoxGeometry(W + T * 2.4, T * 1.3, T * 1.6);
	const left = new Mesh(post, frameMat);
	left.position.set(-W / 2 - T / 2, H / 2, 0);
	const right = new Mesh(post, frameMat);
	right.position.set(W / 2 + T / 2, H / 2, 0);
	const top = new Mesh(lintel, frameMat);
	top.position.set(0, H + T * 0.6, 0);
	const sill = new Mesh(new BoxGeometry(W + T * 2, 0.05, T * 1.8), frameMat);
	sill.position.set(0, 0.025, 0);
	// Glowing inner edge.
	const edgeMat = glowMat(hue, 4, glow);
	const edgeL = new Mesh(new BoxGeometry(0.018, H, 0.02), edgeMat);
	edgeL.position.set(-W / 2 + 0.01, H / 2, 0);
	const edgeR = edgeL.clone();
	edgeR.position.x = W / 2 - 0.01;
	const edgeT = new Mesh(new BoxGeometry(W, 0.018, 0.02), edgeMat);
	edgeT.position.set(0, H - 0.01, 0);
	const c = new Color(hue);
	const membraneMat = new MeshBasicNodeMaterial({
		side: DoubleSide,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
	const tu = uniform(0);
	const u = uv();
	const ripple = sin(
		u.y
			.mul(46)
			.add(tu.mul(2.6))
			.add(sin(u.x.mul(13).add(tu)).mul(2)),
	);
	const edge = max(abs(u.x.sub(0.5)).mul(2), abs(u.y.sub(0.5)).mul(2));
	membraneMat.colorNode = vec3(c.r, c.g, c.b)
		.mul(mix(float(0.05), float(0.55), smoothstep(0.55, 1.0, edge)))
		.add(vec3(c.r, c.g, c.b).mul(ripple.mul(0.5).add(0.5).mul(0.12)))
		.mul(glow as never);
	const membrane = new Mesh(new PlaneGeometry(W, H), membraneMat);
	membrane.position.y = H / 2;
	root.add(left, right, top, sill, edgeL, edgeR, edgeT, membrane);
	for (const m of [left, right, top, sill]) {
		m.castShadow = true;
		m.receiveShadow = true;
	}
	return {
		root,
		glow,
		animate(t) {
			tu.value = t;
			glow.value = 0.85 + 0.15 * Math.sin(t * 1.3);
		},
	};
}

/**
 * The six anomalies at their sim positions. Hidden ones show only a faint drift of motes
 * (findable by eye); once revealed they materialise and animate. Animation runs on sim time
 * so fixed-tick captures are reproducible. `update` does not allocate.
 */
export class AnomalyView {
	private readonly built: Built[] = [];
	private readonly motes: InstancedMesh;
	private readonly m = new Matrix4();
	private readonly p = new Vector3();
	readonly roots: Group[] = [];

	constructor(
		scene: Scene,
		private sim: FieldSim,
	) {
		for (const a of sim.anomalies) {
			const hue = a.def.hue;
			const b =
				a.def.id === "moth"
					? moth(hue)
					: a.def.id === "knot"
						? knot(hue)
						: a.def.id === "prism"
							? prism(hue)
							: a.def.id === "choir"
								? choir(hue)
								: a.def.id === "bloom"
									? bloomShards(hue)
									: door(hue);
			const holder = new Group();
			holder.add(b.root);
			holder.visible = false;
			scene.add(holder);
			this.built.push(b);
			this.roots.push(holder);
		}
		this.place();
		const moteMat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
		});
		moteMat.colorNode = vec3(1.25, 1.05, 0.7);
		this.motes = new InstancedMesh(
			new SphereGeometry(0.009, 6, 4),
			moteMat,
			ANOMALIES.length * MOTES_PER,
		);
		this.motes.frustumCulled = false;
		this.motes.castShadow = false;
		scene.add(this.motes);
	}

	/** A new survey: the same six anomalies at the new sim's spots. */
	rebind(sim: FieldSim): void {
		this.sim = sim;
		this.place();
	}

	/** The door stands on the floor; the rest hover at their subject height. */
	private place(): void {
		this.sim.anomalies.forEach((a, i) => {
			const holder = this.roots[i];
			if (!holder) return;
			holder.position.set(a.x, a.def.id === "door" ? 0 : a.y, a.z);
			// PlaneGeometry faces +Z; turn it to the sim's facing (a direction in XZ).
			holder.rotation.y = a.def.id === "door" ? a.facing : 0;
			holder.visible = false;
		});
	}

	update(t: number): void {
		const sim = this.sim;
		for (let i = 0; i < sim.anomalies.length; i++) {
			const a = sim.anomalies[i];
			const b = this.built[i];
			const holder = this.roots[i];
			if (!a || !b || !holder) continue;
			let k = 0;
			if (a.revealed) {
				const age = (sim.tick - a.revealTick) / 60;
				k = Math.min(1, age / MATERIALISE);
				holder.visible = true;
				// Overshoot then settle, with a brief flicker while forming.
				const e = 1 - (1 - k) ** 3;
				const over = 1 + Math.sin(k * Math.PI) * 0.12;
				const s = Math.max(0.001, e * over);
				b.root.scale.setScalar(s);
				b.root.position.y =
					a.def.id === "door" ? 0 : Math.sin(t * 0.9 + i) * 0.05;
				b.animate(t + i * 3.1, b.root);
				if (k < 1)
					b.glow.value *=
						1 + 2.5 * (1 - k) * (Math.sin(age * 60) > 0 ? 1 : 0.2);
			} else holder.visible = false;
			// Motes: a slow upward drift around the spot, stronger while hidden.
			const spread = a.def.id === "door" ? 0.7 : 0.45;
			for (let j = 0; j < MOTES_PER; j++) {
				const ph = (t * 0.22 + j / MOTES_PER + i * 0.37) % 1;
				const ang = j * 2.4 + i + t * 0.3;
				const r = spread * (0.4 + (0.6 * ((j * 37) % 10)) / 10);
				this.p.set(
					a.x + Math.cos(ang) * r,
					0.15 + ph * (a.y + 0.9),
					a.z + Math.sin(ang) * r,
				);
				const size = (1 - Math.abs(ph * 2 - 1)) * (a.revealed ? 0.8 : 1.4);
				this.m.makeScale(size, size, size).setPosition(this.p);
				this.motes.setMatrixAt(i * MOTES_PER + j, this.m);
			}
		}
		this.motes.instanceMatrix.needsUpdate = true;
	}
}
