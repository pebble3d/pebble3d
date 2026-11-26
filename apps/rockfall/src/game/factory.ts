import type { SimHandle } from "@pebble3d/sdk/sim";
import type { WorldFactory } from "./sim.ts";

type WorldCtor = new (seed: number, gravityY: number) => SimHandle["world"];

/**
 * A `WorldFactory` over an already-loaded wasm build: every call constructs a fresh engine
 * `World` in the same module (same memory). The handle's own first world is freed on the
 * first call, so only the sim's current world is ever alive.
 */
export function worldFactory(base: SimHandle, gravity = -9.81): WorldFactory {
	const Ctor = base.world.constructor as WorldCtor;
	let baseAlive = true;
	return (seed) => {
		if (baseAlive) {
			base.world.free();
			baseAlive = false;
		}
		return { ...base, world: new Ctor(seed, gravity), seed };
	};
}
