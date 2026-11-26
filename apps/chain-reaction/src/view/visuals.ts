import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { float, pow, uniform, uv } from "three/tsl";
import {
	AdditiveBlending,
	type BufferGeometry,
	CanvasTexture,
	Color,
	Curve,
	CylinderGeometry,
	DoubleSide,
	ExtrudeGeometry,
	Group,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial,
	MeshStandardNodeMaterial,
	type Object3D,
	RepeatWrapping,
	Shape,
	SphereGeometry,
	SRGBColorSpace,
	TorusGeometry,
	TubeGeometry,
	Vector3,
} from "three/webgpu";
import {
	DOMINO_SIZE,
	RAMP_LENGTH,
	SEESAW_FULCRUM_H,
	SEESAW_PLANK,
	SPRING_ANGLE,
} from "../puzzle/parts.ts";

/**
 * Procedural visuals for every part: toy-like rounded plastic, a glossy red ball, an ivory
 * domino with pips, a coil spring, a twin-rotor fan, and
 * a glowing goal cup. Geometry and materials are built once and shared; meshes are cheap.
 */

/** Spring visual rest pose (the physics pad is 0.3 m tall, centred on the entity). */
export const SPRING_COIL = 0.2;
export const SPRING_CAP_Y = 0.12;

export interface PartVisual {
	root: Object3D;
	/** Fan rotors to spin (local axis Z). */
	rotors?: Object3D[];
	/** Spring coil and cap (compressed / extended on fire). */
	coil?: Object3D;
	cap?: Object3D;
}

const geo = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
	let g = geo.get(key);
	if (!g) {
		g = make();
		geo.set(key, g);
	}
	return g;
}

/** Goal beam brightness (pulses; flares on a solve). Declared before MAT uses it. */
export const beamStrength = uniform(0.12);

const plastic = (color: string, rough = 0.38): MeshPhysicalNodeMaterial =>
	new MeshPhysicalNodeMaterial({
		color: new Color(color),
		roughness: rough,
		metalness: 0,
		clearcoat: 0.6,
		clearcoatRoughness: 0.25,
	});

export const MAT = {
	ramp: plastic("#f08a24"),
	rampEdge: plastic("#ffd08a", 0.3),
	domino: plastic("#f3eee2", 0.3),
	pip: new MeshStandardNodeMaterial({
		color: new Color("#1b1c20"),
		roughness: 0.5,
	}),
	springRed: plastic("#e5402f", 0.32),
	steel: new MeshStandardNodeMaterial({
		color: new Color("#c9ced6"),
		roughness: 0.22,
		metalness: 1,
	}),
	darkSteel: new MeshStandardNodeMaterial({
		color: new Color("#3a3e46"),
		roughness: 0.35,
		metalness: 0.8,
	}),
	fan: plastic("#3d8be0", 0.35),
	fanDark: new MeshStandardNodeMaterial({
		color: new Color("#1c2a3c"),
		roughness: 0.5,
	}),
	plank: plastic("#8f5fd6", 0.4),
	fulcrum: plastic("#4b3b74", 0.45),
	block: new MeshStandardNodeMaterial({
		color: new Color("#272c37"),
		roughness: 0.66,
	}),
	blockTop: new MeshStandardNodeMaterial({
		color: new Color("#566079"),
		roughness: 0.5,
	}),
	ball: new MeshPhysicalNodeMaterial({
		color: new Color("#ff3d5a"),
		roughness: 0.18,
		metalness: 0,
		clearcoat: 1,
		clearcoatRoughness: 0.04,
		emissive: new Color("#ff3d5a"),
		emissiveIntensity: 0.12,
	}),
	marble: new MeshPhysicalNodeMaterial({
		color: new Color("#16171c"),
		roughness: 0.15,
		metalness: 0.2,
		clearcoat: 1,
		clearcoatRoughness: 0.05,
	}),
	marbleBand: new MeshStandardNodeMaterial({
		color: new Color("#f2b134"),
		roughness: 0.3,
		metalness: 0.6,
	}),
	goal: new MeshPhysicalNodeMaterial({
		color: new Color("#0d3a31"),
		roughness: 0.25,
		clearcoat: 1,
		clearcoatRoughness: 0.1,
		emissive: new Color("#0fae82"),
		emissiveIntensity: 0.35,
	}),
	goalRim: new MeshBasicNodeMaterial({ color: new Color(1.2, 7, 4.6) }),
	goalBeam: beamMaterial(),
	goalRing: new MeshBasicNodeMaterial({
		color: new Color(4, 22, 15),
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
		blending: AdditiveBlending,
	}),
};

function rounded(w: number, h: number, d: number, r: number): BufferGeometry {
	return cached(
		`rb|${w}|${h}|${d}|${r}`,
		() => new RoundedBoxGeometry(w, h, d, 3, r),
	);
}

function mesh(g: BufferGeometry, m: Material, shadow = true): Mesh {
	const o = new Mesh(g, m);
	o.castShadow = shadow;
	o.receiveShadow = true;
	return o;
}

