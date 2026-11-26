# Raycasts

Goal: ground probes, line-of-sight tests and "what did I hit" queries against the physics world.

```ts
import type { Game } from "@pebble3d/sdk/game";

const RAY_ALL = 0;
const RAY_STATIC = 1; // ground, bounds, static entities only
const RAY_EXCLUDE = 2; // everything but `excludeId`

/** Height of the ground under (x, z), or 0 when nothing is below. */
export function groundY(game: Game, x: number, z: number, selfId: number): number {
	const top = 20;
	const world = game.sim.world;
	if (!world.raycast(x, top, z, 0, -1, 0, top + 5, RAY_EXCLUDE, selfId)) return 0;
	return top - (game.views.scratch[0] as number); // scratch [toi, nx, ny, nz, id]
}

/** True when a static collider blocks the segment from a to b. */
export function blocked(game: Game, a: number[], b: number[]): boolean {
	const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
	const len = Math.hypot(dx, dy, dz);
	return game.sim.world.raycast(a[0], a[1], a[2], dx, dy, dz, len, RAY_STATIC, 0);
}

/** Scene id of the first body hit, or null. `byId` is game.ids inverted once at startup. */
export function pick(game: Game, byId: Map<number, string>, o: number[], d: number[]): string | null {
	if (!game.sim.world.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 100, RAY_ALL, 0)) return null;
	return byId.get(game.views.scratch[4] as number) ?? null;
}
```

| Gotcha | Detail |
| --- | --- |
| Results live in scratch | `raycast` returns a boolean; the hit is in `game.views.scratch[0..5)`. Read it before the next query (any query overwrites scratch). |
| Direction need not be unit | The engine normalises it, so `toi` is metres and `maxToi` is a distance. |
| Exclude the caster | A probe from inside a body hits that body first; use filter 2 with its id. |
| Spawned this tick = invisible | Queries see the broad phase as of the last `step`. |
| Hit id 1 is usually `__ground` | Generated statics (`__ground`, `__bounds.<side>`) are in `game.ids`. Filter 1 still hits the invisible bounds walls; Field Notes skips them by id for its camera arm. |
| Views after spawning | If you spawned this frame, `game.views.refresh()` first; a stale view reads detached memory. |

Filters and the scratch layout: [api-reference.md](../api-reference.md#raycasts).

See it in: [apps/rockfall/src/game/sim.ts](../../apps/rockfall/src/game/sim.ts) (pickup resting height with filter 2, lines 934-951), [apps/ghostline/src/game/sim.ts](../../apps/ghostline/src/game/sim.ts) (marble ground normal from scratch `[1..4)`, lines 359-391), [apps/field-notes/src/game/present.ts](../../apps/field-notes/src/game/present.ts) (camera arm that ignores the bounds walls, lines 94-105), [apps/rockfall/src/game/view/telegraph-view.ts](../../apps/rockfall/src/game/view/telegraph-view.ts) (landing-ring height under each falling rock, the rock excluded, lines 112-116).
