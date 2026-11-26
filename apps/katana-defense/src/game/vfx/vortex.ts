import {
	abs,
	float,
	fract,
	sin,
	smoothstep,
	time,
	uniform,
	uv,
	vec3,
} from "three/tsl";
import {
	AdditiveBlending,
	CylinderGeometry,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	type Scene,
} from "three/webgpu";

/**
 * Spin Storm: two counter-scrolling open cylinders of wind streaks around the player,
 * additive, scaled in and out with the move.
 */
export class Vortex {
	readonly group = new Group();
	private readonly strength = uniform(0);
	private level = 0;

	constructor(scene: Scene) {
		const make = (
			r: number,
			h: number,
			speed: number,
			tint: [number, number, number],
		): Mesh => {
			const m = new MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
				side: DoubleSide,
			});
			const u = uv();
			const swirl = fract(u.x.mul(5).add(u.y.mul(1.3)).sub(time.mul(speed)));
			const streak = float(1).sub(smoothstep(0, 0.22, abs(swirl.sub(0.5))));
			const fadeY = smoothstep(0, 0.25, u.y).mul(
				float(1).sub(smoothstep(0.6, 1, u.y)),
			);
			const flick = sin(u.x.mul(40).add(time.mul(9)))
				.mul(0.25)
				.add(0.75);
			m.colorNode = vec3(...tint).mul(
				streak.mul(fadeY).mul(flick).mul(this.strength),
			);
			const mesh = new Mesh(
				new CylinderGeometry(r, r * 0.8, h, 48, 1, true),
				m,
			);
			mesh.position.y = h / 2;
			mesh.frustumCulled = false;
			mesh.renderOrder = 6;
			return mesh;
		};
		this.group.add(make(3.1, 1.5, 2.2, [0.35, 0.65, 1.15]));
		this.group.add(make(2.3, 1.9, -3.1, [0.8, 0.85, 1.0]));
		this.group.visible = false;
		scene.add(this.group);
	}

	update(dt: number, active: boolean, x: number, y: number, z: number): void {
		const target = active ? 1 : 0;
		this.level +=
			(target - this.level) * (1 - Math.exp(-(active ? 10 : 6) * dt));
		this.strength.value = this.level;
		this.group.visible = this.level > 0.02;
		this.group.position.set(x, y, z);
		this.group.rotation.y += dt * 9 * this.level;
		const s = 0.6 + 0.4 * this.level;
		this.group.scale.set(s, 1, s);
	}
}
