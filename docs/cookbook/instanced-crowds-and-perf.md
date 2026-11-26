# Instanced crowds and performance

Goal: hundreds of bodies or characters at 60 fps on a laptop GPU.

Scene props are instanced for you: every dynamic primitive entity (and every spawned body) with the same primitive, size, material and `castShadow` shares one `InstancedMesh`. For bodies your code spawns, add them to the same registry by slot; `createGame`'s `renderer.sync` moves them every frame:

```ts
import { BoxGeometry, Color, MeshStandardNodeMaterial } from "three/webgpu";

const geo = new BoxGeometry(0.5, 0.5, 0.5);
const mat = new MeshStandardNodeMaterial({ roughness: 0.8 });
const tint = new Color();
const inst = game.renderer.instances; // InstanceRegistry

function addRock(id: number, shade: number): void {
	const slot = game.sim.world.slotOf(id);
	inst.add("rock|0", geo, mat, slot, tint.setRGB(shade, shade, shade)); // one draw call per key
}
function removeRock(id: number, slot: number): void {
	inst.removeSlot(slot); // before (or right after) world.despawn(id)
	game.sim.world.despawn(id);
}
// Tiny things skip the shadow cascades. The mesh is replaced when its group grows
// (castShadow carries over): look it up with mesh(key), don't keep the reference.
const pebbles = inst.mesh("pebble|0");
if (pebbles) pebbles.castShadow = false;
```

| Technique | Where |
| --- | --- |
| Skinned crowd: clone every avatar up front (`SkeletonUtils.clone`) into a pool sized for the worst wave; never clone mid-fight. | `apps/katana-defense/src/game/view/zombie-pool.ts` (pool sizes), `zombie-view.ts` (clones) |
| Blob shadows: one instanced, depth-write-off quad per zombie instead of shadow-casting skinned meshes. | `apps/katana-defense/src/game/view/zombie-view.ts`, lines 81-99 |
| `stylize`/look a cached glTF once, then clone: clones share materials. | `apps/katana-defense/src/main.ts`, lines 120-127 |
| Cap catch-up ticks (`maxTicksPerFrame: 2`) so heavy physics slows the game instead of spiralling. | `apps/rockfall/src/main.ts`, lines 324-331 |
| `"sim": { "build": "fast" }`: the SIMD Rapier build (Rockfall's fast capture holds 1,800 rocks); deterministic only for the same binary on the same machine. | `apps/breakpoint/scenes/site.json`, `apps/rockfall/src/main.ts` (`?build=fast`) |
| Physics in a Web Worker, packed state posted back each tick (transferred buffers, pooled). | `apps/breakpoint/src/game/sim.worker.ts`, lines 24-34 and 55-71 |
| Sample `world.bodyCounts()` every 30 frames only: it allocates. | `packages/sdk/src/game.ts` (`BODY_COUNT_INTERVAL`) |

| Gotcha | Detail |
| --- | --- |
| No allocation per frame | Preallocate vectors, typed arrays and event records; reuse the `{ ticks, alpha }` object `FixedStepLoop.advance` returns. |
| Instance keys must match | A new key is a new `InstancedMesh` (a new draw call). Vary colour per instance (the 5th argument), not material. |
| Budgets | Splats 1,500,000 (warns above); shadow cascades 3, max distance 120 m; DPR capped at 2. |
| Measure on an idle GPU | Benches: `node apps/<app>/bench/fps.mjs`; see [verification.md](../verification.md#benches-and-capture-scripts). |

See it in: [apps/rockfall/src/game/view/rock-view.ts](../../apps/rockfall/src/game/view/rock-view.ts) (spawned rocks into the registry, lines 68-101).