class Helix extends Curve<Vector3> {
	constructor(
		private readonly r: number,
		private readonly h: number,
		private readonly turns: number,
	) {
		super();
	}
	override getPoint(t: number, target = new Vector3()): Vector3 {
		const a = t * Math.PI * 2 * this.turns;
		return target.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r);
	}
}

/** Domino face texture: two pip groups split by a groove. */
let dominoTex: CanvasTexture | null = null;
function dominoMaterial(): MeshPhysicalNodeMaterial {
	if (!dominoTex) {
		const c = document.createElement("canvas");
		c.width = 64;
		c.height = 512;
		const g = c.getContext("2d") as CanvasRenderingContext2D;
		g.fillStyle = "#f3eee2";
		g.fillRect(0, 0, 64, 512);
		g.fillStyle = "#26272c";
		g.fillRect(8, 252, 48, 8);
		const pip = (x: number, y: number): void => {
			g.beginPath();
			g.arc(x, y, 7, 0, Math.PI * 2);
			g.fill();
		};
		pip(32, 128);
		pip(20, 330);
		pip(44, 400);
		pip(32, 365);
		dominoTex = new CanvasTexture(c);
		dominoTex.colorSpace = SRGBColorSpace;
	}
	const m = plastic("#ffffff", 0.3);
	m.map = dominoTex;
	return m;
}
let dominoMat: MeshPhysicalNodeMaterial | null = null;

/** Builds the visual for a prefab at the origin (the caller places it). */
export function buildVisual(
	prefab: string,
	ghost: Material | null,
): PartVisual {
	const pick = (m: Material): Material => ghost ?? m;
	const root = new Group();
	const out: PartVisual = { root };
	switch (prefab) {
		case "ball": {
			root.add(
				mesh(
					cached("ball", () => new SphereGeometry(0.2, 48, 32)),
					pick(MAT.ball),
				),
			);
			break;
		}
		case "marble": {
			root.add(
				mesh(
					cached("marble", () => new SphereGeometry(0.22, 48, 32)),
					pick(MAT.marble),
				),
			);
			const band = mesh(
				cached("band", () => new TorusGeometry(0.221, 0.018, 8, 48)),
				pick(MAT.marbleBand),
				false,
			);
			root.add(band);
			break;
		}
		case "ramp": {
			const plank = mesh(
				rounded(RAMP_LENGTH, 0.08, 0.9, 0.025),
				pick(MAT.ramp),
			);
			root.add(plank);
			const lip = mesh(
				rounded(RAMP_LENGTH - 0.04, 0.02, 0.08, 0.008),
				pick(MAT.rampEdge),
				false,
			);
			lip.position.set(0, 0.045, 0.38);
			root.add(lip);
			const lip2 = lip.clone();
			lip2.position.z = -0.38;
			root.add(lip2);
			break;
		}
		case "domino": {
			dominoMat ??= dominoMaterial();
			const [w, h, d] = DOMINO_SIZE;
			root.add(mesh(rounded(w, h, d, 0.03), pick(dominoMat)));
			break;
		}
		case "spring": {
			const base = mesh(rounded(0.84, 0.05, 0.8, 0.018), pick(MAT.darkSteel));
			base.position.y = -0.125;
			root.add(base);
			const tilt = new Group();
			const coil = new Group();
			coil.add(
				mesh(
					cached(
						"coil",
						() => new TubeGeometry(new Helix(0.24, 1, 5), 160, 0.018, 6),
					),
					pick(MAT.steel),
				),
			);
			coil.position.y = -0.1;
			coil.scale.y = SPRING_COIL;
			tilt.add(coil);
			const cap = mesh(rounded(0.78, 0.06, 0.74, 0.022), pick(MAT.springRed));
			cap.position.y = SPRING_CAP_Y;
			tilt.add(cap);
			root.add(tilt);
			out.coil = coil;
			out.cap = cap;
			break;
		}
		case "fanBase":
		case "fanSide": {
			const side = prefab === "fanSide";
			const body = mesh(
				side ? rounded(0.24, 0.8, 0.7, 0.04) : rounded(0.8, 0.24, 0.7, 0.04),
				pick(MAT.fan),
			);
			root.add(body);
			// Two small rotors behind round grilles on the front face, spinning about Z.
			out.rotors = [];
			for (const k of [-1, 1]) {
				const mount = new Group();
				mount.position.set(side ? 0 : k * 0.19, side ? k * 0.19 : 0, 0.352);
				const ring = mesh(
					cached("fanring", () => new TorusGeometry(0.095, 0.012, 8, 32)),
					pick(MAT.fanDark),
					false,
				);
				mount.add(ring);
				const rotor = new Group();
				for (let i = 0; i < 5; i++) {
					const arm = new Group();
					arm.rotation.z = (i * Math.PI * 2) / 5;
					const blade = mesh(
						rounded(0.075, 0.03, 0.008, 0.004),
						pick(MAT.steel),
						false,
					);
					blade.position.x = 0.045;
					blade.rotation.x = 0.5;
					arm.add(blade);
					rotor.add(arm);
				}
				const hub = mesh(
					cached("hub", () => new SphereGeometry(0.022, 12, 8)),
					pick(MAT.fanDark),
					false,
				);
				rotor.add(hub);
				mount.add(rotor);
				root.add(mount);
				out.rotors.push(rotor);
			}
			break;
		}
		case "fulcrum": {
			const sh = new Shape();
			sh.moveTo(-0.22, 0);
			sh.lineTo(0.22, 0);
			sh.lineTo(0.0, SEESAW_FULCRUM_H);
			sh.closePath();
			const g = cached("fulcrum", () => {
				const e = new ExtrudeGeometry(sh, {
					depth: 0.8,
					bevelEnabled: true,
					bevelSize: 0.015,
					bevelThickness: 0.015,
					bevelSegments: 2,
				});
				e.translate(0, 0, -0.4);
				return e;
			});
			root.add(mesh(g, pick(MAT.fulcrum)));
			break;
		}
		case "plank": {
			const [l, t, d] = SEESAW_PLANK;
			root.add(mesh(rounded(l, t, d, 0.025), pick(MAT.plank)));
			break;
		}
		default:
			break;
	}
	return out;
}

