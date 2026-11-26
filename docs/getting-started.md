# Getting started

From nothing to a JSON scene in the playground, then to a minimal game app with a fixed-tick sim, a `?demo=1` bot and `window.__pebble3d` probes.

## 0. Set up once

```bash
pnpm i && pnpm build:wasm && pnpm fetch-assets
```

`pnpm build:wasm` needs Rust with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.130. If `packages/sdk/wasm/det/` and `packages/sdk/wasm/fast/` already hold `engine_core_*_bg.wasm` from the current Rust source, you can skip it. `pnpm fetch-assets` is only needed for the HDRI, splats and avatars; the studio preset below needs none of them.

## 1. A scene

Save this as `apps/playground/scenes/mine.json`:

```json
{
	"version": 1,
	"environment": { "preset": "studio", "ground": {} },
	"entities": [{ "id": "ball", "mesh": { "primitive": "sphere" }, "body": { "restitution": 0.5 }, "transform": { "position": [0, 4, 0] } }]
}
```

| Piece | Meaning |
| --- | --- |
| `"version": 1` | Required schema version. |
| `"preset": "studio"` | Neutral grey backdrop and lights; no assets needed. `"outdoor"` uses an HDRI. |
| `"ground": {}` | A static ground plane with a collider at y = 0. |
| `mesh` + `body` | A rendered sphere (diameter 1 m) with a dynamic Rapier body; the collider is fitted to the primitive. |

Every field, type and default: [scene-reference.md](scene-reference.md). JSON Schema for editor validation: `packages/sdk/scene.schema.json` (set `"$schema"` to its path).

## 2. Run it in the playground

```bash
pnpm dev                                   # Vite on port 5173
# open http://localhost:5173/?scene=mine
pnpm shot --scene mine --ticks 30          # headless: artifacts/shots/mine-default-webgpu-1280x720.png
```

Useful URL params (`apps/playground/src/main.ts`): `mode=fixed&ticks=<n>` stops at a tick, `backend=webgl`, `cam=<preset>`, `overlay`. Backtick toggles the stats overlay. On Linux, Chromium needs `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan` for WebGPU.

## 3. A minimal game app

The pattern from `apps/chain-reaction/src/main.ts`: `createGame` loads the scene, the wasm and the renderer and steps physics; your code adds rules in `game.onFrame`. This example (a ball you kick with Space) was built and captured with `pnpm shot --app hello-ball --param demo=1 --ticks 300` (exit 0, empty console, `kicks: 3` in the sidecar).

### Files

```text
apps/hello-ball/
  package.json
  index.html
  vite.config.ts     copy apps/rockfall/vite.config.ts unchanged
  tsconfig.json      copy apps/rockfall/tsconfig.json unchanged (it already includes test/ and vitest.config.ts)
  vitest.config.ts   the app's vitest project (see "Tests in Node" below)
  scenes/court.json
  src/main.ts
  src/sim.ts
  test/sim.test.ts
```

`vite.config.ts` must be copied: it serves the Basis transcoder at `/basis/`, points `publicDir` at `../playground/public` (shared assets, `favicon.svg`) and lets Vite serve the wasm from `packages/sdk/wasm/`. Scenes and code keep asset paths root-absolute (`/assets/...`); to deploy under a sub-path, build with `vite build --base /some/path/` and the renderer prefixes them ([cookbook/sub-path-hosting.md](cookbook/sub-path-hosting.md)). After creating the folder, run `pnpm i` so pnpm links the workspace packages (in a sandbox without network, `pnpm i --offline` works once the store has every package).

