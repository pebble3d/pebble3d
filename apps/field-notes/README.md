# Field Notes

A photography game built with Pebble3D. You are a field researcher with one roll of film. Six anomalies (luminous, impossible objects) have surfaced inside a real, photo-captured place. Walk the site in third person, follow the signal and the drifting motes to find each one, then raise your camera and bring back a photograph worth keeping: composed on a third, filling the frame, in focus and correctly exposed. Twelve frames, five minutes of daylight, two survey sites.

The point of the game is the engine's Gaussian-splat path: the places are photoreal splat captures, and every mesh (the researcher, the anomalies, the kit) composites into them in both directions, casts shadows onto the splat floor, and is blurred with the splat by the photo mode's depth of field.

## Run it

```bash
pnpm install && pnpm build:wasm && pnpm fetch-assets
pnpm --filter field-notes dev            # http://localhost:5231
```

URL parameters: `site=yard|courtyard`, `demo=1` (autoplayer), `seed=<n>`, `mode=fixed&ticks=<n>` (captures), `start=1` (skip the title), `hud=0`, `mute=1`, `camDist`/`camPitch`, `shotCam=px,py,pz,tx,ty,tz,fov` (staged capture camera), `scout=<scene>&pose=...` (authoring aid: the bare capture from a fixed pose with a 1 m grid).

Frame rate: `node apps/field-notes/bench/fps.mjs 30`. Live-input smoke test (real keyboard and wheel events, no bot): `node apps/field-notes/bench/live-smoke.mjs yard`. Captures: `bash apps/field-notes/bench/capture-final.sh`.

## Controls

| Input                                | Action                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| WASD / arrows, Shift                 | jog (4 m/s, eases in and out), sprint                               |
| Mouse (click to capture the pointer) | look                                                                |
| C or right click                     | raise / lower the camera                                            |
| Click or Space (camera up)           | release the shutter                                                 |
| Wheel                                | zoom (the strip shows the 35 mm-equivalent focal length)            |
| F                                    | eye-autofocus on the anomaly nearest the frame centre               |
| Z / X                                | focus by hand                                                       |
| Q / E                                | exposure −/+ a third of a stop (the meter needle shows the subject) |
| Tab or 1–2 (title)                   | change survey site                                                  |
| Enter                                | start, and a new survey from the results                            |

## The loop

Title (site picker) → survey (explore, reveal, photograph) → results contact sheet with a score and rating → a fresh Enter or click starts a new survey (new seed, new anomaly placement).

- **Finding.** Hidden anomalies show only a faint drift of motes; the signal meter and a synthesised shimmer rise as you close in. Within 4.2 m (3.2 m in the flat) an anomaly materialises.
- **Photographing.** Each photo scores every revealed anomaly in the frame on composition (rule-of-thirds power points; dead centre caps the photo at two stars), fill (diameter between 22% and 55% of the frame height), focus (focus distance against subject depth) and exposure (each anomaly has its own ideal EV), times a crop penalty and an occlusion penalty (an engine raycast from the lens to the subject). 40/65/85 points give one, two or three stars; a star documents the anomaly.
- **Score.** Best photo per anomaly, +50 per documented anomaly, +1 per second of daylight left when all six are in. Ratings: Casual Observer, Field Researcher, Senior Surveyor, Anomaly Laureate.

## What it shows off

- **Splat rendering and splat–mesh compositing.** Two captures: the community-hall yard (800k splats, outdoor) and a courtyard apartment (661k splats, interior). Meshes occlude splats and splats occlude meshes, with CSM shadows on the splat floor through the engine's shadow catcher, and environment lighting taken from the splat.
- **The KCC character.** The Rocketbox researcher is the engine's kinematic character controller (Rust/Rapier) with its third-person spring-arm camera, colliding with the captures' furniture and planters (authored boxes from a top-down scout of each capture).
- **Photo-quality post.** The engine's opt-in depth of field, exposure through the tone mapper, bloom on the emissive anomalies, a viewfinder with eye-AF box, thirds grid, meter needle and a developed print of the actual frame.
- **Determinism.** The survey is a fixed 60 Hz TypeScript sim fed by the engine's deterministic character position; the demo bot is just an input source, and a logged run replays bit-identically (vitest).

## Assets and credits

- "Knock Community Hall" by scbenoit, CC BY 4.0.
- "SA3D_R&D_XP47" (courtyard apartment) by Stéphane Agullo, https://sa3d.fr, CC BY 4.0, converted to SPZ.
- Qwantani Noon HDRI (CC0), Microsoft Rocketbox avatar (MIT).
- Everything else (anomalies, kit, HUD, audio) is procedural or synthesised in this app.

Full attribution: `apps/playground/public/assets/LICENSES.md`.

## Known issues

- The yard capture softens into drone blur beyond z ≈ 14 and x ≈ 12; the play bounds and anomaly spots stay in the sharp part, but looking south or far east shows the soft edge.
- Furniture and planter colliders are hand-placed boxes, so the character can stand slightly inside a splat edge or stop a few centimetres short of it; in the flat the camera arm stops at the room's bounds walls but can clip furniture splats that have no box.
- Splats write no depth: the depth-of-field proxy uses the floor plane and a backdrop distance, so a splat wall closer than the backdrop blurs as if it were farther; additive glows blur like the background behind them.
- Choosing a site on the title reloads the page (the engine builds one scene per game).
