# Custom camera

Goal: drive the camera from your own code (a chase cam, a fixed arena view, a top-down follow) without the built-in orbit controls fighting you for it.

## What the scene's `camera.controller` gives you

| `controller` | Created by `createRenderer` | Created by `createGame` | Input it takes |
| --- | --- | --- | --- |
| `"orbit"` (default) | `OrbitController` (three's `OrbitControls`) on the canvas, as `renderer.controller` | nothing more | Drag rotates, wheel zooms, right-drag pans; sets the canvas's `touch-action: none`. |
| `"fly"` | `FlyController`, as `renderer.controller` | nothing more | Keyboard and mouse fly-through. |
| `"thirdPerson"` | nothing: `renderer.controller` is `null` | a `ThirdPersonController` for the scene's first `character` (`game.player.camera`), or nothing when there is no character | Click to pointer-lock; mouse moves yaw and pitch. |

There is no `"none"` value. Two ways get you a camera nobody else moves:

- **Dispose the controller** after boot: `renderer.controller?.dispose(); renderer.controller = null;`. Works with any scene.
- **`"controller": "thirdPerson"` in a scene with no `character`**: no controller is ever created. Swarm Siege and Skyrun (which boot with `createRenderer`) do this.

Always call `dispose()` before setting `null`. Setting `renderer.controller = null` alone only stops the per-frame `update`; three's `OrbitControls` keeps its pointer and wheel listeners on the canvas, and those call `update()` themselves, so a drag still moves the camera between your writes.

## Drive it every frame

```ts
import type { Game } from "@pebble3d/sdk/game";
import { Vector3 } from "three/webgpu";

export function ownCamera(game: Game, targetId: string): void {
	const r = game.renderer;
	r.controller?.dispose(); // remove OrbitControls' canvas listeners
	r.controller = null;
	const cam = r.three.camera;
	cam.fov = 55;
	cam.updateProjectionMatrix(); // after any fov / near / far change

	const id = game.ids.get(targetId);
	if (id === undefined) throw new Error(`no "${targetId}" in the scene`);
	const slot = game.sim.world.slotOf(id);
	const focus = new Vector3();
	const want = new Vector3();
	let snap = true;

	game.onFrame((dt) => {
		const c = game.views.curr; // refreshed by createGame before onFrame
		want.set(c[slot * 8] as number, c[slot * 8 + 1] as number, c[slot * 8 + 2] as number);
		// Frame-rate independent easing; snap on the first frame.
		focus.lerp(want, snap ? 1 : 1 - Math.exp(-5 * dt));
		snap = false;
		cam.position.set(focus.x, focus.y + 12, focus.z + 9);
		cam.lookAt(focus);
	});
}
```

`onFrame` runs after `renderer.sync` (every visual is already at its interpolated pose) and before `renderer.render`, so a camera written there never lags a frame. To follow a visual rather than the raw tick state, read its object: `game.player.view.root.position` for the player character.

## A spring arm without the built-in rig

`ThirdPersonController` (from `@pebble3d/renderer`) works on its own: give it the camera and a ray function, call `update(pivot, dt)` each frame, and `connect(canvas)` if the mouse should steer it.

```ts
import { ThirdPersonController } from "@pebble3d/renderer";

const STATIC_ONLY = 1; // raycast filter: moving props never pull the arm in
const tpc = new ThirdPersonController(camera, (o, d, max) => {
	if (!world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, max, STATIC_ONLY, 0)) return null;
	views.refresh(); // re-read scratch: wasm memory may have grown
	return views.scratch[0] as number;
});
tpc.distance = 6.4;
tpc.pitch = -0.3;
tpc.connect(canvas);
// per frame: tpc.update(pivot, dt); yaw 0 looks down -Z
```

| Gotcha | Detail |
| --- | --- |
| Character movement follows the camera | `createGame` turns WASD into a world direction using `game.player.camera.yaw` when the rig has a third-person camera, else the yaw of `renderer.three.camera`. Owning the camera of a character scene with `"orbit"` plus `dispose()` keeps "W = away from the camera" working. With `"thirdPerson"`, setting `game.player.camera.enabled = false` stops it moving the camera, but movement still uses its (now frozen) yaw. |
| Presets and `pnpm shot --cam` | `game.setCamera("hero")` and `__pebble3d.setCamera` apply the preset straight to the camera when there is no controller, but your next `onFrame` overwrites it. Keep a flag and skip your camera code while a preset is active; replace `__pebble3d.setCamera` if the preset path must work in captures. |
| Shadow cascades | The sun's cascades are fitted to the camera frustum. `renderer.resize` refits them; after changing `fov`, `near` or `far` yourself, call `updateCsmFrustums(renderer.csm)` (exported from `@pebble3d/renderer`). |
| Things parented to the camera | The camera is not in the scene graph by default. `renderer.three.scene.add(camera)` before attaching a viewmodel or HUD mesh to it. |
| Camera collision | Cast with filter `1` (static only) as above; a dynamic prop in the ray makes the camera pop in and out. |

See it in: [apps/drift-drone/src/game/app.ts](../../apps/drift-drone/src/game/app.ts) (dispose the orbit controller and own the camera, lines 139-145) with [apps/drift-drone/src/game/view/camera-rig.ts](../../apps/drift-drone/src/game/view/camera-rig.ts) (chase cam kept out of walls by a static-only raycast, lines 71-120), [apps/ringout/src/game/app.ts](../../apps/ringout/src/game/app.ts) (lines 114-121), [apps/lanternfall/src/view/present.ts](../../apps/lanternfall/src/view/present.ts) (top-down follow of a character, lines 262-285), [apps/skyrun/src/game/view/camera-rig.ts](../../apps/skyrun/src/game/view/camera-rig.ts) (a standalone `ThirdPersonController`, lines 35-51), [apps/skyrun/src/main.ts](../../apps/skyrun/src/main.ts) (`setCamera` presets next to a game camera, lines 340-347), [apps/swarm-siege/scenes/plateau.json](../../apps/swarm-siege/scenes/plateau.json) (`"thirdPerson"` with no character, line 24).
