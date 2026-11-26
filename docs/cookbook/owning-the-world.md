# Owning the world

Goal: keep `createGame` for the renderer, the canvas and the automation hook, but run your game in physics worlds your code creates, steps, draws and throws away (a fresh world per round, a replay world beside the live one, a level editor's Play button).

`createGame` loads one wasm module and makes one `World` for the scene. Any number of extra worlds can come from that same module:

```ts
import type { Game } from "@pebble3d/sdk/game";
import { type SimHandle, StateViews } from "@pebble3d/sdk/sim";
import { expandScene } from "@pebble3d/sdk/expand";
import { parseScene } from "@pebble3d/sdk/schema";

type World = SimHandle["world"];

export function worldMaker(h: SimHandle): (seed: number, gravity: number) => World {
	const Ctor = h.world.constructor as new (seed: number, gravity: number) => World;
	return (seed, gravity) => new Ctor(seed, gravity);
}

export class Round {
	readonly world: World;
	readonly views: StateViews;
	readonly ids: Map<string, number>;
	tick = 0;

	constructor(game: Game, sceneJson: unknown) {
		const scene = parseScene(sceneJson);
		this.world = worldMaker(game.sim)(scene.sim.seed, scene.sim.gravity);
		this.ids = new Map();
		for (const e of expandScene(scene).sim)
			this.ids.set(e.sceneId, this.world.spawn(JSON.stringify(e.desc)));
		// StateViews only needs the world and the module's memory.
		this.views = new StateViews({ ...game.sim, world: this.world });
		this.world.step(1); // raycasts see nothing until the first step
		this.tick = 1;
		this.views.refresh();
	}

	step(): void {
		// rules that write forces / kinematic poses go here, then:
		this.world.step(1);
		this.tick++;
		this.views.refresh();
	}

	free(): void {
		this.world.free();
	}
}
```

## Step it from `onFrame`

`createGame` keeps stepping its own (now idle) world; your world advances only when you call `step()`. Run it on an accumulator fed by `onFrame`'s `dt`:

```ts
const DT = 1 / 60;
let acc = 0;
game.onFrame((dt) => {
	acc += dt;
	let n = 0;
	while (acc >= DT - 1e-9 && n < 5) {
		acc -= DT;
		round.step();
		n++;
	}
	if (n === 5) acc = 0; // drop the backlog instead of spiralling
	view.sync(round, Math.min(1, acc / DT)); // alpha for interpolation
});
```

In fixed mode `onFrame`'s `dt` is exactly `1/60` per frame and 0 once `stopAtTick` is reached, so this runs one tick per frame and stops with `createGame`'s world: `pnpm shot --ticks n` still captures your world at tick n (plus the step in the constructor, if you keep it).

## Draw its bodies

The renderer only draws `createGame`'s world: `renderer.sync` and `renderer.instances` read `game.views`, whose slots mean nothing for your world. Build your own meshes and place them from your views with `readSlot` (from `@pebble3d/renderer`), which interpolates and honours `NO_INTERP`:

```ts
import { primitiveGeometry, readSlot } from "@pebble3d/renderer";
import { Mesh, MeshStandardNodeMaterial, Quaternion, Vector3 } from "three/webgpu";

const _p = new Vector3();
const _q = new Quaternion();

export class RoundView {
	private readonly items: { mesh: Mesh; slot: number }[] = [];

	add(game: Game, round: Round, id: string, size: [number, number, number]): void {
		const mesh = new Mesh(primitiveGeometry("box", size), new MeshStandardNodeMaterial());
		mesh.castShadow = true;
		game.renderer.three.scene.add(mesh);
		const simId = round.ids.get(id) as number;
		this.items.push({ mesh, slot: round.world.slotOf(simId) });
	}

	sync(round: Round, alpha: number): void {
		const { prev, curr } = round.views;
		for (const it of this.items) {
			const on = it.slot >= 0 && readSlot(prev, curr, it.slot, alpha, _p, _q);
			it.mesh.visible = on; // false once the slot is freed
			if (on) {
				it.mesh.position.copy(_p);
				it.mesh.quaternion.copy(_q);
			}
		}
	}
}
```

`primitiveGeometry(primitive, size)` builds the same geometry the renderer uses for scene primitives, at the real size. For many identical bodies, one `InstancedMesh` you fill from the slots is cheaper than one mesh each.

## Report your world to automation

`pnpm shot` writes `__pebble3d.stateHash()` into the sidecar, and `createGame` installs it for **its** world. Point it at yours, or every capture reports the same idle hash:

```ts
Object.assign(window.__pebble3d ?? {}, {
	stateHash: () => round.world.stateHash(),
	game: { tick: () => round.tick },
});
```

| Gotcha | Detail |
| --- | --- |
| One memory for every world | All worlds from one module share one `WebAssembly.Memory`. A `spawn` in *any* world (createGame's included) can grow it, which detaches every `Float32Array` over the old buffer: views of other worlds read zeros (`byteLength` 0). Call `views.refresh()` after spawning or stepping, and read `views.curr` / `views.scratch` from the object each time instead of keeping the array in a local or a field. |
| Scratch after a query | Query results land in the shared scratch region. Read them right after the call, through `views.scratch` after a `refresh()` (cheap: it compares four numbers and returns). |
| Raycasts on a new world | A world that has never stepped has an empty query structure: every `raycast` returns false, even onto a static floor. Step once after spawning (as above) before probing. Bodies spawned later are likewise invisible to raycasts until the next step. |
| Free what you make | `world.free()` when a round ends; wasm memory is not garbage-collected. |
| Same seed, same order | Spawn order and seed decide the state hash; spawning from `expandScene(scene).sim` in order matches `createGame` and Node. |
| Keep the scene small | `createGame` still needs a valid scene: an environment and a camera preset are enough. Its world steps every frame, so leave dynamic bodies out of it. |
| The camera | The orbit controller is still on the canvas; see [custom-camera.md](custom-camera.md). |
| Node | The same `Round` class runs in a test with `loadSim("deterministic", bytes)` as the handle, so the browser and the verifier call one code path. |

See it in: [apps/pebble-garden/src/garden/sim.ts](../../apps/pebble-garden/src/garden/sim.ts) (worlds from the loaded module, lines 43-46; spawn from `expandScene` and views, lines 133-186; one tick, lines 221-237) with [apps/pebble-garden/src/view/garden-view.ts](../../apps/pebble-garden/src/view/garden-view.ts) (meshes from `primitiveGeometry`, placed with `readSlot`, lines 165-176), [apps/ringout/src/game/physics.ts](../../apps/ringout/src/game/physics.ts) (world factory and views that re-point after growth, lines 15-70), [apps/ringout/src/game/app.ts](../../apps/ringout/src/game/app.ts) (accumulator in `onFrame`, lines 491-503; alpha, lines 563-569), [apps/ringout/src/main.ts](../../apps/ringout/src/main.ts) (`stateHash` override, lines 95-99), [apps/pebble-garden/src/main.ts](../../apps/pebble-garden/src/main.ts) (lines 182-186), [apps/lanternfall/src/game/sim.ts](../../apps/lanternfall/src/game/sim.ts) (raycast work deferred to the first tick, lines 325-329).