New-app checklist: `package.json`, `index.html`, copied `vite.config.ts` and `tsconfig.json`, your own `vitest.config.ts` **plus an `"apps/<name>"` line in the root `vitest.config.ts` `projects` list** (without it vitest never runs the app's tests), then `pnpm i`.

### package.json

```json
{
	"name": "hello-ball",
	"private": true,
	"type": "module",
	"scripts": {
		"dev": "vite --port 5260",
		"build": "vite build",
		"test": "vitest run",
		"typecheck": "tsc -p tsconfig.json --noEmit"
	},
	"dependencies": {
		"@pebble3d/renderer": "workspace:*",
		"@pebble3d/sdk": "workspace:*",
		"three": "0.187.0"
	},
	"devDependencies": {
		"vite": "^8.3.8",
		"vitest": "^5.1.1"
	}
}
```

### index.html

The favicon link matters: without it the browser requests `/favicon.ico`, gets a 404, and `pnpm shot` fails on that console error.

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
		<title>Hello Ball</title>
		<style>
			html, body { margin: 0; height: 100%; overflow: hidden; }
			#app { display: block; width: 100vw; height: 100vh; }
		</style>
	</head>
	<body>
		<canvas id="app"></canvas>
		<script type="module" src="/src/main.ts"></script>
	</body>
</html>
```

### scenes/court.json

```json
{
	"version": 1,
	"environment": { "preset": "studio", "ground": {} },
	"camera": { "presets": { "hero": { "position": [0, 3, 8], "target": [0, 1, 0] } } },
	"entities": [
		{
			"id": "ball",
			"mesh": { "primitive": "sphere", "material": { "color": "#e8553a" } },
			"body": { "restitution": 0.6 },
			"transform": { "position": [0, 3, 0] }
		}
	]
}
```

### src/sim.ts: the fixed-tick sim and the demo bot

Rules run once per 60 Hz engine tick and touch the world only through the wasm `World` ([api-reference.md](api-reference.md)). The sim takes only the three `Game` members it uses (`sim`, `views`, `ids`), so a Node test can hand it the same three built without a browser. State is read from `game.views.curr` (8 floats per slot: `px, py, pz, qx, qy, qz, qw, flags`) and query results from `game.views.scratch`. Bigger sims in the repo: `apps/rockfall/src/game/sim.ts`, `apps/chain-reaction/src/puzzle/sim.ts`.

```ts
import type { Game } from "@pebble3d/sdk/game";

/** What the sim needs from a game: `createGame`'s result in the browser, or the same three fields built in Node. */
export type SimHost = Pick<Game, "sim" | "views" | "ids">;

/** Scratch slots `linearVelocity` writes: [vx, vy, vz] at [12..15). */
const VEL = 12;

export interface TickInput {
	kick: boolean;
}

/**
 * Game rules, advanced once per engine tick. No DOM, no Math.random, no Date:
 * the same inputs on the same ticks give the same state hash.
 */
export class BallSim {
	tick = 0;
	kicks = 0;
	private readonly ballId: number;
	private readonly slot: number;

	constructor(private readonly game: SimHost) {
		const id = game.ids.get("ball");
		if (id === undefined) throw new Error('scene has no "ball" entity');
		this.ballId = id;
		this.slot = game.sim.world.slotOf(id);
	}

	/** Ball height from the current state buffer (slot stride 8: px, py, pz, qx..qw, flags). */
	ballY(): number {
		return this.game.views.curr[this.slot * 8 + 1] as number;
	}

	/** Ball vertical speed, read through the scratch buffer. */
	ballVy(): number {
		const world = this.game.sim.world;
		return world.linearVelocity(this.ballId)
			? (this.game.views.scratch[VEL + 1] as number)
			: 0;
	}

	step(input: TickInput): void {
		this.tick++;
		if (input.kick) {
			this.game.sim.world.applyImpulse(this.ballId, 0, 3, 0);
			this.kicks++;
		}
	}
}

/** `?demo=1` autoplayer: kicks whenever the ball is resting on the ground. */
export class DemoBot {
	next(sim: BallSim, out: TickInput): void {
		out.kick = sim.ballY() < 0.6 && Math.abs(sim.ballVy()) < 0.05;
	}
}
```

### src/main.ts: boot, input, probes

```ts
import { createGame } from "@pebble3d/sdk/game";
import type { SceneInput } from "@pebble3d/sdk/schema";
import detWasmUrl from "../../../packages/sdk/wasm/det/engine_core_det_bg.wasm?url";
import fastWasmUrl from "../../../packages/sdk/wasm/fast/engine_core_fast_bg.wasm?url";
import sceneJson from "../scenes/court.json";
import { BallSim, DemoBot, type TickInput } from "./sim.ts";

async function main(): Promise<void> {
	const canvas = document.getElementById("app");
	if (!(canvas instanceof HTMLCanvasElement))
		throw new Error("#app canvas missing");
	const q = new URLSearchParams(location.search);
	const mode = q.get("mode") === "fixed" ? "fixed" : "realtime";
	const ticks = q.get("ticks");

	const game = await createGame({
		canvas,
		scene: sceneJson as unknown as SceneInput, // JSON imports widen tuples; createGame validates at runtime
		mode,
		backend: q.get("backend") === "webgl" ? "webgl" : "webgpu",
		wasmUrls: { deterministic: detWasmUrl, fast: fastWasmUrl },
		...(ticks !== null ? { stopAtTick: Number(ticks) } : {}),
	});
	game.setCamera(q.get("cam") ?? "hero");

	const sim = new BallSim(game);
	const bot = q.get("demo") === "1" ? new DemoBot() : null;
	const input: TickInput = { kick: false };
	let spaceHeld = false;
	window.addEventListener("keydown", (e) => {
		if (e.code === "Space") spaceHeld = true;
	});
	window.addEventListener("keyup", (e) => {
		if (e.code === "Space") spaceHeld = false;
	});

	// createGame steps the physics world; run one rules tick per engine tick it advanced.
	game.onFrame(() => {
		const world = game.sim.world;
		while (sim.tick < world.tick()) {
			if (bot) bot.next(sim, input);
			else input.kick = spaceHeld;
			sim.step(input);
		}
	});

	// Extra probes for automation: pnpm shot copies `game` into its .json sidecar.
	Object.assign(window.__pebble3d ?? {}, {
		game: { kicks: () => sim.kicks, ballY: () => sim.ballY() },
	});
	game.start();
}

main().catch((e: unknown) => {
	const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
	window.__pebble3d = {
		...window.__pebble3d,
		ready: false,
		done: false,
		error: msg,
	};
	console.error(msg);
});
```

### What each part does

| Piece | Why |
| --- | --- |
| `wasmUrls` with `?url` imports | Vite serves both `_bg.wasm` builds; the scene's `sim.build` (default `"deterministic"`) picks one. |
| `mode`, `stopAtTick` | `pnpm shot` opens the page with `?mode=fixed&ticks=<n>`: one tick per frame, and `__pebble3d.done` turns true at tick n. Read both params or captures time out. |
| `game.onFrame(cb)` | Runs every frame after physics and `renderer.sync`, before `renderer.render`. In fixed mode `dt` is `ticks / 60`. |
| `while (sim.tick < world.tick())` | Keeps rules in step with the engine tick. In fixed mode that is exactly one rules tick per physics tick, so captures repeat. In realtime a frame can advance 2+ ticks; if inputs must replay bit-exactly there too, own the loop as `apps/rockfall/src/main.ts` does (`FixedStepLoop`, then `sim.step(input)` once per tick). |
| `?demo=1` bot | Produces the same `TickInput` a player would; every showcase game has one (see [verification.md](verification.md)). |
| `window.__pebble3d` | `createGame` installs `ready`, `done`, `tick`, `stats()`, `stateHash()`, `setCamera()`, `player()`, `position()`. Add a `game` object of zero-argument functions; `pnpm shot` records their values. |
| `main().catch` | Puts the error on `__pebble3d.error` so automation reports it instead of timing out. |

### Tick order

With `createGame` in fixed mode (one tick per frame, as in `pnpm shot`), each engine tick is **physics first, then rules** (in realtime mode `createGame` may step several physics ticks before calling `onFrame` once): `createGame` calls `world.step`, then your `onFrame` runs `sim.step(input)`, whose impulses take effect in the *next* `world.step`. So after tick n the world has stepped n times and the rules have run n times, each seeing the world after its own step. A headless run that must reproduce the browser's `stateHash` (and `pnpm shot`'s sidecar) mirrors that order exactly:

```ts
for (let t = 0; t < n; t++) {
	world.step(1);   // what createGame does
	views.refresh(); // what createGame does before onFrame
	bot.next(sim, input);
	sim.step(input); // what your onFrame does
}
```

Running rules *before* `world.step` instead (`sim.step(input); world.step(1)`) puts rules call k after step k-1 instead of after step k: anything keyed to the rules' own tick counter (a bot that presses Start at `sim.tick === 90`, a countdown, a spawn schedule) lands one physics tick earlier, and an input on the very last call is never stepped. In hello-ball, a kick keyed to `sim.tick === 90` gives different state hashes at tick 120 under the two orders (they reconverge only once the ball is at rest). Rules that react only to world state, like `DemoBot` above, can happen to match; do not rely on it. The other repo pattern, where the sim owns its world and calls `world.step(1)` at the end of its own `step()` ([cookbook/deterministic-game-loop.md](cookbook/deterministic-game-loop.md)), is rules-then-physics; it is equally valid because the browser and Node then call the same `sim.step` and nothing else steps the world. The rule is: one code path decides the order, and the headless verifier calls that path, never a re-implementation of it.

### Tests in Node

vitest only runs projects listed in the root `vitest.config.ts`. Two edits register a new app:

1. `apps/hello-ball/vitest.config.ts` (copied from `apps/rockfall/vitest.config.ts`; `name` is what `--project` matches):

```ts
import { defineProject } from "vitest/config";

export default defineProject({
	test: { name: "hello-ball", include: ["test/**/*.test.ts"], testTimeout: 60_000 },
});
```

2. Add `"apps/hello-ball"` to the `projects` array in the root `vitest.config.ts`, next to the other apps.

Without step 2, `npx vitest run --project hello-ball` fails with `No projects were found ... The filter matched no projects: hello-ball`, and `npx vitest run apps/hello-ball/test` prints `No test files found, exiting with code 0`: a silent pass that ran nothing.

`test/sim.test.ts` runs the real deterministic wasm in Node, spawns the scene the way `createGame` does and drives the sim in the browser's tick order:

```ts
import { readFileSync } from "node:fs";
import { expandScene } from "@pebble3d/sdk/expand";
import { parseScene } from "@pebble3d/sdk/schema";
import { loadSim, StateViews } from "@pebble3d/sdk/sim";
import { expect, it } from "vitest";
import courtJson from "../scenes/court.json";
import { BallSim, DemoBot, type TickInput } from "../src/sim.ts";

const wasm = readFileSync(new URL("../../../packages/sdk/wasm/det/engine_core_det_bg.wasm", import.meta.url));

it("the demo bot kicks the ball", async () => {
	const scene = parseScene(courtJson);
	const handle = await loadSim("deterministic", wasm, { seed: scene.sim.seed, gravity: scene.sim.gravity });
	const ids = handle.spawnScene(expandScene(scene).sim); // sceneId -> sim id, "__ground" included
	const views = new StateViews(handle);
	const sim = new BallSim({ sim: handle, views, ids });
	const bot = new DemoBot();
	const input: TickInput = { kick: false };
	for (let t = 0; t < 300; t++) {
		handle.world.step(1);
		views.refresh();
		bot.next(sim, input);
		sim.step(input);
	}
	expect(sim.kicks).toBeGreaterThan(0);
	handle.world.free();
});
```

```bash
npx vitest run --project hello-ball
```

More on headless spawning and reading state: [cookbook/json-levels-and-headless-verify.md](cookbook/json-levels-and-headless-verify.md#spawn-a-scene-and-read-state-in-node).

### Run and check it

```bash
pnpm --filter hello-ball dev    # http://localhost:5260 (Space kicks) or /?demo=1 (the bot plays)
pnpm shot --app hello-ball --param demo=1 --ticks 300 --out artifacts/hello --name demo
```

The shot must exit 0. Open `artifacts/hello/demo.png` and check `artifacts/hello/demo.json`: `game.kicks` above 0, the same `stateHash` on every run. That `stateHash` equals `handle.world.stateHash()` after the same number of ticks of the Node loop above.

Choosing `--ticks`: `--ticks n` captures right after engine tick n (fixed mode, one tick per frame), which is iteration n of the Node loop. To capture a moment (a goal, a result screen), run the loop in a test until the condition holds, note `t + 1`, and pass that plus a margin for anything you want visible after it, e.g. 30 ticks (0.5 s). See [cookbook/demo-bot-and-captures.md](cookbook/demo-bot-and-captures.md).

## Next

- [verification.md](verification.md): shots, determinism, benches.
- [troubleshooting.md](troubleshooting.md): when something fails.
- [api-reference.md](api-reference.md): every `createGame` option, `Game` member and `World` method.
- Next steps most games need: [cookbook/custom-camera.md](cookbook/custom-camera.md) (your own camera), [cookbook/owning-the-world.md](cookbook/owning-the-world.md) (worlds you create per round), [cookbook/sub-path-hosting.md](cookbook/sub-path-hosting.md) (deploying under a sub-path).
- Real games to copy from: `apps/chain-reaction` (createGame plus its own worlds), `apps/rockfall` (custom boot, spawners, 1,800 bodies).
