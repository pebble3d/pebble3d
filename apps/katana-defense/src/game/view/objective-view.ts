import { ToonNodeMaterial } from "@pebble3d/renderer";
import {
	BoxGeometry,
	Color,
	CylinderGeometry,
	Group,
	Mesh,
	PointLight,
	type Scene,
	SphereGeometry,
} from "three/webgpu";
import type { GameSim } from "../sim.ts";

/**
 * The objective: a timber-and-sandbag barricade across the hall's side gate with a
 * hanging lantern (a warm point light that matters more as dusk falls). It shudders when
 * struck and its timbers char as integrity drops.
 */
export class ObjectiveView {
	readonly group = new Group();
	readonly light: PointLight;
	private readonly wood: ToonNodeMaterial;
	private readonly lamp: ToonNodeMaterial;
	private shudder = 0;
	private t = 0;
	private readonly sim: GameSim;
	private readonly baseWood = new Color(0x6b4b2e);
	private readonly charred = new Color(0x1d1712);

	constructor(scene: Scene, sim: GameSim) {
		this.sim = sim;
		const o = sim.objective;
		const g = this.group;
		g.position.set(o.x, 0, o.z);
		// face the yard (+Z, slightly toward the west where most spawns are)
		g.rotation.y = -0.25;
		this.wood = new ToonNodeMaterial({
			color: this.baseWood,
			roughness: 0.85,
		});
		const iron = new ToonNodeMaterial({
			color: 0x2a2c30,
			roughness: 0.5,
			metalness: 0.7,
		});
		const sack = new ToonNodeMaterial({
			color: 0x8c7d62,
			roughness: 1,
		});
		const add = (m: Mesh, x: number, y: number, z: number, rz = 0): void => {
			m.position.set(x, y, z);
			m.rotation.z = rz;
			m.castShadow = true;
			m.receiveShadow = true;
			g.add(m);
		};
		const post = new BoxGeometry(0.2, 2.3, 0.2);
		add(new Mesh(post, this.wood), -1.15, 1.15, 0);
		add(new Mesh(post, this.wood), 1.15, 1.15, 0);
		const plank = new BoxGeometry(2.5, 0.2, 0.07);
		for (const y of [0.55, 1.15, 1.75])
			add(new Mesh(plank, this.wood), 0, y, 0.12);
		const diag = new BoxGeometry(2.9, 0.18, 0.06);
		add(new Mesh(diag, this.wood), 0, 1.15, 0.18, 0.62);
		add(new Mesh(diag, this.wood), 0, 1.15, 0.2, -0.62);
		// iron spikes along the top
		const spike = new CylinderGeometry(0, 0.05, 0.4, 6);
		for (let i = 0; i < 6; i++)
			add(new Mesh(spike, iron), -1.0 + i * 0.4, 2.0, 0.1);
		// sandbags
		const bag = new SphereGeometry(0.3, 10, 8);
		bag.scale(1.25, 0.5, 0.8);
		for (let i = 0; i < 7; i++) {
			const m = new Mesh(bag, sack);
			add(m, -1.35 + i * 0.45, 0.14 + (i % 2) * 0.05, 0.45);
			m.rotation.y = (i * 0.7) % 0.5;
		}
		for (let i = 0; i < 4; i++)
			add(new Mesh(bag, sack), -0.7 + i * 0.47, 0.42, 0.42);
		// lantern on a hooked pole
		const pole = new Mesh(new CylinderGeometry(0.04, 0.05, 2.9, 8), iron);
		add(pole, 1.55, 1.45, 0.1);
		const arm = new Mesh(new BoxGeometry(0.5, 0.05, 0.05), iron);
		add(arm, 1.35, 2.85, 0.1);
		this.lamp = new ToonNodeMaterial({
			color: 0x2a1a08,
			emissive: new Color(1, 0.55, 0.18),
			emissiveIntensity: 3,
		});
		const lantern = new Mesh(
			new CylinderGeometry(0.1, 0.12, 0.26, 8),
			this.lamp,
		);
		add(lantern, 1.15, 2.62, 0.1);
		this.light = new PointLight(0xffa04a, 6, 9, 1.6);
		this.light.position.set(1.15, 2.5, 0.35);
		this.light.castShadow = false;
		g.add(this.light);
		scene.add(g);
	}

	hit(): void {
		this.shudder = 1;
	}

	/** `dusk` 0..1 raises the lantern's presence. */
	update(dt: number, dusk: number): void {
		this.t += dt;
		const o = this.sim.objective;
		const k = Math.max(0, o.hp / o.maxHp);
		this.wood.color.copy(this.charred).lerp(this.baseWood, 0.25 + 0.75 * k);
		this.shudder = Math.max(0, this.shudder - dt * 5);
		const sh = this.shudder * this.shudder;
		this.group.position.x = o.x + Math.sin(this.t * 61) * 0.05 * sh;
		this.group.rotation.z = Math.sin(this.t * 47) * 0.03 * sh;
		const flicker =
			0.9 + 0.1 * Math.sin(this.t * 13.1) * Math.sin(this.t * 7.3);
		this.light.intensity = (4 + 14 * dusk) * flicker * (o.hp > 0 ? 1 : 0.1);
		this.lamp.emissiveIntensity = (2 + 4 * dusk) * flicker;
	}
}
