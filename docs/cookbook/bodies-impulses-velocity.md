# Bodies, impulses and velocity

Goal: push, launch, spin, move and spawn bodies from code, and read their position and velocity back, without allocating per frame.

```ts
import type { Game } from "@pebble3d/sdk/game";

const VEL = 12; // linearVelocity writes [vx, vy, vz] to scratch [12..15)

export function setup(game: Game) {
	const world = game.sim.world;
	const id = game.ids.get("crate");
	if (id === undefined) throw new Error('no "crate" in the scene');
	const slot = world.slotOf(id);

	world.applyImpulse(id, 0, 6, 0); // N·s: delta-v = impulse / mass
	world.applyTorqueImpulse(id, 0, 0.5, 0);

	// Spawn at runtime (EntityDescJson, camelCase). No visual is created for it.
	const rock = world.spawn(JSON.stringify({
		position: [0, 4, 0],
		body: { type: "dynamic", mass: 3, collider: { shape: "sphere", radius: 0.25 } },
	}));
	world.setVelocity(rock, 2, 0, 0, 0, 5, 0); // linear m/s, angular rad/s

	game.onFrame(() => {
		const v = game.views; // refreshed by createGame before onFrame
		const y = v.curr[slot * 8 + 1] as number;
		const asleep = ((v.curr[slot * 8 + 7] as number) & 2) !== 0;
		if (world.linearVelocity(id) && !asleep) {
			const vy = v.scratch[VEL + 1] as number;
			// fell off the world: snap back (NO_INTERP) with zero velocity
			if (y < -5 || vy < -30) world.teleport(id, 0, 2, 0);
		}
	});
}
```

| Gotcha | Detail |
| --- | --- |
| Body type matters | `applyImpulse`, `applyTorqueImpulse`, `setVelocity` work on dynamic bodies only; `setKinematicPose` on kinematic only. They return `false` otherwise. |
| Mass | Default is collider volume at density 1. Scale impulses by mass for a target speed: `m * (target - v)` (Chain Reaction springs). |
| Views go stale | `spawn` can grow wasm memory. Call `game.views.refresh()` after spawning, before reading `curr` or `scratch` in the same frame. |
| Spawned bodies are invisible | `world.spawn` creates physics only. Draw it with your own mesh read from its slot, or through `game.renderer.instances.add(key, geometry, material, slot)`. |
| Raycasts lag a tick | A body spawned this tick is not hit by raycasts until after the next `step`. |
| Free slots | `despawn(id)` frees the slot (flags read 0) and a later spawn may reuse it; drop your slot index too. |
| Determinism | Apply forces inside the tick (before `world.step`), from seeded values only, never from frame time. |

Full method list and return values: [api-reference.md](../api-reference.md#body-control).

See it in: [apps/chain-reaction/src/puzzle/sim.ts](../../apps/chain-reaction/src/puzzle/sim.ts) (spring and fan impulses, lines 217-260; velocity reads, lines 266-293), [apps/katana-defense/src/game/view/zombie-view.ts](../../apps/katana-defense/src/game/view/zombie-view.ts) (spawn a ragdoll capsule and `setVelocity`, lines 496-537), [apps/field-notes/src/main.ts](../../apps/field-notes/src/main.ts) (`teleport` on restart, lines 158-166).
