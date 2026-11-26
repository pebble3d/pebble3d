# Scene basics

Goal: a scene file with a floor, walls, static and dynamic props and a camera, that validates the first time.

```json
{
	"version": 1,
	"environment": { "preset": "studio", "ground": { "size": 30 } },
	"bounds": { "min": [-6, -6], "max": [6, 6], "height": 2 },
	"lighting": { "sun": { "direction": [0.4, 1, 0.3], "intensity": 3 } },
	"camera": { "controller": "orbit", "presets": { "hero": { "position": [0, 6, 12], "target": [0, 1, 0], "fov": 45 } } },
	"entities": [
		{ "id": "table", "mesh": { "primitive": "box", "material": { "color": "#6b4f3a" } }, "body": { "type": "static" }, "transform": { "position": [0, 0.5, 0], "scale": [3, 1, 1.5] } },
		{ "id": "crate", "mesh": { "primitive": "box" }, "body": { "mass": 2, "friction": 0.7 }, "transform": { "position": [0.4, 2.5, 0], "scale": [0.5, 0.5, 0.5] } },
		{ "id": "ball", "mesh": { "primitive": "sphere", "material": { "color": "#e8553a", "roughness": 0.3 } }, "body": { "restitution": 0.6 }, "transform": { "position": [-0.6, 3, 0] } },
		{ "id": "sign", "mesh": { "primitive": "cylinder" }, "transform": { "position": [4, 1, -4], "scale": [0.2, 2, 0.2] } }
	]
}
```

Load it in the playground: save it as `apps/playground/scenes/<name>.json` and open `/?scene=<name>&cam=hero`, or `pnpm shot --scene <name> --cam hero`.

| Gotcha | Detail |
| --- | --- |
| A mesh without `body` has no physics | `sign` above is visual only: nothing collides with it and raycasts miss it. Add `"body": { "type": "static" }` for a solid prop. |
| `body` alone defaults to dynamic | `{}` is a dynamic body with friction 0.5, restitution 0, mass from volume at density 1. |
| Primitives are unit-sized | Box 1x1x1, sphere diameter 1, cylinder and capsule diameter x by height y. `transform.scale` is the size in metres, and `collider: "auto"` fits it. |
| Rotations are quaternions | `[x, y, z, w]`; 90 degrees about Y is `[0, 0.7071, 0, 0.7071]`. |
| Objects are strict | An unknown key (`"colour"`, `"size"`) fails validation with its path, e.g. `SceneError: entities[1].mesh: Unrecognized key: "colour"`. |
| Ids are unique | A duplicate `id` is an error; `game.ids.get("crate")` maps it to the sim id. |
| `bounds` are invisible | Static walls on the XZ rectangle, from y = 0 to `height`. Their ids are `__bounds.<side>`. |
| Static colliders may overlap | Static bodies never collide with each other (Rapier skips fixed-fixed pairs), so a static pad sunk into the floor or two overlapping static boxes cost nothing and push nothing. |
| Thin colliders | A 0.02 m static box holds resting bodies fine, but a fast body can pass through a thin collider in one tick: give the fast body `"ccd": true`, or make the collider thicker. A target that rules only test by position (an `inZone` check) needs no `body` at all. |
| `environment.ground` vs a floor box | `ground` is an infinite static half-space at `ground.y` (friction 0.5, restitution 0, the body defaults); `size` only sizes the visible plane, so bodies never fall off its edge. A static box floor has edges and its own `friction`/`restitution`. Both are spawned by `expandScene`, so Node and the browser get the same floor either way. |
| Static visuals are placed once | The renderer places a `static` body's mesh from the state buffer on the first `renderer.sync` after it is added, then never touches it again (dynamic, kinematic and character visuals follow their slot every frame). `teleport` on a static body moves its collider but not its mesh: anything that moves must be `kinematic`. Code that reads or merges static meshes (baking a level into a few draw calls) must wait until after the first frame, when they have their final transforms. |
| Collider limits | `plane` only on static bodies; `trimesh` only on static or kinematic ones. |

Every field and default: [scene-reference.md](../scene-reference.md). Editor validation: set `"$schema"` to `packages/sdk/scene.schema.json` relative to the file.

See it in: [apps/playground/scenes/studio.json](../../apps/playground/scenes/studio.json) (primitives, materials, prefabs), [apps/chain-reaction/levels/base.json](../../apps/chain-reaction/levels/base.json) (a studio base scene), [apps/lanternfall/src/view/present.ts](../../apps/lanternfall/src/view/present.ts) (merging the static level meshes on the first frame, after their placement, lines 227-241).
