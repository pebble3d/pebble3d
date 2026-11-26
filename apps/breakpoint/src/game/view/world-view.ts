import {
	abs,
	float,
	fract,
	mix,
	mx_fractal_noise_float,
	positionGeometry,
	positionWorld,
	smoothstep,
	vec2,
	vec3,
} from "three/tsl";
import {
	BoxGeometry,
	Color,
	CylinderGeometry,
	Group,
	IcosahedronGeometry,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	Quaternion,
	type Scene,
	TorusGeometry,
	Vector3,
} from "three/webgpu";
import type { BlockSpec } from "../blocks.ts";
import type { LevelDef } from "../levels.ts";
import { Rng } from "../rng.ts";

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * The quarry floor, scattered rocks and distant mesas, the score-line tape around the site,
 * and the cannon (its barrel follows the aim).
 */
export class WorldView {
	readonly cannon = new Group();
	private readonly barrel = new Group();
	private readonly lineGroup = new Group();
	private readonly tapeMat: MeshStandardNodeMaterial;
	private readonly postMat: MeshStandardNodeMaterial;
	/** Site footprint (x0, z0, x1, z1) incl. margin. */
	readonly bounds: [number, number, number, number] = [0, 0, 0, 0];

	constructor(scene: Scene) {
		scene.add(ground());
		scene.add(rocks());
		scene.add(this.lineGroup);
		this.tapeMat = new MeshStandardNodeMaterial({
			color: new Color("#ff7a1a"),
			emissive: new Color("#ff5a00"),
			emissiveIntensity: 1.6,
			roughness: 0.5,
		});
		this.postMat = new MeshStandardNodeMaterial({
			color: new Color("#2a2622"),
			roughness: 0.7,
		});
		this.buildCannon();
		scene.add(this.cannon);
	}

	/** Places the cannon and rebuilds the score-line tape around this level's blocks. */
	setLevel(level: LevelDef, blocks: readonly BlockSpec[]): void {
		const [lx, ly, lz] = level.launcher;
		this.cannon.position.set(lx, ly, lz);
		let x0 = Infinity;
		let z0 = Infinity;
		let x1 = -Infinity;
		let z1 = -Infinity;
		for (const b of blocks) {
			x0 = Math.min(x0, b.x);
			z0 = Math.min(z0, b.z);
			x1 = Math.max(x1, b.x);
			z1 = Math.max(z1, b.z);
		}
		const m = 2.2;
		x0 -= m;
		z0 -= m;
		x1 += m;
		z1 += m;
		this.bounds[0] = x0;
		this.bounds[1] = z0;
		this.bounds[2] = x1;
		this.bounds[3] = z1;
		for (const c of [...this.lineGroup.children]) {
			this.lineGroup.remove(c);
			(c as Mesh).geometry?.dispose();
		}
		const y = level.line;
		const corners: [number, number][] = [
			[x0, z0],
			[x1, z0],
			[x1, z1],
			[x0, z1],
		];
		for (let i = 0; i < 4; i++) {
			const [ax, az] = corners[i] as [number, number];
			const [bx, bz] = corners[(i + 1) % 4] as [number, number];
			const len = Math.hypot(bx - ax, bz - az);
			const tape = new Mesh(new BoxGeometry(len, 0.07, 0.03), this.tapeMat);
			tape.position.set((ax + bx) / 2, y, (az + bz) / 2);
			tape.rotation.y = -Math.atan2(bz - az, bx - ax);
			tape.castShadow = false;
			this.lineGroup.add(tape);
			// Posts every ~4 m along the edge.
			const n = Math.max(1, Math.round(len / 4));
			for (let k = 0; k < n; k++) {
				const t = k / n;
				const post = new Mesh(
					new CylinderGeometry(0.05, 0.06, y + 0.25, 8),
					this.postMat,
				);
				post.position.set(
					ax + (bx - ax) * t,
					(y + 0.25) / 2,
					az + (bz - az) * t,
				);
				post.castShadow = true;
				this.lineGroup.add(post);
			}
		}
	}

	/** Points the barrel along `dir` (world, normalised or not). */
	aim(dx: number, dy: number, dz: number): void {
		_v.set(dx, dy, dz).normalize();
		const yaw = Math.atan2(_v.x, _v.z);
		const pitch = Math.asin(Math.max(-1, Math.min(1, _v.y)));
		this.cannon.rotation.set(0, yaw + Math.PI, 0);
		this.barrel.rotation.set(pitch, 0, 0);
	}

	setLineVisible(v: boolean): void {
		this.lineGroup.visible = v;
	}

