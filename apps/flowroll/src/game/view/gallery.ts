/**
 * Pose gallery (`?pose=all` or `?pose=<positionId>`): every keyed pair pose, solved and
 * contact-resolved exactly as in play, laid out on the mat for review captures.
 */
import { Group, type PerspectiveCamera, type Scene } from "three/webgpu";
import { POSITIONS } from "../graph.ts";
import { BELT_COLORS, PALETTE } from "./academy.ts";
import { Mannequin } from "./mannequin.ts";
import { INTRO_POSE, type PairPose, POSES } from "./poses.ts";
import { Rig } from "./rig.ts";

export class Gallery {
	readonly root = new Group();
	private readonly items: { rig: Rig; a: Mannequin; b: Mannequin; g: Group }[] =
		[];
	readonly labels: { text: string; x: number; z: number }[] = [];

	constructor(
		scene: Scene,
		which: string,
		cam: PerspectiveCamera,
		view: string,
	) {
		const list: [string, PairPose][] = [];
		for (const p of POSITIONS)
			if (which === "all" || which === p.id) list.push([p.id, POSES[p.id]]);
		if (which === "all" || which === "intro") list.push(["intro", INTRO_POSE]);
		const cols = which === "all" ? 4 : 1;
		const sp = 2.3;
		list.forEach(([id, pose], i) => {
			const rig = new Rig();
			rig.frozen = { pose, top: 0 };
			for (let k = 0; k < 4; k++) rig.update(null, 0.016);
			const a = new Mannequin({
				gi: PALETTE.giWhite,
				belt: BELT_COLORS.blue as string,
			});
			const b = new Mannequin({
				gi: PALETTE.giBlue,
				belt: BELT_COLORS.black as string,
				bar: "#c22a22",
			});
			const g = new Group();
			g.add(a.root, b.root);
			const x = ((i % cols) - (cols - 1) / 2) * sp;
			const z = cols === 1 ? 0 : (Math.floor(i / cols) - 1) * sp;
			g.position.set(x, 0, z);
			a.apply(rig.sol[0]);
			b.apply(rig.sol[1]);
			this.root.add(g);
			this.items.push({ rig, a, b, g });
			this.labels.push({ text: id, x, z });
		});
		scene.add(this.root);
		this.cam = cam;
		if (which === "all") {
			this.eye = [0, 7.2, 6.4];
			this.at = [0, 0, 0.6];
			cam.fov = 50;
		} else {
			const views: Record<string, [number, number, number]> = {
				front: [0, 1.4, 3.0],
				side: [3.0, 1.4, 0.01],
				top: [0.01, 3.4, 0.4],
				back: [0.01, 1.4, -3.0],
				q: [2.2, 1.7, 2.2],
				q2: [-2.2, 1.7, 2.2],
				q3: [-2.2, 1.7, -2.2],
			};
			this.eye = views[view] ?? (views.q as [number, number, number]);
			this.at = [0, which === "standing" || which === "intro" ? 0.75 : 0.35, 0];
			cam.fov = 40;
		}
		cam.updateProjectionMatrix();
		this.frame();
	}

	private readonly cam: PerspectiveCamera;
	private eye: [number, number, number] = [0, 0, 0];
	private at: [number, number, number] = [0, 0, 0];

	/** The renderer re-applies its own camera on boot: re-aim every frame. */
	frame(): void {
		this.cam.position.set(...this.eye);
		this.cam.lookAt(...this.at);
	}
}
