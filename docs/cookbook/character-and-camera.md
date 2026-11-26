# Character and camera

Goal: a walking, jumping player with a third-person camera, eased acceleration and animation clips matched to its speed.

```json
{
	"version": 1,
	"environment": { "preset": "studio", "ground": {} },
	"camera": { "controller": "thirdPerson", "presets": { "hero": { "position": [6, 4, 8], "target": [0, 1, 0] } } },
	"entities": [
		{
			"id": "player",
			"mesh": { "primitive": "capsule", "material": { "color": "#4a8fe0" } },
			"body": {},
			"character": { "speed": 4, "sprintSpeed": 6.5, "jumpSpeed": 5.5, "accel": 14 },
			"transform": { "position": [0, 1, 0], "scale": [0.6, 1.8, 0.6] }
		},
		{ "id": "step", "mesh": { "primitive": "box" }, "body": { "type": "static" }, "transform": { "position": [2, 0.15, 0], "scale": [1, 0.3, 1] } }
	]
}
```

`createGame` turns the first entity with a `character` into `game.player`: WASD/arrows move relative to the camera yaw, Space jumps, Shift sprints, and a click pointer-locks the mouse for the camera. A glTF character instead uses an explicit capsule collider and maps clips, as in `apps/field-notes/scenes/yard.json`:

```json
{ "gltf": { "url": "/assets/rocketbox-male-adult-16.glb", "animations": { "idle": "Idle", "walk": { "clip": "Walk", "speed": 0.979 }, "run": { "clip": "Run", "speed": 5.649 }, "jump": "Jump", "fall": "Fall" } } }
```

(a fragment: the value of `mesh`; pair it with `"body": { "type": "kinematic", "collider": { "shape": "capsule", "halfHeight": 0.5, "radius": 0.3 } }`).

| Gotcha | Detail |
| --- | --- |
| Body is required | `character` needs a kinematic body with a capsule collider. `"body": {}` defaults to kinematic for a character; `collider: "auto"` on a glTF makes a hull, which is rejected, so give the capsule. |
| Capsule auto-fit | On a capsule primitive, `scale.y` must exceed `scale.x` (it is the total height). |
| `accel` | m/s² toward the input velocity; 0 (default) is instant. 14 ramps a 4 m/s walk in about 0.3 s. |
| Clip `speed` | The clip's authored ground speed; playback rate becomes `speed / authored`, clamped to 0.6-1.6, which stops foot sliding. Walk/run switch at 0.75 x `sprintSpeed`. |
| Driving it from code | Write `game.player.input` (`keys.f/b/l/r`, `jump`, `sprint`). It is sent as `setCharacterInput` before your `onFrame` runs, so a value set in the frame at tick t is first used by the step that produces tick t + 2. |
| Your own `setCharacterInput` for the player | `createGame` calls `setCharacterInput` for `game.player` from `game.player.input` every frame, **including frames that advance 0 ticks** (any display above 60 Hz, where most frames run no tick). If your rules call `world.setCharacterInput(game.player.simId, ...)` themselves only inside the per-tick loop, the rig overwrites that on the next 0-tick frame and the following `world.step` uses keyboard input instead (a demo bot that stops steering, a player who walks on the title screen). Re-send your intent at the end of every `onFrame`, after the tick loop: it then always wins. Or drive the player only through `game.player.input`. |
| Which character is the player | The first entity in `entities` (after prefab expansion) that has a `character`. Reorder the entities to change it; there is no option to pick another or to have none while keeping characters. |
| More characters | Only the player gets an animated `CharacterView`. Every other character is still moved by the renderer (its root follows its capsule), but plays no clip and never turns until you call `game.renderer.attachCharacter(simId, clipMap)` once, then each frame `world.characterState(simId)` and `view.update(frame, dt)` with `{ grounded, vx, vz, vy, sprintSpeed }` read from scratch `[8..12)`. `update` also turns the model toward its velocity; set `view.root.rotation` after it to face elsewhere. |
| Reading it back | `world.characterState(id)` writes `[grounded, vx, vz, vy]` to scratch `[8..12)` (vz before vy). |
| Camera | `game.player.camera` (`ThirdPersonController`): `yaw` (0 looks down -Z), `pitch` (-1.2 to 0.3), `distance`. Its arm ray is static-only. `game.setCamera("hero")` suspends it; `"controller"` resumes it. Your own camera instead: [custom-camera.md](custom-camera.md). |
| Moving platforms | Set `"ridePlatforms": true` on the `character` to stand on a kinematic body driven by `world.setKinematicPose` each tick: the character moves (and turns about the platform's origin) exactly with it, and keeps its velocity as momentum after a jump or walking off. Without the flag Rapier's own platform friction lags a tick and a character at rest on a kinematic body can get pinned and fail to walk. The reported `characterState` velocity stays the character's own, relative to the platform. Set the platform's pose before the `world.step` it should apply to. A pose jump over 1 m in one tick counts as a teleport and is not carried. While riding, steps up to `stepHeight` are climbed by a lift-and-set-down cast, which ignores autostep's `min_width`. |
| Own character | A character spawned with `world.spawn` (no `createGame` rig) is driven only by your `setCharacterInput` calls each tick. |

See it in: [apps/field-notes/scenes/yard.json](../../apps/field-notes/scenes/yard.json) (glTF player with `accel`, lines 65-100), [apps/field-notes/src/main.ts](../../apps/field-notes/src/main.ts) (a sim writing `rig.input` from its own buttons, lines 210-218), [apps/playground/src/main.ts](../../apps/playground/src/main.ts) (scripted input and the jump timing, lines 132-179), [apps/rockfall/src/game/sim.ts](../../apps/rockfall/src/game/sim.ts) (character spawned from JSON and driven per tick, lines 264-287 and 373-415), [apps/lanternfall/src/main.ts](../../apps/lanternfall/src/main.ts) (re-sending the sim's intents after every frame's ticks, lines 82-91) with [apps/lanternfall/src/game/sim.ts](../../apps/lanternfall/src/game/sim.ts) (`assertInput`, lines 403-420), [apps/lanternfall/src/view/present.ts](../../apps/lanternfall/src/view/present.ts) (guards animated with `attachCharacter`, lines 155-160 and 248-260), [apps/skyrun/src/game/sim.ts](../../apps/skyrun/src/game/sim.ts) (a runner with `ridePlatforms` on kinematic movers, lines 169 and 206).
