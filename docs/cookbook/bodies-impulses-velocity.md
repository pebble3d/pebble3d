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
| Torque is world-frame | `applyTorqueImpulse(id, tx, ty, tz)` takes a world-space angular impulse (N·m·s), not one in the body's local axes: the change in angular velocity is `I⁻¹ · τ` with the inertia tensor rotated to the body's current orientation. To spin about a body axis, rotate that axis into world space first (from the quaternion in `views.curr`). |
| Inertia follows the collider | The inertia tensor is the collider's shape at uniform density. With `mass` set, Rapier keeps the shape's tensor and scales it to that mass, so doubling `mass` halves the spin a torque impulse gives. A 2 x 1 x 0.5 m box of 1 kg yawed 90 degrees, given `applyTorqueImpulse(id, 1, 0, 0)`, spins at 2.4 rad/s (`1 / I_zz`, I_zz = m(2² + 1²)/12); at `mass: 10`, 0.24 rad/s. A sphere's inertia is the same about every axis (`0.4 m r²`), so its frame never matters. |
| Spheres roll forever | Rapier has no rolling resistance. A ball rolling on flat ground keeps its speed indefinitely with the default `angularDamping: 0` (a 0.5 m sphere set rolling at 3 m/s still does 3.0 m/s after 10 s). Give rolling bodies `"angularDamping"` (0.25 to 0.6 is typical; 0.5 brought that ball to 0.73 m/s after 10 s) and optionally a little `"linearDamping"`. Damping scales velocity by `1 / (1 + dt · damping)` each tick. |
| No contact events | The engine reports no collision or contact events. Detect hits in your rules after each `world.step`, from state you already read: the distance between two bodies dropping below the sum of their radii (and the closing speed along the line of centres), or a velocity change in one tick that gravity and your own impulses do not explain. Keep a per-pair "touching" flag so a contact fires once, not every tick. |
| Kinematic pose has no scale | `setKinematicPose` sets position and rotation only; a collider's size is fixed at spawn. To resize a body, `despawn` it and `spawn` a new one with the new collider (and resize its visual yourself); to make it vanish, `despawn` it. |
| Views go stale | `spawn` can grow wasm memory. Call `game.views.refresh()` after spawning, before reading `curr` or `scratch` in the same frame. |
| Spawned bodies are invisible | `world.spawn` creates physics only. Draw it with your own mesh read from its slot, or through `game.renderer.instances.add(key, geometry, material, slot)`. |
| Raycasts lag a tick | A body spawned this tick is not hit by raycasts until after the next `step`. |
| Free slots | `despawn(id)` frees the slot (flags read 0) and a later spawn may reuse it; drop your slot index too. |
| Determinism | Apply forces inside the tick (before `world.step`), from seeded values only, never from frame time. |

Full method list and return values: [api-reference.md](../api-reference.md#body-control).

See it in: [apps/chain-reaction/src/puzzle/sim.ts](../../apps/chain-reaction/src/puzzle/sim.ts) (spring and fan impulses, lines 217-260; velocity reads, lines 266-293), [apps/katana-defense/src/game/view/zombie-view.ts](../../apps/katana-defense/src/game/view/zombie-view.ts) (spawn a ragdoll capsule and `setVelocity`, lines 496-537), [apps/field-notes/src/main.ts](../../apps/field-notes/src/main.ts) (`teleport` on restart, lines 158-166), [apps/ringout/src/game/sim.ts](../../apps/ringout/src/game/sim.ts) (rolling torque about the travel axis, lines 210-212; impacts from distance and closing speed, lines 341-404), [apps/drift-drone/src/game/sim.ts](../../apps/drift-drone/src/game/sim.ts) (crashes from the velocity the drone would have had with no contact, lines 407-423 and 441-451), [apps/pebble-garden/src/garden/sim.ts](../../apps/pebble-garden/src/garden/sim.ts) (impact sounds from a one-tick velocity change, lines 240-263), [apps/pebble-garden/src/garden/pieces.ts](../../apps/pebble-garden/src/garden/pieces.ts) (a rolling pebble with `angularDamping`, lines 156-163).
