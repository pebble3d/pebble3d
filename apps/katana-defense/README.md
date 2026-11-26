# Ronin Outpost

A katana horde-defence game built with Pebble3D (app `katana-defense`). You are a lone swordsman holding the community-hall gate through eight waves of the dead, from golden hour to dusk.

It is art-directed as a stylised action game. The swordsman is a shinobi in an indigo gi, with a hood and mask, a red headband and a crimson sash whose tails swing as cloth, wrapped forearms and shins, and a blackened katana with a red-corded grip. Everything lit is cel-shaded with ink outlines. The undead get a flat toon palette, and the Gaussian-splat capture of the hall is posterised to sit with the toon meshes.

## Run it

```bash
pnpm install && pnpm build:wasm && pnpm fetch-assets   # first time only
pnpm --filter katana-defense dev                        # http://localhost:5180/
```

`fetch-assets` builds the avatars from pinned sources, which takes about two minutes.

| URL                     | What you get                                                |
| ----------------------- | ----------------------------------------------------------- |
| `/`                     | Play: title screen, then 8 waves                            |
| `/?demo=1`              | An autoplayer bot fights waves 1–3 (`&demoWaves=8` for all) |
| `/?lab=1`               | Move showcase: every move performed in place, in a loop     |
| `/?wave=8`              | Start at wave 8 (dusk, brutes, a 60-plus horde)             |
| `/?lab=1&pose=heavy:10` | Freeze one pose of one move (any move id and frame)         |

## Controls

- **Move:** WASD or the arrow keys. Hold Shift to sprint.
- **Camera:** the mouse, after clicking the canvas. The camera stays high and keeps facing the hall; see Known issues.
- **Light combo:** left click or J, three times. Rising cut, return cut, then the Crescent Sweep finisher.
- **Heavy:** right click or K. Hold to charge for Thunder Cleave.
- **Launcher:** Light, Light, Heavy.
- **Dodge:** Q, or double-tap a direction. Dodge then Light gives the Gale Step dash-slash.
- **Jump and plunge:** Space, then Heavy in the air.
- **Spin Storm:** hold E when the Focus meter is full.
- **Upgrades:** after every second wave, pick one of three with the mouse or keys 1–3.
- **Start:** Enter or a click on the title.

## What it shows off

- **The opt-in toon style.** `post.style: "toon"` is a generic scene style (`packages/renderer/src/style/`); the default PBR path is unchanged.
  - **Cel lighting:** `ToonNodeMaterial` bands the sun term, adds a stepped highlight, a sun-side rim and posterised metal reflections. Maps, skinning, emissive, IBL, GTAO, shadows and fog still work.
  - **Ink outlines** come from the mesh-only depth and normal prepass that GTAO already uses.
  - **Splat grade:** each splat's lightness is posterised, its saturation pushed, and it gets a cool-to-warm split tone.
  - `apps/playground/scenes/showcase-toon.json` shows the style on another scene.
- **The swordsman's technique.** Every cut has a wind-up, a strike and a follow-through. Both hands stay on the hilt for two-handed cuts, the elbows bend through two-bone IK, the torso twists into the swing, the edge leads the cut, and the katana is parented to the right-hand bone with the fingers closed around the hilt.
- **The zombies.** Four different Rocketbox civilians, two men and two women, given a zombie treatment. They shamble on slowed injured or drunk walks, reaching with their arms and lolling their heads. Runners sprint, and brutes are 1.25× scale. Wave 8 brings a 60-plus horde.
- **Corpses.** A killed zombie's body rides a tumbling physics capsule, then sinks into the ground.
- **Crowd performance.** In the horde test, 40 skinned zombies ran at 59.5 fps under the 60 Hz cap (p95 16.8 ms), measured before the toon restyle.
- **Dusk.** The waves light-grade from golden hour to dusk.

Captures come from `bash apps/katana-defense/bench/capture-final.sh` (seed 7, fixed tick).

## Known issues

- **Soft splat patches.** The drone capture is soft just south-east of the start position and past the south and east edges. The camera sits high (12 m arm, 40° lens, yaw limited to face the hall) and the arena bounds are tight to compensate, but some soft grass still shows in the lower right of many frames.
- **The katana animation is procedural and keyed by hand.** It reads as sword technique, but it isn't motion capture. The legs don't step into strikes, and the wrists have no twist bones, so extreme poses can pinch the forearm slightly.
- **Zombies are cut-down crowd assets** (1024 px atlased textures, about 45% of the original triangles), so faces are a little soft up close.
- **Hit reactions are procedural.** Staggers and wind-ups are additive bone turns, and corpses are a frozen pose on a tumbling capsule, not a skeletal ragdoll.
- **Brute telegraphs are weak.** The slam wind-up is a faint warm glow plus raised arms, easy to miss in a busy crowd.
- **The outfit is painted over the Rocketbox textures.** The hood is a recolour, not new geometry. Cloth tails collide with spheres only (head, chest, hips) and can clip the arms or legs in extreme poses.
- **Ground decals** (ichor pools) get ink silhouettes, because the splat floor is not in the prepass.
- **The demo bot is not a fair player.** It dodges perfectly and is only a capture driver.
- **Determinism covers the game sim only.** Corpses, VFX and HUD timing are presentation-side.
