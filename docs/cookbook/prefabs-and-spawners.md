# Prefabs and spawners

Goal: define a prop once, place copies of it, and rain more of them in at a fixed rate, deterministically.

```json
{
	"version": 1,
	"environment": { "preset": "studio", "ground": {} },
	"sim": { "seed": 7 },
	"prefabs": {
		"crate": { "mesh": { "primitive": "box", "material": { "color": "#a8743f", "roughness": 0.78 } }, "transform": { "scale": [0.5, 0.5, 0.5] }, "body": { "friction": 0.7 } },
		"ball": { "mesh": { "primitive": "sphere", "material": { "color": "#3a7be8" } }, "transform": { "scale": [0.3, 0.3, 0.3] }, "body": { "restitution": 0.5 } }
	},
	"entities": [
		{ "id": "crate-1", "prefab": "crate", "transform": { "position": [0, 0.25, 0] } },
		{ "id": "crate-big", "prefab": "crate", "transform": { "position": [1.2, 0.5, 0], "scale": [1, 1, 1] } },
		{ "id": "rain", "spawner": { "prefab": "ball", "rate": 4, "count": 60, "area": { "min": [-2, 4, -2], "max": [2, 6, 2] } } }
	]
}
```

How it works:

- `prefab` is deep-merged under the entity: entity fields win, objects merge key by key (`crate-big` keeps the prefab's mesh and body and only changes `scale`).
- A spawner entity has only `spawner` (plus `id` and optional `transform`). The engine's Rust spawner creates `count` bodies, `rate` per second, uniformly inside `area`, from a seeded generator: `spawner.seed`, else `sim.seed` + the entity's index.
- `createGame` drains new bodies each frame (`world.drainSpawned()`, flat `(id, slot, spawnerSimId)` triples) and draws them. Dynamic primitive props, spawned or not, are instanced: one draw call per primitive + size + material.

| Gotcha | Detail |
| --- | --- |
| Spawner entity is bare | A `mesh`, `body` or `character` on the spawner entity itself is an error: put them on the prefab. |
| Prefab must have a body | And no `character`; the error is on `entities[i].spawner.prefab`. |
| Spawned bodies are not in `game.ids` | Track them from `drainSpawned` in your own loop, or by slot. |
| Prefab `position` is ignored for spawns | They land in `area`; the prefab's rotation and scale apply. |
| Runtime spawners | `world.spawn('{"spawner":{"template":{...},"rate":..,"count":..,"areaMin":[..],"areaMax":[..],"seed":..}}')` works too, but then you drain and draw the bodies yourself; despawn the spawner entity once it is done. |
| Own world, own draining | With a custom boot (no `createGame`), check `world.spawnedPending() > 0` before `drainSpawned()` (it allocates). |

See it in: [apps/playground/scenes/showcase.json](../../apps/playground/scenes/showcase.json) (prefabs and the `ball-spawner`), [apps/rockfall/src/game/sim.ts](../../apps/rockfall/src/game/sim.ts) (runtime spawners from wave orders, lines 441-475; draining, lines 595-640), [apps/rockfall/src/game/view/rock-view.ts](../../apps/rockfall/src/game/view/rock-view.ts) (drawing drained bodies, lines 68-101).