/** A level block (static scenery): charcoal with a lighter top skin. */
export function buildBlock(sx: number, sy: number, sz: number): Object3D {
	const g = new Group();
	g.add(mesh(rounded(sx, sy, sz, Math.min(0.05, sx / 4, sy / 4)), MAT.block));
	if (sy >= 0.2) {
		const top = mesh(
			rounded(sx - 0.02, 0.03, sz - 0.02, 0.01),
			MAT.blockTop,
			false,
		);
		top.position.y = sy / 2 - 0.006;
		g.add(top);
	}
	return g;
}

/** The goal cup piece (a glowing wall). */
export function buildGoalWall(sx: number, sy: number, sz: number): Object3D {
	const g = new Group();
	g.add(mesh(rounded(sx, sy, sz, Math.min(0.03, sx / 3, sy / 3)), MAT.goal));
	// A glowing rim strip along the top edge.
	const rim = mesh(
		rounded(sx + 0.01, 0.025, sz + 0.01, 0.01),
		MAT.goalRim,
		false,
	);
	rim.position.y = sy / 2;
	g.add(rim);
	return g;
}

/** Beacon above the goal: a soft additive light column and a floating ring. */
export function buildBeacon(): { root: Object3D; ring: Object3D; beam: Mesh } {
	const root = new Group();
	const beam = new Mesh(
		cached("beam", () => {
			const g = new CylinderGeometry(0.36, 0.42, 2.2, 32, 1, true);
			g.translate(0, 1.1, 0);
			return g;
		}),
		MAT.goalBeam,
	);
	beam.renderOrder = 3;
	root.add(beam);
	const ring = new Mesh(
		cached("goalring", () => new TorusGeometry(0.38, 0.022, 10, 64)),
		MAT.goalRing,
	);
	ring.rotation.x = Math.PI / 2;
	ring.renderOrder = 3;
	root.add(ring);
	return { root, ring, beam };
}

/** Angled springs tilt their coil and cap towards the launch direction. */
export function springTilt(dir: string): number {
	return dir === "right" ? -SPRING_ANGLE : dir === "left" ? SPRING_ANGLE : 0;
}

let airTex: CanvasTexture | null = null;
/** Shared airflow material: chevrons pointing +V, scrolled by the board while fans run. */
export function airMaterial(): MeshBasicNodeMaterial {
	if (!airTex) {
		const c = document.createElement("canvas");
		c.width = 64;
		c.height = 64;
		const g = c.getContext("2d") as CanvasRenderingContext2D;
		g.clearRect(0, 0, 64, 64);
		g.strokeStyle = "rgba(190,230,255,1)";
		g.lineWidth = 5;
		g.lineCap = "round";
		g.beginPath();
		g.moveTo(18, 40);
		g.lineTo(32, 26);
		g.lineTo(46, 40);
		g.stroke();
		airTex = new CanvasTexture(c);
		airTex.colorSpace = SRGBColorSpace;
		airTex.wrapS = RepeatWrapping;
		airTex.wrapT = RepeatWrapping;
	}
	return new MeshBasicNodeMaterial({
		map: airTex,
		color: new Color("#9fd8ff"),
		transparent: true,
		opacity: 0.14,
		depthWrite: false,
		blending: AdditiveBlending,
	});
}
export function airTexture(): CanvasTexture | null {
	return airTex;
}

/** Goal light column: additive, fading out with height (uv.y). */
function beamMaterial(): MeshBasicNodeMaterial {
	const m = new MeshBasicNodeMaterial({
		color: new Color("#3dffc8"),
		transparent: true,
		blending: AdditiveBlending,
		depthWrite: false,
		side: DoubleSide,
	});
	m.opacityNode = pow(float(1).sub(uv().y), float(2.2)).mul(beamStrength);
	return m;
}
