import { createGame } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";

/**
 * Authoring aid (`?scout=<scene>&pose=px,py,pz,tx,ty,tz,fov`): renders a scene's splat from a
 * fixed camera pose with a 1 m marker grid, for placing bounds, colliders and spots.
 * `rot=qx,qy,qz,qw`, `pos=x,y,z` and `scale=s` override the splat transform.
 */
export async function scout(
	canvas: HTMLCanvasElement,
	q: URLSearchParams,
): Promise<void> {
	const scenes = import.meta.glob("../scenes/*.json", {
		eager: true,
		import: "default",
	});
	const name = q.get("scout") ?? "yard";
	const json = scenes[`../scenes/${name}.json`];
	if (!json) throw new Error(`no scene ${name}`);
	const scene = structuredClone(json) as {
		environment: { splat: Record<string, unknown> };
		entities: unknown[];
	};
	const nums = (k: string): number[] | null => {
		const v = q.get(k);
		return v ? v.split(",").map(Number) : null;
	};
	const sp = scene.environment.splat;
	const rot = nums("rot");
	if (rot) sp.rotation = rot;
	const pos = nums("pos");
	if (pos) sp.position = pos;
	const sc = nums("scale");
	if (sc) sp.scale = sc[0];
	if (q.get("grid") === "1") {
		for (let x = -12; x <= 12; x += 2)
			for (let z = -12; z <= 12; z += 2)
				scene.entities.push({
					id: `g${x}_${z}`,
					mesh: {
						primitive: "box",
						material: {
							color:
								x === 0 && z === 0
									? "#ff0000"
									: x === 0
										? "#00ff00"
										: z === 0
											? "#0000ff"
											: "#ffffff",
							roughness: 1,
						},
					},
					transform: { position: [x, 0.05, z], scale: [0.12, 0.1, 0.12] },
				});
	}
	const game = await createGame({
		canvas,
		scene: scene as unknown as SceneInput,
		mode: q.get("mode") === "fixed" ? "fixed" : "realtime",
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(q.get("ticks") ? { stopAtTick: Number(q.get("ticks")) } : {}),
	});
	const pose = nums("pose") ?? [6, 4, 8, 0, 1, 0, 50];
	if (game.player?.camera) game.player.camera.enabled = false;
	const cam = game.renderer.three.camera;
	game.onFrame(() => {
		cam.position.set(pose[0] ?? 0, pose[1] ?? 0, pose[2] ?? 0);
		cam.lookAt(pose[3] ?? 0, pose[4] ?? 0, pose[5] ?? 0);
		cam.fov = pose[6] ?? 50;
		cam.updateProjectionMatrix();
		cam.updateMatrixWorld();
	});
	game.start();
}
