import { ToonNodeMaterial } from "@pebble3d/renderer";
import { uv, vec3 } from "three/tsl";
import {
	type Bone,
	Color,
	DoubleSide,
	Mesh,
	type Object3D,
	type Scene,
	type SkinnedMesh,
	SphereGeometry,
	Vector3,
} from "three/webgpu";
import { NINJA_PALETTE } from "./ninja-look.ts";
import { type ClothCollider, Ribbon, type RibbonOptions } from "./ribbon.ts";

/** A point rigidly attached to a bone, from a bind-pose mesh-space point (cm). */
interface Pin {
	bone: Object3D;
	local: Vector3;
}

const _p = new Vector3();
const _dir = new Vector3();
const _side = new Vector3();

function pinWorld(pin: Pin, out: Vector3): Vector3 {
	return out.copy(pin.local).applyMatrix4(pin.bone.matrixWorld);
}

/** Cloth tail tuning (metres, m/s^2). */
const HEADBAND_TAIL: RibbonOptions = {
	segments: 9,
	length: 0.46,
	width: 0.042,
	tipWidth: 0.026,
	gravity: 6.5,
	damping: 0.975,
	rootStiffness: 0.22,
	flutter: 5,
	flutterHz: 1.7,
};
const SASH_TAIL: RibbonOptions = {
	segments: 9,
	length: 0.5,
	width: 0.075,
	tipWidth: 0.055,
	gravity: 9,
	damping: 0.97,
	rootStiffness: 0.12,
	flutter: 2.5,
	flutterHz: 1.3,
};
export const CORD_TAIL: RibbonOptions = {
	segments: 7,
	length: 0.3,
	width: 0.012,
	tipWidth: 0.012,
	gravity: 8,
	damping: 0.96,
	rootStiffness: 0.15,
	flutter: 1.5,
	flutterHz: 2.1,
};

export function clothMaterial(hex: string): ToonNodeMaterial {
	const m = new ToonNodeMaterial({
		color: new Color(hex),
		roughness: 0.85,
		side: DoubleSide,
	});
	// a darker hem line along both long edges
	const u = uv().x;
	m.colorNode = vec3(new Color(hex).r, new Color(hex).g, new Color(hex).b).mul(
		u.sub(0.5).abs().greaterThan(0.38).select(0.55, 1),
	);
	m.toonRim = 1.4;
	return m;
}

/**
 * The ninja's cloth: two headband tails from a knot at the back of the head and two sash
 * ends from a knot at the back-left of the waist, verlet ribbons kept out of the head, chest
 * and hips. Updated after the sword layer has posed the skeleton. Presentation only.
 */
export class NinjaGear {
	private readonly tails: { ribbon: Ribbon; pin: Pin; dir: Pin; side: Pin }[] =
		[];
	private readonly colliders: (ClothCollider & { pin: Pin })[] = [];
	readonly knots: Mesh[] = [];

	constructor(scene: Scene, mesh: SkinnedMesh, bone: (name: string) => Bone) {
		const pin = (b: Bone, x: number, y: number, z: number): Pin => {
			const i = mesh.skeleton.bones.indexOf(b);
			const inv = mesh.skeleton.boneInverses[i];
			if (!inv) throw new Error(`ninja gear: ${b.name} not in the skin`);
			const local = new Vector3(x, y, z)
				.applyMatrix4(mesh.bindMatrix)
				.applyMatrix4(inv);
			return { bone: b, local };
		};
		const head = bone("Bip01 Head");
		const pelvis = bone("Bip01 Pelvis");
		const chest = bone("Bip01 Spine2");

		const band = clothMaterial(NINJA_PALETTE.headband);
		const sash = clothMaterial(NINJA_PALETTE.sash);
		const add = (
			mat: ToonNodeMaterial,
			o: RibbonOptions,
			b: Bone,
			at: [number, number, number],
			dir: [number, number, number],
			phase: number,
		): void => {
			const ribbon = new Ribbon(mat, o, phase);
			scene.add(ribbon.mesh);
			this.tails.push({
				ribbon,
				pin: pin(b, ...at),
				dir: pin(b, at[0] + dir[0], at[1] + dir[1], at[2] + dir[2]),
				side: pin(b, at[0] + 10, at[1], at[2]),
			});
		};
		// headband knot at the back of the head; the tails leave backward and down
		add(band, HEADBAND_TAIL, head, [1.4, 8.6, 171.4], [3, 10, -4], 0);
		add(
			band,
			{ ...HEADBAND_TAIL, length: 0.38 },
			head,
			[-1.4, 8.6, 171.4],
			[-3, 10, -6],
			0.37,
		);
		// sash knot at the back-left of the waist
		add(sash, SASH_TAIL, pelvis, [-9, 12.5, 94], [-1, 3, -10], 0.2);
		add(
			sash,
			{ ...SASH_TAIL, length: 0.4 },
			pelvis,
			[-12, 11.5, 94],
			[-5, 5, -10],
			0.6,
		);

		const knot = (
			mat: ToonNodeMaterial,
			b: Bone,
			at: [number, number, number],
			r: number,
		): void => {
			const m = new Mesh(new SphereGeometry(r, 10, 8), mat);
			m.scale.set(1.25, 0.8, 0.9);
			m.castShadow = true;
			b.updateWorldMatrix(true, false);
			b.getWorldScale(_p);
			const parentScale = _p.x;
			m.scale.multiplyScalar(1 / parentScale);
			m.position.copy(pin(b, ...at).local);
			b.add(m);
			this.knots.push(m);
		};
		knot(band, head, [0, 8.2, 171.4], 0.022);
		knot(sash, pelvis, [-10.5, 12, 94], 0.024);

		const collide = (b: Bone, at: [number, number, number], r: number) =>
			this.colliders.push({
				pin: pin(b, ...at),
				center: new Vector3(),
				radius: r,
			});
		collide(head, [0, 0, 168], 0.115);
		collide(chest, [0, 2, 128], 0.17);
		collide(pelvis, [0, 2, 95], 0.13);
		collide(pelvis, [0, 4, 80], 0.13);
		for (const t of this.tails) t.ribbon.colliders = this.colliders;
	}

	/** Bones must be posed and their world matrices current. */
	update(dt: number): void {
		for (const c of this.colliders) pinWorld(c.pin, c.center);
		for (const t of this.tails) {
			pinWorld(t.pin, _p);
			pinWorld(t.dir, _dir).sub(_p).normalize();
			pinWorld(t.side, _side).sub(_p).normalize();
			t.ribbon.update(dt, _p, _side, _dir);
		}
	}
}
