import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { float, smoothstep, uniform, uv, vec3 } from "three/tsl";
import {
	AdditiveBlending,
	BoxGeometry,
	type BufferGeometry,
	Color,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	OctahedronGeometry,
	type Scene,
	TorusGeometry,
} from "three/webgpu";
import { MAX_PICKUPS } from "../constants.ts";
import type { RockfallSim } from "../sim.ts";

/** Pickup look per type: crystal (score), heart (heal), shield. */
const LOOKS = [
	{ color: "#6dfff0", emissive: [0.6, 3.2, 2.8], beam: [0.2, 1.0, 0.9] },
	{ color: "#ff5a6a", emissive: [3.4, 0.45, 0.55], beam: [1.0, 0.18, 0.22] },
	{ color: "#7ab8ff", emissive: [0.7, 1.6, 3.6], beam: [0.25, 0.5, 1.1] },
] as const;
const LIFE = [12, 15, 15];

interface Slot {
	group: Group;
	bodies: Mesh[];
	beam: Mesh;
	beamOn: { value: number };
	beamColor: { value: Color };
}

/** Floating pickups with a light beam (seen from anywhere in the pit) and a spin/bob. */
export class PickupView {
	private readonly slots: Slot[] = [];
	private readonly sim: RockfallSim;
	private t = 0;

	constructor(scene: Scene, sim: RockfallSim) {
		this.sim = sim;
		const geos: BufferGeometry[] = [
			new OctahedronGeometry(0.34, 0),
			plusGeometry(),
			new TorusGeometry(0.3, 0.085, 10, 28),
		];
		geos[0]?.scale(0.8, 1.35, 0.8);
		const mats = LOOKS.map((l) => {
			const m = new MeshStandardNodeMaterial({
				color: new Color(l.color),
				roughness: 0.25,
				metalness: 0.1,
				flatShading: true,
			});
			m.emissiveNode = vec3(...l.emissive);
			return m;
		});
		const beamGeo = new CylinderGeometry(0.05, 0.22, 2.6, 12, 1, true);
		beamGeo.translate(0, 1.3, 0);
		for (let i = 0; i < MAX_PICKUPS; i++) {
			const group = new Group();
			group.visible = false;
			const bodies = geos.map((g, k) => {
				const m = new Mesh(g, mats[k]);
				m.castShadow = true;
				group.add(m);
				return m;
			});
			const beamOn = uniform(1);
			const beamColor = uniform(new Color(1, 1, 1));
			const bm = new MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
			});
			const fade = float(1)
				.sub(smoothstep(0.0, 1.0, uv().y))
				.mul(0.4);
			bm.colorNode = beamColor.mul(fade).mul(beamOn);
			const beam = new Mesh(beamGeo, bm);
			beam.position.y = -0.6;
			group.add(beam);
			scene.add(group);
			this.slots.push({ group, bodies, beam, beamOn, beamColor });
		}
	}

	update(dt: number): void {
		this.t += dt;
		const sim = this.sim;
		for (let i = 0; i < MAX_PICKUPS; i++) {
			const s = this.slots[i] as Slot;
			const type = sim.pkType[i] as number;
			if (type < 0) {
				s.group.visible = false;
				continue;
			}
			s.group.visible = true;
			for (let k = 0; k < s.bodies.length; k++)
				(s.bodies[k] as Mesh).visible = k === type;
			const age = (sim.tick - (sim.pkBorn[i] as number)) / 60;
			const left = (LIFE[type] as number) - age;
			const blink = left < 3 && Math.floor(age * 8) % 2 === 0;
			const look = LOOKS[type];
			const pop = Math.min(1, age * 4);
			const y = (sim.pkY[i] as number) + Math.sin(this.t * 2.6 + i) * 0.12;
			s.group.position.set(sim.pkX[i] as number, y, sim.pkZ[i] as number);
			const body = s.bodies[type] as Mesh;
			body.rotation.y = this.t * 2.2 + i;
			body.scale.setScalar(pop * (blink ? 0.75 : 1));
			if (look)
				s.beamColor.value.setRGB(look.beam[0], look.beam[1], look.beam[2]);
			s.beamOn.value = blink ? 0.3 : 1;
		}
	}
}

/** A chunky "plus" (the heal pickup): two crossed boxes merged into one geometry. */
function plusGeometry(): BufferGeometry {
	return (
		mergeGeometries([
			new BoxGeometry(0.56, 0.2, 0.2),
			new BoxGeometry(0.2, 0.56, 0.2),
		]) ?? new BoxGeometry(0.4, 0.4, 0.2)
	);
}
