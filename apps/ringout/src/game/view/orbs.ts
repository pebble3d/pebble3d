import { readSlot } from "@pebble3d/renderer";
import {
	abs,
	color,
	dot,
	float,
	max,
	mix,
	normalView,
	positionLocal,
	positionViewDirection,
	pow,
	smoothstep,
	uniform,
} from "three/tsl";
import {
	AdditiveBlending,
	Color,
	ConeGeometry,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial,
	RingGeometry,
	SphereGeometry,
	Vector3,
} from "three/webgpu";
import { MAX_PLAYERS, ORB } from "../constants.ts";
import type { RoundSim } from "../sim.ts";

export interface PlayerLook {
	name: string;
	color: string;
}

/** Original palette and names for the four seats. */
export const LOOKS: PlayerLook[] = [
	{ name: "Coral", color: "#ff5a4e" },
	{ name: "Tide", color: "#36d1ff" },
	{ name: "Moss", color: "#b8f04a" },
	{ name: "Iris", color: "#b98bff" },
];

const _pos = new Vector3();

interface OrbParts {
	group: Group;
	ball: Mesh;
	halo: Mesh;
	marker: Mesh;
	glow: { value: number };
	haloOpacity: { value: number };
}

/**
 * The orbs: glossy enamel spheres with two glowing bands fixed in the body frame, so the
 * roll (angular velocity) reads at a glance; a team halo on the floor beneath each, and a
 * floating marker. `flash(slot)` lights an orb up on a dash or a hit.
 */
export class OrbView {
	readonly root = new Group();
	readonly parts: OrbParts[] = [];
	readonly pos = new Float32Array(MAX_PLAYERS * 3);
	readonly visible = new Uint8Array(MAX_PLAYERS);
	private time = 0;

	constructor() {
		const geo = new SphereGeometry(ORB.radius, 48, 32);
		const haloGeo = new RingGeometry(
			ORB.radius * 0.9,
			ORB.radius * 1.45,
			40,
			1,
		);
		haloGeo.rotateX(-Math.PI / 2);
		const markGeo = new ConeGeometry(0.16, 0.3, 3);
		markGeo.rotateX(Math.PI);
		for (let s = 0; s < MAX_PLAYERS; s++) {
			const look = LOOKS[s] as (typeof LOOKS)[number];
			const team = new Color(look.color);
			const glow = uniform(0);
			const r = float(ORB.radius);
			const lp = positionLocal.div(r);
			// equator band and a meridian band, both in the body frame
			const band = smoothstep(float(0.13), float(0.08), abs(lp.y));
			const meridian = smoothstep(float(0.085), float(0.045), abs(lp.x)).mul(
				float(1).sub(band),
			);
			const stripes = max(band, meridian.mul(0.85));
			const base = color(team).mul(0.5);
			const mat = new MeshPhysicalNodeMaterial({
				roughness: 0.28,
				metalness: 0.05,
				clearcoat: 1,
				clearcoatRoughness: 0.08,
			});
			mat.colorNode = mix(base, color("#f6f0ea"), stripes.mul(0.85));
			const rim = pow(
				float(1).sub(abs(dot(normalView, positionViewDirection))),
				3,
			);
			mat.emissiveNode = color(team)
				.mul(stripes.mul(float(1.6).add(glow.mul(5))))
				.add(color(team).mul(rim.mul(float(0.35).add(glow.mul(1.5)))));
			const ball = new Mesh(geo, mat);
			ball.castShadow = true;
			ball.receiveShadow = true;
			const haloOpacity = uniform(0.8);
			const haloMat = new MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
			});
			haloMat.colorNode = color(team).mul(1.6);
			haloMat.opacityNode = haloOpacity;
			const halo = new Mesh(haloGeo, haloMat);
			halo.renderOrder = 3;
			const markMat = new MeshBasicNodeMaterial();
			markMat.colorNode = color(team).mul(3);
			const marker = new Mesh(markGeo, markMat);
			const group = new Group();
			group.add(ball, marker);
			group.visible = false;
			halo.visible = false;
			this.root.add(group, halo);
			this.parts.push({ group, ball, halo, marker, glow, haloOpacity });
		}
	}

	flash(slot: number, amount: number): void {
		const p = this.parts[slot];
		if (p) p.glow.value = Math.min(1.5, p.glow.value + amount);
	}

	update(sim: RoundSim, alpha: number, dt: number): void {
		this.time += dt;
		const v = sim.views;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			const p = this.parts[s] as OrbParts;
			const slot = sim.orbSlots[s] as number;
			const on =
				slot >= 0 &&
				readSlot(v.prev, v.curr, slot, alpha, _pos, p.ball.quaternion);
			p.group.visible = on;
			this.visible[s] = on ? 1 : 0;
			p.glow.value = Math.max(0, p.glow.value - dt * 3);
			if (!on) {
				p.halo.visible = false;
				continue;
			}
			p.group.position.copy(_pos);
			p.ball.position.set(0, 0, 0);
			this.pos[s * 3] = _pos.x;
			this.pos[s * 3 + 1] = _pos.y;
			this.pos[s * 3 + 2] = _pos.z;
			p.marker.position.set(
				0,
				ORB.radius + 0.55 + Math.sin(this.time * 3 + s) * 0.06,
				0,
			);
			p.marker.rotation.y = this.time * 1.5;
			// halo on the floor plane; fades as the orb leaves the floor
			const h = _pos.y - ORB.radius;
			p.halo.visible = h > -0.6 && h < 3;
			p.halo.position.set(_pos.x, 0.015, _pos.z);
			p.haloOpacity.value = Math.max(0, 0.55 - Math.abs(h) * 0.4);
		}
	}
}
