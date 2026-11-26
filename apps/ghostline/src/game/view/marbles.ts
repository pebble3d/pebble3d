import {
	abs,
	color,
	dot,
	float,
	mix,
	mx_noise_float,
	normalView,
	positionLocal,
	positionViewDirection,
	pow,
	sin,
	time,
	uniform,
	vec3,
} from "three/tsl";
import {
	AdditiveBlending,
	Color,
	DoubleSide,
	Group,
	IcosahedronGeometry,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial,
	PlaneGeometry,
	SphereGeometry,
} from "three/webgpu";
import { MARBLE_RADIUS } from "../constants.ts";

export const SKINS = ["glass", "chrome", "ember"] as const;
export type Skin = (typeof SKINS)[number];
export const SKIN_LABEL: Record<Skin, string> = {
	glass: "Tidepool Glass",
	chrome: "Mirror Chrome",
	ember: "Ember Core",
};

/** Rim term: 0 facing the camera, 1 at grazing angles. */
function fresnel(power: number) {
	return pow(float(1).sub(abs(dot(normalView, positionViewDirection))), power);
}

/** A twisted "cat's-eye" vane inside the glass marble. */
function vaneGeometry(): PlaneGeometry {
	const g = new PlaneGeometry(MARBLE_RADIUS * 1.5, MARBLE_RADIUS * 1.5, 24, 24);
	const p = g.attributes.position;
	if (!p) return g;
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i);
		const y = p.getY(i);
		const a = y * 2.6;
		// twist about Y and pinch into a lens so it stays inside the sphere
		const r = Math.sqrt(Math.max(0, 1 - (y / (MARBLE_RADIUS * 0.78)) ** 2));
		p.setXYZ(i, x * Math.cos(a) * r, y, x * Math.sin(a) * r);
	}
	g.computeVertexNormals();
	return g;
}

function materials(skin: Skin): { shell: Material; inner: Material | null } {
	if (skin === "chrome") {
		const m = new MeshPhysicalNodeMaterial({
			color: new Color("#f2f3f6"),
			metalness: 1,
			roughness: 0.04,
			clearcoat: 1,
			clearcoatRoughness: 0.02,
		});
		return { shell: m, inner: null };
	}
	if (skin === "ember") {
		const m = new MeshPhysicalNodeMaterial({
			color: new Color("#1a0b07"),
			metalness: 0.2,
			roughness: 0.22,
			clearcoat: 1,
			clearcoatRoughness: 0.05,
		});
		// molten veins: animated noise bands, emissive
		const p = positionLocal.mul(3.2);
		const n = mx_noise_float(p.add(vec3(0, time.mul(0.6), 0)));
		const veins = pow(float(1).sub(abs(n)).max(0), 14);
		const pulse = sin(time.mul(3)).mul(0.15).add(0.85);
		m.emissiveNode = mix(color("#ff3c00"), color("#ffc040"), veins).mul(
			veins.mul(7).mul(pulse),
		);
		return { shell: m, inner: null };
	}
	// Glass without a transmission pass: a clear, iridescent clearcoat shell whose opacity
	// follows the fresnel term, so the rim reflects the environment and the core shows the vane.
	const glass = new MeshPhysicalNodeMaterial({
		color: new Color("#e8fbff"),
		metalness: 0,
		roughness: 0.03,
		clearcoat: 1,
		clearcoatRoughness: 0.0,
		iridescence: 0.55,
		iridescenceIOR: 1.6,
		specularIntensity: 1,
		transparent: true,
		depthWrite: false,
	});
	glass.opacityNode = mix(float(0.16), float(0.95), fresnel(2.5));
	const vane = new MeshPhysicalNodeMaterial({
		color: new Color("#1f8fff"),
		roughness: 0.3,
		metalness: 0.1,
		side: DoubleSide,
	});
	vane.emissiveNode = mix(
		color("#00a8ff"),
		color("#ff5a2a"),
		abs(positionLocal.y).mul(2.4),
	).mul(1.4);
	return { shell: glass, inner: vane };
}

/** The player's marble: a shell plus an optional inner vane. */
export function createMarble(skin: Skin): Group {
	const g = new Group();
	const { shell, inner } = materials(skin);
	const sphere = new Mesh(new SphereGeometry(MARBLE_RADIUS, 64, 32), shell);
	sphere.renderOrder = 3;
	sphere.castShadow = true;
	sphere.receiveShadow = true;
	g.add(sphere);
	if (inner) {
		const v = new Mesh(vaneGeometry(), inner);
		v.castShadow = false;
		g.add(v);
		const v2 = v.clone();
		v2.rotation.y = Math.PI / 2;
		g.add(v2);
	}
	return g;
}

/** Uniforms the ghost material exposes (fade near the camera / player). */
export interface GhostLook {
	group: Group;
	opacity: { value: number };
}

/** The ghost: a translucent fresnel shell with a faint glowing core. Never casts shadows. */
export function createGhost(tint = "#5fe3ff"): GhostLook {
	const opacity = uniform(1);
	const group = new Group();
	// Normal (not additive) blending so the ghost reads on a white deck as well as a black one;
	// the rim goes over 1.0 so bloom still lifts it on the dark courses.
	const shell = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
	});
	const rim = fresnel(2.2);
	shell.colorNode = mix(color(tint).mul(0.55), color(tint).mul(2.2), rim);
	shell.opacityNode = rim.mul(0.6).add(0.22).mul(opacity);
	const s = new Mesh(new SphereGeometry(MARBLE_RADIUS, 48, 24), shell);
	s.renderOrder = 5;
	group.add(s);
	const core = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
	core.colorNode = color(tint).mul(1.6);
	core.opacityNode = float(0.55).mul(opacity);
	const c = new Mesh(new IcosahedronGeometry(MARBLE_RADIUS * 0.28, 2), core);
	c.renderOrder = 5;
	group.add(c);
	return { group, opacity };
}
