# JSON levels and headless verify

Goal: levels as data files, each proven solvable by running the real engine sim in Node, with the result pinned by a state hash the browser must reproduce.

Chain Reaction's level format (`apps/chain-reaction/level.schema.json`) wraps a partial scene in puzzle metadata. `levels/01-first-drop.json` (a level file, not a scene, so no `"version"`; `hint` omitted):

```json
{
	"$schema": "../level.schema.json",
	"id": "01-first-drop",
	"name": "First Drop",
	"grid": { "cols": 12, "rows": 7, "origin": [-6, 0] },
	"ball": { "cell": [1, 6] },
	"goal": { "cell": [8, 0] },
	"inventory": { "ramp": 4 },
	"par": 1,
	"solution": [{ "part": "ramp", "cell": [1, 3], "dir": "right" }],
	"scene": {
		"entities": [
			{ "id": "slab", "prefab": "block", "transform": { "position": [-2, 0.5, 0], "scale": [8, 1, 1] } },
			{ "id": "backstop", "prefab": "block", "transform": { "position": [4.5, 1.5, 0], "scale": [3, 3, 1] } }
		]
	},
	"expect": { "tick": 213, "hash": "526cbffcde43ae4c" }
}
```

`composeLevel` deep-merges `scene` over `levels/base.json` (entities appended), adds the placed parts as prefab entities, then runs `parseScene` and `expandScene` like any scene. `PuzzleSim` spawns the result into a fresh `World` and steps it at 60 Hz. The browser and the CLI share that code.

```bash
pnpm --filter chain-reaction verify                 # all levels: "all 6 verified", exit 0
pnpm --filter chain-reaction verify 3               # one level (number, id or id prefix)
pnpm --filter chain-reaction verify --file /abs/my.json  # a level outside the campaign
pnpm --filter chain-reaction verify 3 --placements '[{"part":"fan","cell":[2,6],"dir":"right"}]'  # try a candidate
pnpm --filter chain-reaction verify --update        # rewrite each level's expect {tick, hash}
pnpm --filter chain-reaction verify --json          # machine-readable rows
node apps/chain-reaction/bench/agree.mjs            # browser hashes equal Node's (6/6)
```

The same approach for any game: a Node entry that loads the det wasm bytes (`loadSim("deterministic", readFileSync(...))`), builds the sim from the data file, runs a reference input or solution, and compares `world.stateHash()`.

## Spawn a scene and read state in Node

What `createGame` does at boot, without a browser (runs in a vitest test or a `node --experimental-strip-types` script):

```ts
import { readFileSync } from "node:fs";
import { expandScene } from "@pebble3d/sdk/expand";
import { parseScene } from "@pebble3d/sdk/schema";
import { loadSim, StateViews } from "@pebble3d/sdk/sim";

const bytes = readFileSync(new URL("../../../packages/sdk/wasm/det/engine_core_det_bg.wasm", import.meta.url));
const scene = parseScene(JSON.parse(readFileSync(new URL("../scenes/court.json", import.meta.url), "utf8")));
const handle = await loadSim("deterministic", bytes, { seed: scene.sim.seed, gravity: scene.sim.gravity });

// x.sim is SimEntry[]: { sceneId, desc }, in spawn order "__ground", "__bounds.<side>", then entities.
// desc is the engine's EntityDescJson; spawnScene(entries) calls world.spawn(JSON.stringify(e.desc)) for each.
const x = expandScene(scene);
const ids = handle.spawnScene(x.sim.filter((e) => !x.pendingHulls.includes(e.sceneId))); // Map sceneId -> sim id
const views = new StateViews(handle); // views.curr / views.prev / views.scratch over handle.memory

const ball = ids.get("ball") as number;
const slot = handle.world.slotOf(ball); // -1 if the entity has no slot
for (let t = 0; t < 120; t++) {
	handle.world.step(1);
	views.refresh(); // cheap no-op unless buffers moved; always call it after spawning or stepping
}
const base = slot * 8; // per slot: px, py, pz, qx, qy, qz, qw, flags
const pos = [views.curr[base], views.curr[base + 1], views.curr[base + 2]];
const vel = handle.world.linearVelocity(ball) ? [views.scratch[12], views.scratch[13], views.scratch[14]] : null;
console.log(pos, vel, handle.world.stateHash(), handle.world.tick());
handle.world.free();
```

