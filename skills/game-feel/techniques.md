# Game-feel techniques

The reference behind [SKILL.md](SKILL.md). Each technique has what it does, the values a shipped demo uses, and the file that uses them. Copy the pattern and start from the demo's values, then tune by watching captures. All demos tick at 60 Hz ([constants.ts](../../apps/katana-defense/src/game/constants.ts)), so "frames" below are sim ticks of 1/60 s.

Where the code lives decides determinism. Hit-stop and input buffering change what the sim does, so they live in the sim and are driven by ticks. Shake, punch, trails, particles, decals, slow-motion and sound are presentation: they read the sim's events after each tick and never write back.

## Hit-stop

A short freeze on contact: both fighters hold their pose, so the hit reads as solid. The sim keeps a `hitstop` counter; while it is above zero the move's frame counter and phase timers pause, but presses are still buffered, so a button pressed during the freeze fires as soon as it ends.

| Value                                      | Used                                                        | Source                                                                    |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| Light cuts                                 | `hitstop: 3` frames                                         | [moves.json](../../apps/katana-defense/src/data/moves.json) (`light1`)    |
| Finisher, heavy, charged, launcher, plunge | `hitstop: 5` frames                                         | [moves.json](../../apps/katana-defense/src/data/moves.json)               |
| Multi-hit spin                             | `hitstop: 1` frame per hit                                  | [moves.json](../../apps/katana-defense/src/data/moves.json) (`spinStorm`) |
| Animation during the freeze                | the body animates at `dt * 0.05`, nearly still but not dead | [player-view.ts](../../apps/katana-defense/src/game/view/player-view.ts)  |
| Trail during the freeze                    | the blade trail ages at `dt * 0.15`, so it hangs in the air | [present.ts](../../apps/katana-defense/src/game/present.ts)               |
| Presses during the freeze                  | `buffer()` keeps them; the move starts when the freeze ends | [combo.ts](../../apps/katana-defense/src/game/combat/combo.ts)            |

Keep it short. Longer than a handful of frames reads as lag, not weight. Scale it with the hit: light hits get the least, finishers the most.

## Screen shake (trauma)

Every event adds "trauma"; the offset is trauma squared, so small hits barely move the camera and big ones rattle it. Trauma decays linearly or exponentially. Use sums of sines at unrelated frequencies, not random numbers, so captures are reproducible.

| Value                    | Used                                                                                               | Source                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Offset                   | `trauma * trauma * SHAKE_METRES`, `SHAKE_METRES = 0.32`, plus a small roll                         | [camera-rig.ts](../../apps/katana-defense/src/game/view/camera-rig.ts) |
| Decay                    | `TRAUMA_DECAY = 1.7` per second, trauma capped at 1                                                | [camera-rig.ts](../../apps/katana-defense/src/game/view/camera-rig.ts) |
| Per hit (sim requests)   | light `shake: 0.12`, heavy `0.4`, charged heavy `0.7`                                              | [moves.json](../../apps/katana-defense/src/data/moves.json)            |
| Request to trauma        | `addTrauma(s.shake * 0.55)`                                                                        | [present.ts](../../apps/katana-defense/src/game/present.ts)            |
| Ringout cap and decay    | shake capped at `0.5`, decays `dt * 1.6`, offset uses `shake * shake`                              | [camera.ts](../../apps/ringout/src/game/view/camera.ts)                |
| Ringout events           | orb collision only above 5 m/s, `kick(Math.min(0.5, v * 0.025))`; ring-out `0.35`; ring drop `0.2` | [app.ts](../../apps/ringout/src/game/app.ts)                           |
| Breakpoint cap and decay | amplitude capped at `0.6`, multiplied by `Math.exp(-dt * 4.5)`                                     | [camera.ts](../../apps/breakpoint/src/game/view/camera.ts)             |
| Breakpoint events        | cannon fire `0.35`, first ball impact `0.5`, big block hits only `0.04`                            | [present.ts](../../apps/breakpoint/src/game/present.ts)                |

A threshold matters as much as the amount: Ringout ignores gentle bumps, and Breakpoint shakes only for the heaviest debris hits, so the screen is calm most of the time and shake keeps its meaning.

## Camera punch-in

A brief zoom on a heavy event: the field of view narrows by a few degrees and springs back. It reads as the camera flinching toward the hit.

| Value            | Used                                            | Source                                                                 |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Base lens        | `BASE_FOV = 40` degrees                         | [camera-rig.ts](../../apps/katana-defense/src/game/view/camera-rig.ts) |
| Recovery         | the kick drains at `dt * 30` degrees per second | [camera-rig.ts](../../apps/katana-defense/src/game/view/camera-rig.ts) |
| Heavy hit landed | `punch(2.5)`                                    | [present.ts](../../apps/katana-defense/src/game/present.ts)            |
| Player hurt      | `punch(2)`                                      | [present.ts](../../apps/katana-defense/src/game/present.ts)            |
| Plunge landing   | `punch(4)` plus a ground ring                   | [present.ts](../../apps/katana-defense/src/game/present.ts)            |

`punch` keeps the larger of the current and new kick (`Math.max`), so stacked hits do not zoom forever.

