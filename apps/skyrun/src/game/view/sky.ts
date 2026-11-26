import {
	cameraPosition,
	color,
	float,
	fog,
	max,
	mix,
	normalWorldGeometry,
	positionWorld,
	rangeFogFactor,
	smoothstep,
	texture,
	time,
	uniform,
	vec2,
	vec3,
} from "three/tsl";
import {
	Color,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	type Scene,
	Vector3,
} from "three/webgpu";
import { noiseTexture } from "./noise.ts";

/** Direction toward the sun (matches `scenes/sky.json` `lighting.sun.direction`). */
export const SUN_DIR = new Vector3(0.55, 0.42, -0.72).normalize();

const ZENITH = new Color("#3550b0");
const MID = new Color("#8d9ff0");
const HORIZON = new Color("#ffc7a6");
const GLOW = new Color("#fff0d0");
const BELOW = new Color("#d9b8c4");

const sunU = uniform(SUN_DIR);

/** Dawn sky colour for a unit view direction: blue zenith, peach horizon, warm sun glow. */
function skyColor(d: ReturnType<typeof normalWorldGeometry.normalize>) {
	const y = d.y;
	const up = smoothstep(0.0, 0.3, y);
	const high = smoothstep(0.2, 0.8, y);
	const base = mix(mix(color(HORIZON), color(MID), up), color(ZENITH), high);
	const below = mix(color(HORIZON), color(BELOW), smoothstep(0.0, -0.25, y));
	const sky = mix(below, base, smoothstep(-0.02, 0.02, y));
	const s = max(d.dot(sunU), float(0));
	const glow = s
		.pow(6)
		.mul(0.55)
		.add(s.pow(64).mul(2.4))
		.add(s.pow(900).mul(14));
	return sky.add(color(GLOW).mul(glow));
}

/**
 * Replaces the HDRI backdrop with a painted dawn sky and makes the fog take the sky's colour
 * in each view direction (elevation clamped just under the horizon), so distant islands and
 * the cloud sea melt into the horizon. The HDRI still lights the scene.
 */
export function applySky(scene: Scene, near: number, far: number): void {
	scene.background = null;
	scene.backgroundNode = skyColor(normalWorldGeometry.normalize());
	const v = positionWorld.sub(cameraPosition).normalize();
	const dir = vec3(v.x, v.y.max(-0.04), v.z).normalize();
	scene.fogNode = fog(skyColor(dir), rangeFogFactor(near, far));
}

/**
 * The cloud sea: two drifting fractal-noise layers far below the islands. The lower one is
 * opaque and lit; the upper is a soft transparent veil that catches the sun.
 */
export function buildCloudSea(scene: Scene, y: number): void {
	const geo = new PlaneGeometry(1400, 1400, 1, 1);
	geo.rotateX(-Math.PI / 2);
	const p = positionWorld.xz;
	const tex = noiseTexture();
	const drift = vec2(time.mul(0.6), time.mul(0.25));
	// Baked tileable fBm, sampled at two scales: broad banks and finer puffs.
	const n = texture(tex, p.add(drift).mul(1 / 220)).r;
	const n2 = texture(tex, p.sub(drift.mul(0.7)).mul(1 / 70)).g;
	const puff = smoothstep(0.32, 0.72, n.add(n2.sub(0.5).mul(0.45)));

	const low = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
	low.colorNode = mix(
		color(new Color("#7f7bb8")),
		color(new Color("#f7e6e6")),
		puff,
	);
	low.emissiveNode = color(new Color("#ffb990")).mul(puff.pow(3).mul(0.18));
	const lowMesh = new Mesh(geo, low);
	lowMesh.position.y = y;
	lowMesh.receiveShadow = false;
	scene.add(lowMesh);

	const veil = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
	});
	const m = texture(tex, p.add(drift.mul(1.6)).mul(1 / 130)).b;
	const a = smoothstep(0.5, 0.8, m);
	veil.colorNode = mix(
		color(new Color("#f3d9e6")),
		color(new Color("#fff6ee")),
		a,
	);
	veil.opacityNode = a.mul(0.38);
	const veilMesh = new Mesh(geo, veil);
	veilMesh.position.y = y + 5;
	veilMesh.renderOrder = 2;
	scene.add(veilMesh);
}
