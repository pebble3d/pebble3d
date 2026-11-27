---
name: complete-game-loop
description: Use when a Pebble3D game plays but has no beginning or end, at the complete-loop step of make-a-game, or before calling a game finished. Adds title, play, results and restart, pause, the HUD, a demo bot that plays the whole loop, a README with controls and sourced numbers, and captures of every screen.
---

# Complete game loop

A mechanic you can play forever with no start screen, no goal and no ending is a prototype. A game has a title that says what to do, a round that can be won or lost, a results screen that says how you did, and a key that starts again. This skill wraps the core play in that loop and documents it.

Template: Ringout (`apps/ringout`) has every piece here at small scale: title with seat setup, countdown, rounds, an instant replay, results, rematch, a bot and a capture script. Read [its README](../../../apps/ringout/README.md) and [app.ts](../../../apps/ringout/src/game/app.ts) first.

## The phases

```
title → play → (win | lose) → results → restart → play ...
```

- **Phases are sim state.** Keep the phase in the sim and change it with a pure transition function, like Ronin Outpost's `nextPhase` in [phase.ts](../../../apps/katana-defense/src/game/phase.ts): title, pre-wave, wave, wave clear, upgrade, victory, game over. A test can then drive the whole loop in Node, and the phase feeds the determinism hash.
- **Every play phase has an end.** A win condition and a lose condition from the brief, and if the game could stall, a limit (Ringout ends a round as a draw after a fight-tick limit, `MAX_FIGHT_TICKS` in [constants.ts](../../../apps/ringout/src/game/constants.ts)).
- **Restart resets everything.** Score, timers, entities, the camera, the HUD and the seeded RNG (from a new or the same seed, as the brief says). A restart that leaks state from the last round is the most common loop bug: test it by playing two rounds in a row in Node and comparing the second round's hash with a fresh first round on the same seed.

## Title screen

- The game's name, one line on the goal, the controls in brief, and "press Enter" (or click). The brief's look applies here too: this is the first frame anyone sees.
- Put something alive behind it: a slow camera orbit over the arena (Ronin Outpost and Ringout both do), or an attract round played by the bot. Leave room on one side for the text.
- Any setup (players, difficulty, match length) lives here with keyboard shortcuts, as on Ringout's title.
- A `?title=1` style param that stays on the title helps the capture script.

## Play and the HUD

- The HUD shows only what the player needs to decide: the score or progress toward the goal, health or lives, a timer if time matters, and the state of the core verb (a cooldown, a meter, ammo). Ringout's HUD is a DOM overlay ([ui/hud.ts](../../../apps/ringout/src/game/ui/hud.ts)); its look follows [art-direction](../art-direction/SKILL.md).
- Announce phase changes on screen: the round banner, "Wave clear", a countdown to the next hazard. A toast for big events (a knock-out, a new best).
- Show the controls somewhere on first play: a hint bar along the bottom, or the title.
- A `hud=0` param hides it for clean captures.

## Pause

- Esc (or P) pauses: stop stepping the sim, freeze presentation time, mute or duck sound, and show a small panel with resume, restart and quit to title. In a one-screen local game, Esc may simply return to the title, as Ringout does.
- Pause when the tab is hidden too, so time does not pile up: Breakpoint listens for `visibilitychange` ([main.ts](../../../apps/breakpoint/src/main.ts)). Clear held keys on window blur, or the player keeps running after alt-tab.
- Pause is not sim input in a replayable game: it stops ticks, it is not recorded as a tick.

## Results and restart

- Say who won or what the outcome was, in big type, then the numbers that matter for this game: score, time, best, per-player stats (Ringout shows wins, knock-outs, dashes and the hardest hit per seat). Show a personal best if the brief wants replay value.
- One key restarts, one returns to the title. Name both on the screen.
- **Lock confirm keys briefly** when a results or replay screen appears, so a player still mashing the action key does not skip it. Ringout's `MenuGate` swallows Enter and Space for `LOCK = 0.75` s ([gate.ts](../../../apps/ringout/src/game/gate.ts)).
- Optional but strong: an instant replay of the decisive moment before results, re-simulated from the input log, as Ringout and Breakpoint do.