	private buildCannon(): void {
		const iron = new MeshStandardNodeMaterial({
			color: new Color("#5d6168"),
			roughness: 0.45,
			metalness: 0.6,
		});
		const brass = new MeshStandardNodeMaterial({
			color: new Color("#b98a3e"),
			roughness: 0.35,
			metalness: 0.9,
		});
		const wood = new MeshStandardNodeMaterial({
			color: new Color("#5b3d26"),
			roughness: 0.8,
		});
		// Earth mound under the carriage (local frame: muzzle at the origin, forward is -Z).
		const rampMat = new MeshStandardNodeMaterial({
			color: new Color("#86664a"),
			roughness: 0.97,
		});
		const ramp = new Mesh(new BoxGeometry(4.2, 1.0, 5.2), rampMat);
		ramp.position.set(0, -1.9, 1.6);
		ramp.castShadow = true;
		ramp.receiveShadow = true;
		this.cannon.add(ramp);
		const carriage = new Mesh(new BoxGeometry(1.5, 0.55, 2.6), wood);
		carriage.position.set(0, -1.0, 1.5);
		carriage.castShadow = true;
		carriage.receiveShadow = true;
		this.cannon.add(carriage);
		for (const sx of [-1, 1]) {
			const wheel = new Mesh(new TorusGeometry(0.5, 0.1, 10, 28), iron);
			wheel.position.set(sx * 0.9, -0.88, 1.7);
			wheel.rotation.y = Math.PI / 2;
			wheel.castShadow = true;
			this.cannon.add(wheel);
		}
		// Barrel pivots at its trunnions, 1.5 m behind the muzzle.
		this.barrel.position.set(0, -0.35, 1.5);
		this.cannon.add(this.barrel);
		const tube = new Mesh(
			new CylinderGeometry(0.4, 0.5, 3.2, 28, 1, true),
			iron,
		);
		tube.rotation.x = Math.PI / 2;
		tube.position.set(0, 0.35, 0);
		tube.castShadow = true;
		this.barrel.add(tube);
		const breech = new Mesh(new IcosahedronGeometry(0.5, 2), iron);
		breech.position.set(0, 0.35, 1.6);
		breech.castShadow = true;
		this.barrel.add(breech);
		for (const z of [-1.5, -0.6, 0.9]) {
			const band = new Mesh(
				new TorusGeometry(z < -1 ? 0.43 : 0.48, 0.05, 8, 28),
				brass,
			);
			band.position.set(0, 0.35, z);
			this.barrel.add(band);
		}
	}
}

/** Dusty quarry floor: layered noise in world XZ, compacted (darker, smoother) near the site. */
function ground(): Mesh {
	const geo = new PlaneGeometry(600, 600, 1, 1);
	geo.rotateX(-Math.PI / 2);
	const mat = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
	const p = vec2(positionWorld.x, positionWorld.z);
	const big = mx_fractal_noise_float(vec3(p.mul(0.035), 0.0), 4, 2.0, 0.55);
	const mid = mx_fractal_noise_float(vec3(p.mul(0.4), 3.0), 3, 2.0, 0.5);
	const fine = mx_fractal_noise_float(vec3(p.mul(3.5), 7.0), 2, 2.0, 0.5);
	const sand = vec3(0.34, 0.24, 0.155);
	const dirt = vec3(0.22, 0.15, 0.1);
	const pale = vec3(0.42, 0.33, 0.24);
	let c = mix(sand, dirt, smoothstep(-0.2, 0.35, big));
	c = mix(c, pale, smoothstep(0.15, 0.6, mid).mul(0.35));
	const r = p.length();
	// Packed earth around the site, wheel ruts towards the cannon.
	const packed = smoothstep(22.0, 12.0, r);
	c = mix(c, c.mul(0.82), packed);
	const rut = smoothstep(0.35, 0.0, abs(abs(positionWorld.x).sub(1.6))).mul(
		smoothstep(6.0, 10.0, positionWorld.z),
	);
	c = c.mul(float(1).sub(rut.mul(0.18)));
	mat.colorNode = c.mul(fine.mul(0.12).add(0.95));
	mat.roughnessNode = float(0.97).sub(packed.mul(0.1));
	const m = new Mesh(geo, mat);
	m.receiveShadow = true;
	m.name = "ground";
	return m;
}

/** Boulders around the quarry and mesas on the horizon (static decor). */
function rocks(): Group {
	const g = new Group();
	const rng = new Rng(4242);
	const mat = new MeshStandardNodeMaterial({ roughness: 0.92 });
	const n = mx_fractal_noise_float(positionGeometry.mul(1.7), 3, 2.0, 0.5);
	const base = vec3(0.3, 0.21, 0.15);
	mat.colorNode = base
		.mul(n.mul(0.25).add(0.85))
		.mul(fract(positionGeometry.y.mul(1.3)).mul(0.08).add(0.95));
	mat.flatShading = true;
	const geo = new IcosahedronGeometry(1, 1);
	const count = 90;
	const inst = new InstancedMesh(geo, mat, count + 9);
	let k = 0;
	for (let i = 0; i < count; i++) {
		const a = rng.range(0, Math.PI * 2);
		const r = rng.range(24, 95);
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		// Keep the line of fire and the cannon area clear.
		if (Math.abs(x) < 7 && z > -5 && z < 40) continue;
		const s = rng.range(0.3, 1.6) * (r > 60 ? 2 : 1);
		_s.set(
			s * rng.range(0.8, 1.6),
			s * rng.range(0.5, 1.0),
			s * rng.range(0.8, 1.5),
		);
		_q.setFromAxisAngle(UP, rng.range(0, 6.28));
		_v.set(x, _s.y * 0.35, z);
		_m.compose(_v, _q, _s);
		inst.setMatrixAt(k++, _m);
	}
	// Low ridges on the horizon, softened by the fog.
	for (let i = 0; i < 9; i++) {
		const a = -Math.PI / 2 + (i - 4) * 0.4 + rng.range(-0.1, 0.1);
		const r = rng.range(210, 250);
		const w = rng.range(50, 80);
		_s.set(w, rng.range(9, 20), w * rng.range(0.4, 0.7));
		_v.set(Math.cos(a) * r, -_s.y * 0.2, Math.sin(a) * r);
		_q.setFromAxisAngle(UP, a + Math.PI / 2 + rng.range(-0.3, 0.3));
		_m.compose(_v, _q, _s);
		inst.setMatrixAt(k++, _m);
	}
	inst.count = k;
	inst.castShadow = true;
	inst.receiveShadow = true;
	g.add(inst);
	return g;
}
