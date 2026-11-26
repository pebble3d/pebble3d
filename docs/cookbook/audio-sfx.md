# Audio and sound effects

Goal: sound cues driven by sim events, with no autoplay warnings and silent captures.

Every showcase game synthesises its sound with WebAudio (no audio files): one `AudioContext`, created on the first pointer or key press, a master gain, and one method per cue, fed from the sim's event queue after each tick.

```ts
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	constructor(readonly enabled: boolean) {
		if (!enabled) return;
		const unlock = (): void => {
			this.ctx ??= new AudioContext(); // only after a user gesture
			this.master = this.ctx.createGain();
			this.master.gain.value = 0.7;
			this.master.connect(this.ctx.destination);
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
		};
		window.addEventListener("pointerdown", unlock);
		window.addEventListener("keydown", unlock);
	}
	/** A short pitched blip; `gain` 0..1. */
	blip(freq: number, gain: number): void {
		const ctx = this.ctx, out = this.master;
		if (!ctx || !out) return; // not unlocked yet, or disabled
		const osc = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
		osc.frequency.value = freq;
		g.gain.setValueAtTime(gain, t);
		g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
		osc.connect(g).connect(out);
		osc.start(t);
		osc.stop(t + 0.16);
	}
}

const sfx = new Sfx(q.get("mute") !== "1" && mode !== "fixed");
// after sim.step(input): for each event of this tick, e.g. if (ev === EV.HIT) sfx.blip(220, 0.4);
```

| Gotcha | Detail |
| --- | --- |
| Never create the context at load | Chromium warns "The AudioContext was not allowed to start", and `pnpm shot` fails on any console warning. |
| Off in fixed mode | Captures and benches run with sound disabled (`mute || mode === "fixed"` in every game). |
| Sound is presentation | Play cues from the event queue after the tick; never let audio state feed back into the sim. |
| Rate-limit bursts | Cap voices per frame (Rockfall starts at most 4 impact sounds per rendered frame) or a rockslide clips. |
| Noise without `Math.random` | Fill noise buffers from a small LCG, as the games do, so nothing random appears near sim code. |
| Positional samples | `attachSound(object, listener, url)` from `@pebble3d/renderer` loads a file (cached) into a three.js `PositionalAudio` on an object; no showcase game uses it. |

See it in: [apps/rockfall/src/game/audio/sfx.ts](../../apps/rockfall/src/game/audio/sfx.ts) (gesture unlock, noise buffer, impact limit), [apps/chain-reaction/src/audio/sfx.ts](../../apps/chain-reaction/src/audio/sfx.ts), [apps/rockfall/src/main.ts](../../apps/rockfall/src/main.ts) (`sfx.handle(ev, sim)` per tick, line 377).
