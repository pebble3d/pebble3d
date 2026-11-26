import {
	AdditiveBlending,
	BoxGeometry,
	CircleGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	type Object3D,
} from "three/webgpu";
import { mergeByMaterial } from "./merge.ts";

/** Visual scale over the physical frame: reads better from the chase camera. */
const S = 1.15;

export interface DroneLook {
	frame: string;
	canopy: string;
	accent: string;
	/** Ghost: translucent, unlit, no shadows. */
	ghost: boolean;
}

/**
 * A 5-inch-class racing quad, procedural: carbon X frame, four motors with spinning two-blade
 * props and blur discs, a canopy with a front camera, white nose and red tail LEDs that bloom.
 * The model's forward is -Z, up +Y (the sim's body frame). Allocation-free per frame.
 */
export class DroneView {
	readonly root = new Group();
	private readonly props: Object3D[] = [];
	private readonly discs: Mesh[] = [];
	private readonly discMat: MeshBasicNodeMaterial;
	private spin = 0;
	private readonly mats: Material[] = [];

	constructor(look: DroneLook) {
		const g = look.ghost;
		const std = (
			color: string,
			roughness: number,
			metalness = 0,
			emissive?: string,
			ei = 1,
		): Material => {
			const m = g
				? new MeshBasicNodeMaterial({
						color: emissive ?? look.accent,
						transparent: true,
						opacity: emissive ? 0.85 : 0.32,
						depthWrite: false,
						blending: AdditiveBlending,
					})
				: new MeshStandardNodeMaterial({ color, roughness, metalness });
			if (!g && emissive) {
				const sm = m as MeshStandardNodeMaterial;
				sm.emissive.set(emissive);
				sm.emissiveIntensity = ei;
			}
			this.mats.push(m);
			return m;
		};
		this.discMat = this.makeDisc();
		const carbon = std(look.frame, 0.42, 0.25);
		const metal = std("#2a2d33", 0.3, 0.9);
		const canopy = std(look.canopy, 0.35, 0.1);
		const propM = std("#1b1d22", 0.5, 0);
		const lens = std("#05070a", 0.08, 0.6);
		const white = std("#ffffff", 0.3, 0, "#f4fbff", 7);
		const red = std("#ff2030", 0.3, 0, "#ff2638", 7);
		const accent = std(look.accent, 0.3, 0, look.accent, 3.5);

		const body = new Group();
		const add = (m: Mesh, x: number, y: number, z: number): Mesh => {
			m.position.set(x * S, y * S, z * S);
			m.scale.setScalar(S);
			body.add(m);
			return m;
		};
		// X arms (two crossed plates) and the centre stack plate
		const arm = new BoxGeometry(0.42, 0.012, 0.034);
		const a1 = add(new Mesh(arm, carbon), 0, 0, 0);
		a1.rotation.y = Math.PI / 4;
		const a2 = add(new Mesh(arm, carbon), 0, 0, 0);
		a2.rotation.y = -Math.PI / 4;
		add(new Mesh(new BoxGeometry(0.09, 0.01, 0.15), carbon), 0, 0.012, 0);
		// canopy + camera
		add(new Mesh(new BoxGeometry(0.075, 0.05, 0.12), canopy), 0, 0.042, 0.005);
		const cam = add(
			new Mesh(new BoxGeometry(0.034, 0.034, 0.03), metal),
			0,
			0.036,
			-0.07,
		);
		cam.rotation.x = 0.35;
		const lensM = add(
			new Mesh(new CylinderGeometry(0.011, 0.011, 0.012, 14), lens),
			0,
			0.042,
			-0.088,
		);
		lensM.rotation.x = Math.PI / 2 + 0.35;
		// antenna and accent stripe
		const ant = add(
			new Mesh(new CylinderGeometry(0.003, 0.003, 0.09, 6), propM),
			0,
			0.07,
			0.075,
		);
		ant.rotation.x = -0.5;
		add(new Mesh(new BoxGeometry(0.078, 0.006, 0.07), accent), 0, 0.068, 0.012);
		// LEDs: white at the front arms, red at the back
		const led = new BoxGeometry(0.02, 0.008, 0.02);
		const r = 0.148;
		for (const [sx, sz] of [
			[1, 1],
			[-1, 1],
			[1, -1],
			[-1, -1],
		] as const) {
			const x = sx * r;
			const z = sz * r;
			add(
				new Mesh(new CylinderGeometry(0.018, 0.02, 0.022, 12), metal),
				x,
				0.017,
				z,
			);
			add(new Mesh(led, sz < 0 ? white : red), x * 0.72, -0.006, z * 0.72);
			// prop: two blades, plus a translucent blur disc that fades in with thrust
			const p = new Group();
			p.position.set(x * S, 0.034 * S, z * S);
			p.scale.setScalar(S);
			const blade = new Mesh(new BoxGeometry(0.125, 0.003, 0.016), propM);
			blade.castShadow = !g;
			p.add(blade);
			this.root.add(p);
			this.props.push(p);
			if (!g) {
				const d = new Mesh(new CircleGeometry(0.064, 24), this.discMat);
				d.rotation.x = -Math.PI / 2;
				d.position.set(x * S, 0.036 * S, z * S);
				d.scale.setScalar(S);
				this.root.add(d);
				this.discs.push(d);
			}
		}
		// the airframe in one draw per material; props stay separate to spin
		const merged = mergeByMaterial(body);
		merged.traverse((o) => {
			o.castShadow = !g;
			o.receiveShadow = false;
		});
		body.traverse((o) => {
			const m = o as Mesh;
			if (m.isMesh) m.geometry.dispose();
		});
		this.root.add(merged);
	}

	private makeDisc(): MeshBasicNodeMaterial {
		const m = new MeshBasicNodeMaterial({
			color: "#c8d0da",
			transparent: true,
			opacity: 0.18,
			depthWrite: false,
			side: DoubleSide,
		});
		this.mats.push(m);
		return m;
	}

	private readonly baseOpacity = new Map<Material, number>();

	/** Ghost fade (0..1) over each material's own opacity. */
	setOpacity(k: number): void {
		for (const m of this.mats) {
			let b = this.baseOpacity.get(m);
			if (b === undefined) {
				b = m.opacity;
				this.baseOpacity.set(m, b);
			}
			m.opacity = b * k;
		}
	}

	/** Spins the props with thrust (0..1); `dt` in seconds. */
	update(dt: number, thrust: number, armed: boolean): void {
		const rate = armed ? 40 + thrust * 160 : 0;
		this.spin += rate * dt;
		for (let i = 0; i < this.props.length; i++) {
			const p = this.props[i] as Object3D;
			p.rotation.y = (i % 2 === 0 ? 1 : -1) * this.spin + i * 0.7;
		}
		this.discMat.opacity = armed ? 0.06 + thrust * 0.22 : 0;
	}

	dispose(): void {
		this.root.traverse((o) => {
			const m = o as Mesh;
			if (m.isMesh) m.geometry.dispose();
		});
		for (const m of this.mats) m.dispose();
	}
}
