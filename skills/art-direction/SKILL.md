---
name: art-direction
description: Use when a Pebble3D game's look is still engine defaults, at the art-pass step of make-a-game, or when captures look flat, muddy or inconsistent. Commits to one look from the brief (palette, toon or PBR, lighting, post, composition) and judges captures against it over at least two improvement passes.
---

# Art direction

Default lighting on grey boxes reads as a tech demo, whatever the mechanics. A committed look, one palette, one lighting mood, one rendering style, carried through every object and the HUD, reads as a game. You do not need imported art for it: every demo below builds most of its world from primitives and code.

The scene fields for everything here are in [docs/scene-reference.md](../../docs/scene-reference.md); the post and toon recipe is [post-and-toon-style.md](../../docs/cookbook/post-and-toon-style.md).

## Commit to one look

Write the look in the "look" section of `apps/<name>/BRIEF.md` before touching the scene, in one short paragraph a stranger could check a screenshot against:

- **Mood and time of day.** "Dusk on a floating stone arena", "noon in a dusty quarry", "a dark keep lit only by lanterns".
- **Palette.** A background family, a ground family and one or two accent colours reserved for what the player must notice: the player, the threat, the goal, pickups. Write the hex values.
- **Style.** Toon or PBR (next section), and why it fits.
- **Reference.** One or two of the reference captures below that are closest in spirit, and what you take from each.

Every later choice is checked against this paragraph. If a choice does not serve it, drop it.

## Toon or PBR

| Choose | When                                                                                      | Demo                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `toon` | Stylised characters, action, readability over realism; mixing primitives with glTF models | Ronin Outpost: [arena.json](../../apps/katana-defense/scenes/arena.json)                                                     |
| `pbr`  | Materials are the point (stone, metal, glass), physics debris, a moody lit interior       | Breakpoint: [site.json](../../apps/breakpoint/scenes/site.json); Ringout: [arena.json](../../apps/ringout/scenes/arena.json) |

`post.style: "toon"` bands the lighting, adds a rim and ink outlines. Objects your code builds need `ToonNodeMaterial` or `renderer.stylize`; the recipe has the details. Pick one and apply it everywhere: a toon character on a PBR ground with no outline reads as a mistake.

## Lighting and sky

- **Outdoor** (`environment.preset: "outdoor"`): an HDRI sky lights the scene; pick one that matches the time of day, and set the sun direction and colour to agree with it. Breakpoint pairs a clear noon sky with a warm sun.
- **Studio** (`"studio"`): a gradient backdrop from `horizon` to `zenith` and range fog of the same colour. Ringout uses a deep violet horizon, a navy zenith and a peach sun: a whole mood from three colours.
- **Dark interiors**: low ambient, and the light comes from things in the world (lanterns, emissive pickups), as in Lanternfall. Make sure the player and the threat are always lit.
- A low, warm, side-on sun gives long shadows and shape; a sun straight overhead flattens everything.
- Fog hides the ground's far edge and separates depth layers. Tint it to the sky.

## Post

- **Tone mapping and exposure.** `agx` (the default) is soft and natural; `aces` is punchier and more saturated. Raise exposure until the ground reads, not until whites clip.
- **Bloom** only on what should glow: emissives, beams, effects. Lower the threshold for a softer glow, never so low that sunlit ground blooms.
- **AO** grounds objects on the floor. Leave it on unless you measured it costing too much.
- Runtime changes (a dusk grade over waves, a photo exposure) go through `toneMappingExposure`, as the recipe shows.

## Composition and silhouettes

- **Readable at a glance.** In a capture shrunk to thumbnail size, you can still find the player, the threat and the goal. If not, fix value contrast first (light against dark), then colour.
- **Silhouettes.** Each kind of actor has a distinct shape: size, proportions, a hat or a weapon. Ringout gives every orb its own team colour and a name plate; Swarm Siege keeps towers pale and the swarm saturated.
- **Accent colour is information.** Reserve the brightest, most saturated colours for gameplay (the player, danger, pickups, the HUD's key number). Scenery stays quieter.
- **Camera framing.** The default view puts the action in the middle third with space in the direction of travel. Title and results screens can use a slow orbit with the subject off centre, leaving room for text, as Ronin Outpost and Ringout do.

## Stage dressing from primitives

An empty plane is the biggest tell of a tech demo. Dress the stage with what the brief's world would contain, built from boxes, cylinders and spheres with distinct materials: walls and crates, posts and rope, rocks, columns, distant silhouettes on the horizon. Vary scale and colour slightly per instance (seeded, never `Math.random` in the sim). Breakpoint's sites are hundreds of boxes; Skyrun's floating islands are simple shapes over a sea of cloud. Dressing should frame the play space, never hide the player.

## The HUD is part of the look

Use one type family, the palette's accent for the numbers that matter, a translucent panel colour taken from the scene, and consistent corner placement. The HUD must not cover the action. Compare the HUDs in the Ringout, Skyrun and Swarm Siege captures below.

## Reference captures

Committed looks from the demos (the site's 1280x720 WebP captures; how they are made: [site/README.md](../../site/README.md)):

| Look                                                  | Capture                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toon outdoor, ink outlines, a blade trail             | [Ronin Outpost, light combo](../../site/public/shots/ronin-outpost/03-light-combo-slash.webp), [dusk wave](../../site/public/shots/ronin-outpost/08-dusk-wave8.webp) |
| PBR stone under noon sun, dust and debris             | [Breakpoint, impact](../../site/public/shots/breakpoint/03-impact.webp)                                                                                              |
| Studio dusk backdrop, team colours, bold HUD          | [Ringout, opening clash](../../site/public/shots/ringout/03-opening-clash.webp), [ring drop](../../site/public/shots/ringout/05-ring-drop.webp)                      |
| Dark interior lit by lanterns, a vision cone          | [Lanternfall, creep](../../site/public/shots/lanternfall/02-creep.webp)                                                                                              |
| Pastel sky, floating islands, soft fog                | [Skyrun, spire](../../site/public/shots/skyrun/14-spire.webp)                                                                                                        |
| Night, neon beams on a dark ground, a saturated swarm | [Swarm Siege, firefight](../../site/public/shots/swarm-siege/05-firefight.webp)                                                                                      |
| Racing, motion and speed                              | [Drift Drone](../../site/public/shots/drift-drone/09-photo-finish.webp), [Ghostline](../../site/public/shots/ghostline/08-ember-glamour.webp)                        |

Open them before you start and name, in the brief, what you take from one or two.

## Judge and improve

The art pass is at least two passes, each ending in captures you looked at.

1. Capture the moments from the brief (title, mid-play, the big moment, results) with the `?demo=1` bot, as [verify-your-work](../verify-your-work/SKILL.md) describes. Open every PNG the shot prints.
2. Put each capture next to the look paragraph and the reference you chose. Write down, per capture, the three biggest gaps: "ground is flat grey", "the player disappears against the wall", "bloom washes out the HUD", "the sky does not match the sun".
3. Fix the biggest gaps, recapture the same ticks with the same seed, and compare side by side.
4. Repeat at least once more. Stop when a stranger would describe the capture in the brief's words.

Check the WebGL backend too (`--backend webgl`): fog, bloom and the toon pass must look the same there.

## Exit check

- The look paragraph in `BRIEF.md` names a palette with hex values, the style, the lighting and a reference capture.
- Captures of title, mid-play, the big moment and results match it; no engine-default grey ground or default sky remains unless the brief chose it.
- The player, the threat and the goal read in a thumbnail.
- At least two judge-and-improve passes, each with captures you opened.

Next: [complete-game-loop](../complete-game-loop/SKILL.md).
