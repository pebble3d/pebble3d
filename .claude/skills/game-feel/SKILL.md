---
name: game-feel
description: Use when a Pebble3D game's core actions work but feel flat, at the game-feel step of make-a-game, or when a hit, jump, dash or win needs more impact. Layers hit-stop, shake, camera punch, trails, particles, decals, buffering, easing and sound, then tunes them by watching capture sequences.
---

# Game feel

A game whose mechanics work is a tech demo. A game where every press gets an answer you can see and hear, and the big moments land with weight, is a game. This skill is the polish half of the build: it comes after the core verbs work and before the art pass.

The values to start from, with the demo file that uses each one, are in [techniques.md](techniques.md). Ronin Outpost (`apps/katana-defense`) is the densest reference: read [present.ts](../../../apps/katana-defense/src/game/present.ts), where every sim event becomes feedback.

## The process

1. **Pick the moments.** From the brief, choose the three to five moments that matter most: the hit, the jump, the kill, getting hurt, the win. Write them in `BRIEF.md` under a "feel" heading. Polish these deeply; everything else gets a basic cue.
2. **Give every action an answer.** Before layering, check that every input the player can make produces a visible change and a sound within a tick or two. Missing feedback is the most common reason a game feels broken.
3. **Layer each big moment.** Build the stack below, one layer at a time, capturing after each.
4. **Tune by watching** (the loop at the end). Feel lives in motion; a single frame cannot show it.

## The layers

Not every moment needs every layer. A heavy hit takes the full stack; a footstep takes a puff and a tick of sound.

| Layer             | What it does                                                           | Lives in     |
| ----------------- | ---------------------------------------------------------------------- | ------------ |
| Hit-stop          | Freezes both sides for a few frames on contact, so the hit reads solid | sim          |
| Impact frame      | One to three frames of high-contrast flash on the heaviest hits        | presentation |
| Screen shake      | Trauma that decays; the offset is trauma squared                       | presentation |
| Camera punch      | The lens narrows by a few degrees and springs back                     | presentation |
| Slow motion       | Game time drops for the one decisive moment, then eases back           | presentation |
| Trails            | A tapering ribbon behind the striking edge or a fast body              | presentation |
| Particles         | Sparks, chunks and dust that arc with gravity and land                 | presentation |
| Persistent decals | Pools, cracks and rings that stay on the floor after the action        | presentation |
| Telegraphs        | Enemy wind-ups drawn on the ground before the hit                      | presentation |
| Input buffering   | A press slightly early still counts; cancel windows chain moves        | sim          |
| Easing            | Wind-up, strike, follow-through; exponential approach for cameras      | both         |
| Sound             | A cue per action and per hit, scaled by weight                         | presentation |

**A heavy hit reads best as a stack**, in this order on the timeline: the hit-stop freeze, an impact frame, screen shake starting as the freeze ends, a brief camera punch-in, a tapering trail on the striking limb that hangs during the freeze, particles that burst and arc with gravity, and decals that stay on the floor after the particles land. Each layer alone is subtle. Together they sell weight.

**Scale by weight.** Light, heavy and finisher hits should differ on every layer: Ronin Outpost's light cuts freeze for fewer frames, shake less and do not punch the camera at all. If everything is maximal, nothing is.

**Keep the sim deterministic.** Hit-stop and buffering change gameplay, so they are sim state driven by ticks. Everything else reads the sim's events after the tick and never writes back. No `Math.random` in either: spread particles with offsets from the loop index, and shake with sums of sines.

## Input feel

- Buffer presses for a few frames and let a press just after a move ends still chain ([combo.ts](../../../apps/katana-defense/src/game/combat/combo.ts)). Presses during hit-stop are buffered too.
- Give moves cancel windows so the follow-up starts the moment the current move's commitment ends.
- For movement: allow a jump pressed just before landing and just after leaving a ledge. Never drop a tap shorter than one tick ([live-input.ts](../../../apps/skyrun/src/game/live-input.ts)).
- Camera and character followers ease with `1 - Math.exp(-k * dt)`, never a fixed lerp per frame. Recipes: [custom-camera.md](../../../docs/cookbook/custom-camera.md).

## Sound

Every action and every hit gets a WebAudio cue fired from the event queue after the tick, louder and lower for heavier events. Unlock the context on the first gesture, cap voices per frame, and keep sound off in fixed mode. The pattern and its gotchas: [audio-sfx.md](../../../docs/cookbook/audio-sfx.md).

## Budget

Effects cost fill rate, and layered additive effects can cost several times more on the WebGL backend than on WebGPU. Pool every effect (one preallocated `InstancedMesh` per kind, oldest recycled), cap counts, and measure fps on both backends with the effects on screen, as [verify-your-work](../verify-your-work/SKILL.md) describes, before adding more.

## Tune by watching captures

Stills can look great while the motion is stiff. Judge feel in a sequence:

```bash
pnpm shot --app <name> --param demo=1 --ticks <just before the moment> --sequence 90:2 --scale 0.6 --no-frames --name feel-hit
```

`--sequence` writes an animated WebP of the moment (flags: [docs/verification.md](../../../docs/verification.md); a real script with sequences: [capture-final.sh](../../../apps/ringout/bench/capture-final.sh)). Find the tick of the moment by scouting it headless ([demo-bot-and-captures.md](../../../docs/cookbook/demo-bot-and-captures.md)). Then loop:

1. Watch the sequence. For each chosen moment, name what is missing or too much: "the hit has no freeze", "the shake hides the target", "the sparks vanish in place".
2. Change one value, recapture the same tick with the same seed, and compare.
3. Stop when each moment reads at a glance in the sequence and a still from the middle of it still shows what happened (trail, particles in the air, a mark on the floor).

## Exit check

- Every player action has a visible and an audible answer.
- Each chosen moment has its layer stack, scaled by weight, and a `--sequence` capture that you watched shows it.
- Sim tests still pass and the determinism test still holds (feel code did not leak randomness or presentation state into the sim).
- The effects are pooled, and fps on both backends with the effects on screen is checked when you claim performance.

Next: [art-direction](../art-direction/SKILL.md).
