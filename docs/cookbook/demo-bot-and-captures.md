# Demo bot and captures

Goal: a `?demo=1` autoplayer that plays the whole loop, and a script of reproducible screenshots driven by it.

```ts
/** `?demo=1` autoplayer. Reads only sim state and writes the same TickInput a player does. */
export class DemoBot {
	private t = 0;
	current = "start"; // what it is doing, exposed as a probe
	constructor(private readonly sim: MySim) {}

	next(out: TickInput): void {
		this.t++;
		out.buttons = 0;
		out.x = 0;
		out.z = 0;
		if (this.sim.phase === "title") {
			if (this.t > 90) out.buttons = BTN.START; // hold the title for 1.5 s
			this.current = "title";
			return;
		}
		const g = this.sim.nearestGoal(); // deterministic choice from sim state
		out.x = Math.round(Math.sign(g.x - this.sim.px) * 127);
		out.z = Math.round(Math.sign(g.z - this.sim.pz) * 127);
		this.current = "seek";
	}
}

// main.ts: one input source per tick, chosen once.
const bot = q.get("demo") === "1" ? new DemoBot(sim) : null;
// in the tick loop: if (bot) bot.next(input); else live.sample(input);
Object.assign(window.__pebble3d ?? {}, { game: { phase: () => sim.phase, bot: () => bot?.current ?? null } });
```

Capture script (`apps/<app>/bench/capture-final.sh`, after `apps/rockfall/bench/capture-final.sh`):

```bash
pnpm --filter my-game build >/dev/null
shot() { local name=$1; shift
	node scripts/shot/shot.mjs --app my-game --no-build --out artifacts/games/my-game --name "$name" "$@"; }
shot 01-title --ticks 240
shot 02-mid-run --ticks 1800 --param demo=1 --param seed=7
shot 03-loop --ticks 1200 --sequence 90:3 --scale 0.6 --no-frames --param demo=1 --param seed=7
```

| Gotcha | Detail |
| --- | --- |
| Same input type as a player | The bot must go through `TickInput`, never poke sim fields, so it tests the real path and its runs replay. |
| No randomness of its own | Draw from sim state or a seeded `Rng`. Then a capture at tick n is the same frame every run. |
| Fix the seed in fixed mode | Games default to a fixed seed when `mode=fixed` (Rockfall 7, Field Notes 23) and pass `--param seed=` explicitly in scripts. |
| Scout ticks headless | Run the same sim in Node, in the browser's tick order, until the event (a goal, the result screen) and note the engine tick: `for (t = 0; t < max && !done(); t++) { world.step(1); views.refresh(); bot.next(sim, input); sim.step(input); }` leaves `world.tick()` at the event tick for a `createGame` app. `--ticks n` captures right after engine tick n, so pass the event tick plus how long the result should be visible (e.g. +30 for 0.5 s). Pin it in a test (`expect(eventTick).toBe(...)`) so a rule change that moves it fails loudly. Loop setup: [getting-started.md](../getting-started.md#tests-in-node). |
| Read `mode` and `ticks` | Without them the shot never sees `__pebble3d.done` and times out. |
| Mute in fixed mode | Audio stays off for captures (see [audio-sfx.md](audio-sfx.md)). |
| Look at every PNG | Exit 0 only means no console errors. |

See it in: [apps/rockfall/src/game/bot.ts](../../apps/rockfall/src/game/bot.ts) (threat-scoring dodger), [apps/chain-reaction/src/demo.ts](../../apps/chain-reaction/src/demo.ts) (scripted placement then run), [apps/rockfall/bench/capture-final.sh](../../apps/rockfall/bench/capture-final.sh). Every game's bot: [verification.md](../verification.md#demo-bots).
