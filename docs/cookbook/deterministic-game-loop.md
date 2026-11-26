# Deterministic game loop: input log, replay, ghosts

Goal: game rules that advance once per 60 Hz tick from a logged input, so a run replays bit-exactly, can be verified headless, and can race a ghost.

The pattern of Ghostline, Chain Reaction and Breakpoint: the game sim owns its `World`s and steps them itself, and `createGame` only renders. (Rockfall does the same without `createGame`; Ronin Outpost's sim is plain JS with the same loop.) The sim reads one input record per tick and nothing else: no DOM, no `Math.random`, no `Date`, no frame time.

```ts
import type { SimHandle } from "@pebble3d/sdk/sim";
import { InputLog, type TickInput } from "./input.ts"; // copy apps/ghostline/src/game/input.ts
type World = SimHandle["world"];
const DT = 1 / 60;
class MySim {
	tick = 0;
	readonly world: World;
	constructor(host: { create(seed: number, g: number): World }, readonly seed: number) {
		this.world = host.create(seed, -9.81); // spawn bodies here, from seeded values only
	}
	step(i: TickInput): void { /* apply i to bodies */ this.world.step(1); this.tick++; }
	hash(): string { return this.world.stateHash(); } // 16 hex chars
	free(): void { this.world.free(); } // every World holds wasm memory
}

// More worlds from the module createGame loaded (apps/ghostline/src/game/physics.ts).
const Ctor = game.sim.world.constructor as new (seed: number, g: number) => World;
const host = { create: (s: number, g: number) => new Ctor(s, g) };
const sim = new MySim(host, seed);
const ghost = best ? new MySim(host, best.seed) : null; // best: { seed, log: InputLog, hash }
const log = new InputLog(); // 3 bytes per tick, grows by doubling
const input: TickInput = { x: 0, z: 0, buttons: 0 }, ghostInput = { ...input }; // x, z: int8
let acc = 0;
game.onFrame((dt) => {
	acc += dt;
	let n = 0;
	for (; acc >= DT - 1e-9 && n < 5; n++) {
		acc -= DT;
		sampleInto(input); // live input or bot.next(input): the same type
		log.push(input);
		sim.step(input);
		if (ghost && ghost.tick < best.log.length) ghost.step(best.log.read(ghost.tick, ghostInput));
	}
	if (n === 5) acc = 0; // fell behind: drop time instead of spiralling
	present(Math.min(1, acc / DT)); // interpolate visuals between ticks
});

/** Replay = a fresh world, the same seed, the same inputs; then compare hashes. */
function verify(seed: number, l: InputLog, expected: string): boolean {
	const s = new MySim(host, seed);
	try { for (let t = 0; t < l.length; t++) s.step(l.read(t, ghostInput)); return s.hash() === expected; }
	finally { s.free(); }
}
```

| Gotcha | Detail |
| --- | --- |
| Tick order | Here the sim owns the world: `step()` applies the input, then calls `world.step(1)` (rules, then physics), and nothing else steps that world. `verify` and any Node test call the same `step()`, so the order matches by construction. This differs from the `createGame`-steps-physics pattern in [getting-started.md](../getting-started.md#tick-order) (physics, then rules in `onFrame`); a headless verifier must copy whichever order the browser path uses, ideally by calling the same function. Do not mix them: a sim that calls `world.step` itself must run on its own world, not on `game.sim.world`, which `createGame` already steps. |
| Quantise before logging | Store int8 axes (`Math.round(v * 127)`) and feed the sim the same quantised value live and in replay; a float that differs in the last bit diverges. |
| Ghosts re-simulate | A ghost is a second world fed the logged inputs in lockstep, not recorded positions. Fingerprint the course and rules into the record and discard stale ones. |
| One hash per run | Save `{ seed, inputs, hash }`; `verify` proves the run. Mix game state into it (score, hp) to catch rule drift. `free()` every world on restart. In fixed mode `dt` is exactly 1/60, so one tick runs per frame. |
| The `deterministic` build | Bit-identical across runs and between Node and Chromium; `fast` only for the same binary on the same machine. Your own JS math (`Math.sin`...) can still differ between JS engines: Ghostline reports a diverged ghost instead of trusting it. |

See it in: [apps/ghostline/src/game/ghost.ts](../../apps/ghostline/src/game/ghost.ts) (ghost record, re-simulation and `verifyRecord`, lines 136-212), [apps/ghostline/src/game/app.ts](../../apps/ghostline/src/game/app.ts) (live run and ghost per tick, lines 463-477; accumulator, lines 559-577), [apps/ghostline/src/game/input.ts](../../apps/ghostline/src/game/input.ts) (int8 `InputLog`, three bytes per tick, serialised as run-length encoded base64), [apps/rockfall/src/game/input.ts](../../apps/rockfall/src/game/input.ts), [apps/rockfall/src/game/rng.ts](../../apps/rockfall/src/game/rng.ts) (seeded mulberry32), [apps/breakpoint/src/game/replay.ts](../../apps/breakpoint/src/game/replay.ts) (instant replay by re-simulation). Testing it: [verification.md](../verification.md#determinism).
