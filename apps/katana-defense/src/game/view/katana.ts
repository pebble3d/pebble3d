import { ToonNodeMaterial } from "@pebble3d/renderer";
import { abs, attribute, float, mix, uv, vec3 } from "three/tsl";
import {
	BoxGeometry,
	BufferGeometry,
	Color,
	CylinderGeometry,
	Float32BufferAttribute,
	Group,
	Mesh,
	type Node,
} from "three/webgpu";

/** Blade length from the guard to the tip, metres. */
export const BLADE_LENGTH = 0.92;
export const GRIP_LENGTH = 0.26;

/** Katana colours: blackened blade with a bright polished edge, red-corded grip. */
const BLADE_DARK = "#1f2229";
const BLADE_EDGE = "#e6edf5";
const CORD_RED = "#b51b2b";
const SAME_DARK = "#17151a";
const IRON = "#2a2830";

function lin(hex: string): Node<"vec3"> {
	const c = new Color(hex);
	return vec3(c.r, c.g, c.b);
}

/**
 * A slightly curved, single-edged blade: a tapered strip bent along its length, built in
 * katana space (+Z = along the blade from the guard, +Y = the back of the blade). The
 * `edge` attribute is 1 on the cutting edge and 0 on the spine (the polished-edge line).
 */
function bladeGeometry(): BufferGeometry {
	const segs = 14;
	const pos: number[] = [];
	const edge: number[] = [];
	const idx: number[] = [];
	for (let i = 0; i <= segs; i++) {
		const t = i / segs;
		const z = t * BLADE_LENGTH;
		const curve = 0.045 * t * t; // sori: the back curves up toward the tip
		const width =
			t < 0.93 ? 0.034 - 0.008 * t : 0.034 * (1 - (t - 0.93) / 0.07) * 0.6;
		const half = 0.0035;
		// edge (y = -width/2) is thin; spine (y = +width/2) is thicker
		pos.push(0, curve - width / 2, z); // edge
		pos.push(half, curve + width / 2, z); // spine right
		pos.push(-half, curve + width / 2, z); // spine left
		edge.push(1, 0, 0);
	}
	for (let i = 0; i < segs; i++) {
		const a = i * 3;
		const b = a + 3;
		// right face: edge -> spine right
		idx.push(a, b, a + 1, a + 1, b, b + 1);
		// left face
		idx.push(a, a + 2, b, a + 2, b + 2, b);
		// spine top
		idx.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
	}
	const g = new BufferGeometry();
	g.setAttribute("position", new Float32BufferAttribute(pos, 3));
	g.setAttribute("edge", new Float32BufferAttribute(edge, 1));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

/**
 * Procedural katana: blackened blade with a polished edge line, dark iron guard (tsuba) and
 * a grip bound in red cord over dark ray skin. The group's origin is the guard; the grip
 * extends along -Z and the blade along +Z. The pommel end is at -Z `GRIP_LENGTH + 0.02`.
 */
export function createKatana(): Group {
	const g = new Group();
	g.name = "katana";
	const steel = new ToonNodeMaterial({ metalness: 0.85, roughness: 0.22 });
	const e = attribute("edge", "float") as unknown as Node<"float">;
	steel.colorNode = mix(
		lin(BLADE_DARK),
		lin(BLADE_EDGE),
		e.greaterThan(0.68).select(float(1), float(0)),
	);
	steel.toonSpecular = 1.6;
	steel.toonRim = 1.5;
	const blade = new Mesh(bladeGeometry(), steel);
	blade.castShadow = true;
	g.add(blade);

	const iron = new ToonNodeMaterial({
		color: new Color(IRON),
		metalness: 0.6,
		roughness: 0.45,
	});
	const guard = new Mesh(new CylinderGeometry(0.046, 0.046, 0.012, 20), iron);
	guard.rotation.x = Math.PI / 2;
	g.add(guard);

	// tsuka-ito: red cord crossing in diamonds over the dark ray skin
	const wrap = new ToonNodeMaterial({ roughness: 0.9 });
	const u = uv().x.mul(6);
	const v = uv().y.mul(9);
	const d1 = abs(u.add(v).fract().sub(0.5));
	const d2 = abs(u.sub(v).fract().sub(0.5));
	const window = d1.add(d2).lessThan(0.3);
	wrap.colorNode = window.select(lin(SAME_DARK), lin(CORD_RED));
	const grip = new Mesh(
		new CylinderGeometry(0.016, 0.018, GRIP_LENGTH, 12),
		wrap,
	);
	grip.rotation.x = Math.PI / 2;
	grip.position.z = -GRIP_LENGTH / 2 - 0.006;
	grip.castShadow = true;
	g.add(grip);

	const cap = new Mesh(new BoxGeometry(0.03, 0.03, 0.02), iron);
	cap.position.z = -GRIP_LENGTH - 0.01;
	g.add(cap);
	return g;
}