| Gotcha | Detail |
| --- | --- |
| `SimEntry` | `{ sceneId: string; desc: EntityDescJson }`. `sceneId` is the scene `id` (or `__ground`, `__bounds.minX`...); `desc` is what `World.spawn` parses. Spawning `x.sim` in order gives the same ids and the same `stateHash` as `createGame` (for scenes without auto-hull glTF entities; `createGame` spawns those last, see `game.ts`). |
| `environment.ground` is spawned too | It is the first entry (`__ground`): a static infinite half-space at `ground.y` with friction 0.5, restitution 0; `size` only sizes the visible plane. So Node and the browser share the floor; you do not need a box entity for it. |
| `pendingHulls` | glTF entities with an auto convex hull have empty `points` until the renderer reads the mesh. Node has no renderer: skip them (above), or give those entities an explicit primitive collider. |
| `StateViews(handle)` | Takes a `SimHandle` (only `world` and `memory` are read). Views are byte-offset windows on `memory.buffer`; they go stale when wasm memory grows or the world's buffers grow (spawning), which is what `refresh()` checks. Never keep a raw `Float32Array` across a spawn. |
| Velocity and queries | `linearVelocity`, `angularVelocity`, `characterState`, `raycast` write into `views.scratch` and return `false` when there is nothing to write (offsets in [api-reference.md](../api-reference.md#scratch-buffer)). Read the scratch right away; the next query overwrites it. |
| Allocating reads | `world.transformOf(id)` returns a fresh `Float32Array` (`[px, py, pz, qx, qy, qz, qw]`) or undefined: fine in a test, not in a per-tick path. |
| More worlds | `const World = handle.world.constructor as new (seed: number, g: number) => typeof handle.world;` then `new World(seed, g)`, `new StateViews({ ...handle, world: w2 })`, and `w2.free()` when done. |
| Tick order | To match a `createGame` browser run, step first, then run rules: see [getting-started.md](../getting-started.md#tick-order). |

| Gotcha | Detail |
| --- | --- |
| A new level needs `--update` | Write the level and its `solution`, then `verify --update`; commit the `expect` it writes. A later engine or rule change that moves the hash fails `verify` until you check and re-pin it. |
| `par` | Must be at least the reference solution's part count, or `verify` fails the level. |
| One code path | Keep the sim free of DOM and timing so Node and the browser run identical code (`src/puzzle/sim.ts`). |
| Register it | New campaign levels are imported in `src/puzzle/levels.ts`. `--file` checks a loose file; pnpm runs the script in `apps/chain-reaction`, so pass an absolute path or one relative to that directory. |
| Schema | After changing `LevelSchema`, `pnpm --filter chain-reaction schema` rewrites `level.schema.json`. |
| Base prefabs | The `prefab` names a level uses (`block`, `ball`...) live in `levels/base.json`. |

See it in: [apps/chain-reaction/src/cli/verify.ts](../../apps/chain-reaction/src/cli/verify.ts) (lines 99-145), [apps/chain-reaction/src/puzzle/compose.ts](../../apps/chain-reaction/src/puzzle/compose.ts) (`composeLevel`, lines 152-256), [apps/chain-reaction/src/puzzle/level.ts](../../apps/chain-reaction/src/puzzle/level.ts) (`LevelSchema`, lines 38-104), [apps/chain-reaction/src/puzzle/node-engine.ts](../../apps/chain-reaction/src/puzzle/node-engine.ts).
