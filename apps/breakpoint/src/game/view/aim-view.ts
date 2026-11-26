import {
	type Camera,
	Color,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	Quaternion,
	RingGeometry,
	type Scene,
	SphereGeometry,
	Vector3,
} from "three/webgpu";
import { sampleArc } from "../aim.ts";

const DOTS = 56;
const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _hidden = new Matrix4().makeScale(0, 0, 0);

/** The dotted ballistic arc from the muzzle, and the reticle ring on the aim point. */
export class AimView {
	private readonly dots: InstancedMesh;
	private readonly ring: Mesh;
	private readonly mat: MeshBasicNodeMaterial;
	private readonly pts = new Float32Array(DOTS * 3);
	private readonly ok = new Color("#ffd27a");
	private readonly bad = new Color("#ff5a4a");
	private phase = 0;

	constructor(scene: Scene) {
		this.mat = new MeshBasicNodeMaterial({
			color: this.ok.clone(),
			transparent: true,
			opacity: 0.9,
		});
		this.mat.depthWrite = false;
		this.dots = new InstancedMesh(new SphereGeometry(1, 10, 6), this.mat, DOTS);
		this.dots.frustumCulled = false;
		this.dots.renderOrder = 3;
		scene.add(this.dots);
		const ringMat = new MeshBasicNodeMaterial({
			color: new Color("#ffe2a8"),
			transparent: true,
			opacity: 0.95,
		});
		ringMat.depthTest = false;
		this.ring = new Mesh(new RingGeometry(0.42, 0.55, 40), ringMat);
		this.ring.renderOrder = 4;
		scene.add(this.ring);
		this.hide();
	}

	hide(): void {
		this.dots.visible = false;
		this.ring.visible = false;
	}

	/** Shows the arc for launch `vel` from `from`, the ring at `target`. */
	show(
		from: readonly [number, number, number],
		vel: readonly [number, number, number],
		target: Vector3,
		reachable: boolean,
		camera: Camera,
		dt: number,
	): void {
		this.dots.visible = true;
		this.ring.visible = true;
		this.phase = (this.phase + dt * 1.6) % 1;
		const n = sampleArc(from, vel, 0.045, this.pts);
		this.mat.color.copy(reachable ? this.ok : this.bad);
		for (let i = 0; i < DOTS; i++) {
			if (i >= n - 1) {
				this.dots.setMatrixAt(i, _hidden);
				continue;
			}
			// Interpolate along the segment so the dots crawl toward the target.
			const a = i * 3;
			const t = this.phase;
			_p.set(
				(this.pts[a] as number) +
					((this.pts[a + 3] as number) - (this.pts[a] as number)) * t,
				(this.pts[a + 1] as number) +
					((this.pts[a + 4] as number) - (this.pts[a + 1] as number)) * t,
				(this.pts[a + 2] as number) +
					((this.pts[a + 5] as number) - (this.pts[a + 2] as number)) * t,
			);
			const s = 0.09 + 0.05 * Math.min(1, i / 10);
			_s.setScalar(i < 2 ? 0 : s);
			_m.compose(_p, _q.identity(), _s);
			this.dots.setMatrixAt(i, _m);
		}
		this.dots.instanceMatrix.needsUpdate = true;
		this.ring.position.copy(target);
		this.ring.quaternion.copy(camera.quaternion);
		const pulse = 1 + 0.08 * Math.sin(this.phase * Math.PI * 2);
		// Constant screen size: scale with the distance to the camera.
		this.ring.scale.setScalar(
			pulse * Math.max(1, camera.position.distanceTo(target) / 22),
		);
	}
}