## The demo bot plays the whole loop

`?demo=1` drives everything through the same input type a player produces: it presses start on the title, plays the round to a win or a loss, waits on results, and restarts. Expose `phase` and the bot's current action as `__pebble3d.game` probes so captures and sidecars show where it is. The pattern: [demo-bot-and-captures.md](../../../docs/cookbook/demo-bot-and-captures.md). Pin the ticks of the loop's key moments (first win, results, restart) in a test so a rule change that moves them fails loudly.

**The bot must finish the loop on most seeds, not just one.** A bot that loses or stalls on most seeds makes every capture of results, replay and restart luck. Write a Node test that runs the bot headless over a range of seeds, counts the runs that reach the results phase within a tick limit, and asserts that share is a clear majority. A sketch, with your own sim and bot names:

```ts
it("the demo bot reaches results on most seeds", () => {
	let reached = 0;
	const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
	for (const seed of seeds) {
		const sim = makeSim(seed);
		const bot = makeBot(sim);
		while (sim.phase !== "results" && sim.tick < MAX_TICKS) sim.step(bot.next());
		if (sim.phase === "results") reached++;
		sim.free();
	}
	expect(reached / seeds.length).toBeGreaterThanOrEqual(0.8);
});
```

If it fails, tune the bot (its aim, timing, which threat it picks), not the game: the rules and numbers in the brief are the player's game, and weakening them so the bot wins changes what you ship. Where the brief wants the bot to show a loss too, assert that separately on a fixed seed.

## README

`apps/<name>/README.md`, with the sections of [Ringout's README](../../../apps/ringout/README.md):

1. **What it is**: the pitch in a paragraph, with the game's key numbers.
2. **Run it**: the install, dev and test commands with the URL, then a table of every URL param the game reads (`demo`, `seed`, `mode`, `ticks`, `backend`, `hud`, `mute`, and the game's own).
3. **Controls**: a table of every input, per screen. Check each line against the input code; a control the README invents is a bug.
4. **What it shows off**: the engine features it exercises, each in a sentence.
5. **Known issues**: what is rough, honestly.

**Every number is sourced.** Each number in the README comes from a constant in the code, a test, or a measurement you ran (say how: backend, machine, idle GPU). Ringout's "61 hexagonal basalt columns in 5 rings" is `RINGS = 5` in [constants.ts](../../../apps/ringout/src/game/constants.ts). Do not round up, guess fps, or keep a number after the constant changes.

## Captures

`apps/<name>/bench/capture-final.sh`, after [Ringout's](../../../apps/ringout/bench/capture-final.sh): build once, then one shot per moment with `--param demo=1` and a fixed seed, stopping on the first failure. Cover at least the title, mid-play, the big moment, a win or a loss, the results screen and one `--sequence` of the core action. Run it, read every sidecar and open every PNG the shot prints, as [verify-your-work](../verify-your-work/SKILL.md) says.

Putting the game on the project site is a separate step, only when the developer asks: [site/README.md](../../../site/README.md) lists the entry, the WebP conversion and the claim checks.

## Exit check

- Title → play → win or lose → results → restart works by keyboard, and by the `?demo=1` bot with no human input.
- The bot test passes: over a range of seeds, a clear majority of `?demo=1` runs reach results.
- Pause, tab-hide and Esc behave; restart leaves no state from the last round (tested in Node).
- The HUD shows what the player needs, and hides with `hud=0`.
- The README lists how to run it, the controls and every URL param, and every number in it has a source.
- The capture script covers every screen, and you opened every capture.

Next: [verify-your-work](../verify-your-work/SKILL.md), the full check.