## Slow motion and the impact camera

For the one moment that decides a turn, drop game time and cut to a closer camera. This is presentation time scale: the sim still runs the same ticks, just fewer per second, so determinism is unaffected.

| Value                   | Used                                                                       | Source                                                     |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Impact slow-mo          | time scale `0.22` for `1.3` s, then smoothstep back to `1` over `1.4` s    | [camera.ts](../../apps/breakpoint/src/game/view/camera.ts) |
| Impact camera           | spring stiffness `9` (flight `6`, otherwise `2.4`): it snaps to the impact | [camera.ts](../../apps/breakpoint/src/game/view/camera.ts) |
| Replay speed            | `replayScale = 0.4`                                                        | [camera.ts](../../apps/breakpoint/src/game/view/camera.ts) |
| Replay slow around a KO | `0.4` from 50 ticks before to 30 after each ring-out, quick elsewhere      | [app.ts](../../apps/ringout/src/game/app.ts)               |

Trigger it once per decisive event (Breakpoint: only the ball's first hit). Slow motion on every hit turns into sluggishness.

## Impact frame

For the very heaviest hits, a graphic "impact frame" for one to three frames: the scene flashes to high contrast (a white or inverted silhouette, a radial burst behind the contact point), then snaps back. It sits on top of the hit-stop and is the strongest single cue you have; keep it for finishers. Ringout's closest cousin is the white flash on both orbs at a collision, `flash(Math.min(1.2, v * 0.1))`, scaled by closing speed ([app.ts](../../apps/ringout/src/game/app.ts)).

## Trails

A ribbon swept by the striking edge (a blade, a limb, a fast ball). It should taper: bright and wide at the newest sample, fading to nothing at the oldest and toward the root.

| Value       | Used                                                                                             | Source                                                      |
| ----------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Ring buffer | `SAMPLES = 64` edge samples, preallocated                                                        | [trail.ts](../../apps/katana-defense/src/game/vfx/trail.ts) |
| Life        | `LIFE = 0.14` s per sample, alpha `life * life` (quadratic taper)                                | [trail.ts](../../apps/katana-defense/src/game/vfx/trail.ts) |
| Shape       | the inner edge starts `0.25` of the way up the blade, the outer edge reaches `0.08` past the tip | [trail.ts](../../apps/katana-defense/src/game/vfx/trail.ts) |
| Colour      | additive, hot white core cooling to steel blue                                                   | [trail.ts](../../apps/katana-defense/src/game/vfx/trail.ts) |
| Smoothness  | `TRAIL_SUBSTEPS = 4` interpolated samples per rendered frame, slerping the blade direction       | [present.ts](../../apps/katana-defense/src/game/present.ts) |
| Weight      | `intensity` `1.25` for heavy moves, `0.9` for light                                              | [present.ts](../../apps/katana-defense/src/game/present.ts) |

Call `cut()` at the start of each swing, or the new ribbon connects to the last one across the screen. Only emit during the move's active window, a few frames either side of the hit.

## Afterimages

Ghost copies of the body on dashes and dodges: speed you can see in a still.

| Value | Used                                                  | Source                                                                |
| ----- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| Pool  | `GHOSTS = 5` pre-cloned skinned copies, additive cyan | [afterimage.ts](../../apps/katana-defense/src/game/vfx/afterimage.ts) |
| Life  | `LIFE = 0.32` s, strength `k * k * 0.55`              | [afterimage.ts](../../apps/katana-defense/src/game/vfx/afterimage.ts) |
| When  | dodge and dash-slash only, early frames of the move   | [present.ts](../../apps/katana-defense/src/game/present.ts)           |

## Particles

One pooled `InstancedMesh` per particle kind, structure-of-arrays state, the oldest recycled when full ([particles.ts](../../apps/katana-defense/src/game/vfx/particles.ts)). Give each kind its own gravity and drag: that is what makes sparks, gore and dust read as different materials. Particles that arc with gravity and land read as physical; particles that just fade in place read as a UI effect.

| Kind        | Mode        | Values                                                                       | Source                                                      |
| ----------- | ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Sparks      | `stretch`   | capacity `400`, gravity `9`, drag `3.5`, stretched along velocity by `0.045` | [present.ts](../../apps/katana-defense/src/game/present.ts) |
| Ichor       | `tumble`    | capacity `500`, gravity `14`, drag `0.6`; spawns a floor decal on landing    | [present.ts](../../apps/katana-defense/src/game/present.ts) |
| Dust        | `billboard` | capacity `260`, gravity `-0.4` (rises), drag `2.2`                           | [present.ts](../../apps/katana-defense/src/game/present.ts) |
| Splinters   | `tumble`    | capacity `120`, gravity `14`, drag `0.4`                                     | [present.ts](../../apps/katana-defense/src/game/present.ts) |
| Kill burst  | ichor       | `16` chunks in a ring, plus the victim's velocity                            | [present.ts](../../apps/katana-defense/src/game/present.ts) |
| Ball impact | dust        | `puff(..., 26, 1.6)` and `spray(..., 60, 11)` on the first hit               | [present.ts](../../apps/breakpoint/src/game/present.ts)     |

Spread a burst with deterministic offsets from the loop index (`Math.sin(k * 2.1)`, `(k * 3) % 5`) instead of `Math.random`.

## Persistent decals

Marks that stay on the floor after the action: pools, scorch, cracks, rings. They turn a fight into a history the player can read in a still.

| Value          | Used                                                                               | Source                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Pool life      | `6 + size * 20` seconds, from the landing particle's size                          | [present.ts](../../apps/katana-defense/src/game/present.ts)                                                                |
| Pool cap       | `ichorDecals(scene, 90)`; when full, the oldest slot is reused                     | [present.ts](../../apps/katana-defense/src/game/present.ts)                                                                |
| Growth         | radius eases `r0` to `r1` with a cubic ease-out over the first part of life        | [decals.ts](../../apps/katana-defense/src/game/vfx/decals.ts)                                                              |
| Ending         | the last 30% of life (`(t - 0.7) / 0.3`): additive decals fade, opaque ones shrink | [decals.ts](../../apps/katana-defense/src/game/vfx/decals.ts)                                                              |
| Shockwave ring | additive, grows for `0.55` of its life; ring caps `24`                             | [decals.ts](../../apps/katana-defense/src/game/vfx/decals.ts), [present.ts](../../apps/katana-defense/src/game/present.ts) |
| Z-fighting     | lift `y` slightly and use `polygonOffset` on opaque decals                         | [decals.ts](../../apps/katana-defense/src/game/vfx/decals.ts)                                                              |

## Telegraphs

Enemy wind-ups drawn on the ground: the strike area fills from the attacker outward as the hit approaches and pulses red near the end ([telegraphs.ts](../../apps/katana-defense/src/game/vfx/telegraphs.ts)). Fair danger is part of feel: the player should lose to what they saw coming. The Ronin Outpost README lists weak telegraphs as a known issue, so make yours brighter than its brute slam.

## Input buffering and cancel windows

A press slightly early still counts. Without a buffer, combos drop inputs and the controls feel "sticky".

| Value               | Used                                                                             | Source                                                          |
| ------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Buffer window       | `BUFFER_FRAMES = 9`                                                              | [constants.ts](../../apps/katana-defense/src/game/constants.ts) |
| Buffer size         | `BUF_CAP = 4` presses, oldest dropped                                            | [combo.ts](../../apps/katana-defense/src/game/combat/combo.ts)  |
| Linger after a move | `LINGER_FRAMES = 10`: a press just after a move ends still chains                | [constants.ts](../../apps/katana-defense/src/game/constants.ts) |
| Cancel window       | `light1`: `total: 24`, `cancel: [10, 24]`; heavy `total: 42`, `cancel: [32, 42]` | [moves.json](../../apps/katana-defense/src/data/moves.json)     |
| Sub-tick taps       | a press shorter than one tick is still sent as one tick of the button            | [live-input.ts](../../apps/skyrun/src/game/live-input.ts)       |

Movement games want the same forgiveness: let a jump pressed just before landing fire on landing, and a jump just after walking off a ledge still count.

## Easing and anticipation

Nothing should snap linearly. Use an exponential approach for cameras and followers, `1 - Math.exp(-k * dt)` (frame-rate independent): Ringout's play camera uses `k = 2.5` ([camera.ts](../../apps/ringout/src/game/view/camera.ts)). Ease animation keys with smoothstep ([pose.ts](../../apps/katana-defense/src/game/combat/pose.ts)). Give every action a wind-up, a strike and a follow-through; the strike itself can be very short. Judge this in a sequence, never one frame: a still can look great while the motion between keys is stiff.

## Hits without contact events

Breakpoint detects impacts from body speeds alone: a body that lost more than `HIT_DV = 2.6` m/s between two ticks just hit something, at most `MAX_PER_TICK = 10` reported per tick ([impacts.ts](../../apps/breakpoint/src/game/view/impacts.ts)). Scale the response by energy (speed loss times mass) so a pebble ticks and a slab thumps.

## Sound

Every player action and every hit gets a cue, synthesised with WebAudio and fired from the sim's events after the tick ([audio-sfx.md](../../docs/cookbook/audio-sfx.md)). Vary it with the event: Ronin Outpost's swing whoosh is louder for heavy moves (`swish(heavy ? 1 : 0.2)`) and the hit sound takes a `heavy` flag ([present.ts](../../apps/katana-defense/src/game/present.ts)). Cap voices per frame (Rockfall: at most `IMPACTS_PER_FRAME = 4` impact sounds per rendered frame, [sfx.ts](../../apps/rockfall/src/game/audio/sfx.ts)), create the context only after a user gesture, and keep sound off in fixed mode.

## Budget

Every layer costs draw calls and fill rate. Pool everything (all the classes above preallocate and never allocate per frame), cap counts, and prefer one `InstancedMesh` per kind. Additive and transparent effects layered on the WebGL backend can cost several times what they cost on WebGPU, so measure both backends with the effects on screen, as [verify-your-work](../verify-your-work/SKILL.md) describes, before adding more.
