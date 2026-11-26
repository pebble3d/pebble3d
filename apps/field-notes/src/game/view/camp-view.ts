import {
	BoxGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshStandardNodeMaterial,
	type Object3D,
	PlaneGeometry,
	type Scene,
	SphereGeometry,
	Vector3,
} from "three/webgpu";
import type { SiteView } from "../sim.ts";
import { mergeByMaterial } from "./merge.ts";

const _mats = new Map<string, MeshStandardNodeMaterial>();
/** Shared per look, so `mergeByMaterial` can batch every prop that uses it. */
function mat(
	color: string,
	roughness: number,
	metalness = 0,
): MeshStandardNodeMaterial {
	const k = `${color}|${roughness}|${metalness}`;
	let m = _mats.get(k);
	if (!m) {
		m = new MeshStandardNodeMaterial({ color, roughness, metalness });
		_mats.set(k, m);
	}
	return m;
}
const FLAG = new MeshStandardNodeMaterial({
	color: "#ff6a1f",
	roughness: 0.7,
	side: DoubleSide,
});

function cast<T extends Object3D>(o: T): T {
	o.traverse((c) => {
		if ((c as Mesh).isMesh) {
			c.castShadow = true;
			c.receiveShadow = true;
		}
	});
	return o;
}

/** A survey stake: a pale timber peg with an orange tape flag. */
function stake(x: number, z: number, lean: number, flagRot: number): Group {
	const g = new Group();
	const peg = new Mesh(
		new BoxGeometry(0.035, 0.62, 0.035),
		mat("#c9b48e", 0.85),
	);
	peg.position.y = 0.29;
	const tip = new Mesh(
		new CylinderGeometry(0.0, 0.025, 0.08, 4),
		mat("#c9b48e", 0.85),
	);
	tip.position.y = -0.04;
	const flag = new Mesh(new PlaneGeometry(0.16, 0.09), FLAG);
	flag.position.set(0.085, 0.52, 0);
	flag.rotation.y = flagRot;
	g.add(peg, tip, flag);
	g.position.set(x, 0, z);
	g.rotation.z = lean;
	return cast(g);
}

/**
 * The researcher's kit, per site: a hard field case with a lantern, a tripod, and survey
 * stakes. Plain PBR meshes on the splat floor: they cast shadows onto
 * the capture (shadow catcher) and the case is a static collider (world.json obstacle).
 */
export function buildCamp(scene: Scene, props: SiteView["props"]): Group {
	const root = new Group();
	// Field case: 0.84 x 0.5 x 0.56, dark olive shell, steel latches (an obstacle in the world).
	const shell = mat("#3e4434", 0.55, 0.05);
	const steel = mat("#b8bcc2", 0.3, 1);
	const caseG = new Group();
	const body = new Mesh(new BoxGeometry(0.84, 0.42, 0.56), shell);
	body.position.y = 0.21;
	const lid = new Mesh(new BoxGeometry(0.86, 0.08, 0.58), shell);
	lid.position.y = 0.46;
	const handle = new Mesh(
		new BoxGeometry(0.22, 0.03, 0.04),
		mat("#15161a", 0.5),
	);
	handle.position.set(0, 0.52, 0);
	caseG.add(body, lid, handle);
	for (const sx of [-0.3, 0.3]) {
		const latch = new Mesh(new BoxGeometry(0.06, 0.08, 0.02), steel);
		latch.position.set(sx, 0.4, 0.29);
		caseG.add(latch);
	}
	// Lantern on the case.
	const lantern = new Group();
	const base = new Mesh(new CylinderGeometry(0.06, 0.07, 0.03, 16), steel);
	const glass = new Mesh(
		new CylinderGeometry(0.05, 0.05, 0.12, 16),
		new MeshStandardNodeMaterial({
			color: "#ffe2a8",
			emissive: "#ffb85c",
			emissiveIntensity: 3,
			roughness: 0.2,
		}),
	);
	glass.position.y = 0.075;
	const cap = new Mesh(
		new SphereGeometry(0.06, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
		steel,
	);
	cap.position.y = 0.135;
	lantern.add(base, glass, cap);
	lantern.position.set(0.22, 0.5, -0.08);
	caseG.add(lantern);
	if (props.case) {
		caseG.position.set(props.case[0], 0, props.case[1]);
		caseG.rotation.y = props.case[2];
		root.add(caseG);
	}

	// Tripod with a little survey camera, next to the case.
	const tripod = new Group();
	const legMat = mat("#22252b", 0.4, 0.6);
	const top = new Vector3(0, 1.26, 0);
	const foot = new Vector3();
	const dir = new Vector3();
	const up = new Vector3(0, 1, 0);
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2 + 0.4;
		foot.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36);
		dir.subVectors(top, foot);
		const len = dir.length();
		const leg = new Mesh(new CylinderGeometry(0.011, 0.016, len, 8), legMat);
		leg.position.addVectors(top, foot).multiplyScalar(0.5);
		leg.quaternion.setFromUnitVectors(up, dir.normalize());
		tripod.add(leg);
	}
	const head = new Mesh(
		new BoxGeometry(0.16, 0.1, 0.11),
		mat("#111214", 0.35, 0.2),
	);
	head.position.y = 1.32;
	const lens = new Mesh(new CylinderGeometry(0.035, 0.04, 0.09, 20), steel);
	lens.rotation.x = Math.PI / 2;
	lens.position.set(0, 1.32, -0.09);
	tripod.add(head, lens);
	if (props.tripod) {
		tripod.position.set(props.tripod[0], 0, props.tripod[1]);
		tripod.rotation.y = 0.5;
		root.add(tripod);
	}

	// Survey stakes, a loose grid across the sharp part of the capture.
	const stakes = props.stakes ?? [];
	stakes.forEach(([x, z], i) => {
		root.add(stake(x, z, ((i * 7) % 5) * 0.025 - 0.05, i * 1.3));
	});
	const merged = mergeByMaterial(root);
	scene.add(merged);
	return merged;
}
