# Splat environments

Goal: use a Gaussian-splat capture as the world, lit by itself, with mesh shadows on its floor and invisible colliders where its walls are.

```json
{
	"version": 1,
	"environment": {
		"preset": "outdoor",
		"hdri": "/assets/qwantani_noon_puresky_2k.hdr",
		"fog": false,
		"splat": {
			"url": "/assets/knock-community-hall-800k.spz",
			"position": [0, -1.006, 0],
			"rotation": [0.99997, -0.0006, 7e-5, -0.0077],
			"scale": 2.2,
			"envFromSplat": true,
			"floorY": 0,
			"exposure": 0.88,
			"saturation": 1.1
		},
		"ground": { "y": 0, "size": 80, "visible": false }
	},
	"bounds": { "min": [-6, 7.2], "max": [12.5, 14.2], "height": 4 },
	"post": { "toneMapping": "aces" },
	"entities": [
		{ "id": "planter", "body": { "type": "static", "collider": { "shape": "box", "halfExtents": [0.6, 0.4, 0.6] } }, "transform": { "position": [3, 0.4, 10] } }
	]
}
```

The splat and HDRI come from `pnpm fetch-assets` (served at `/assets/`). Try it: `pnpm shot --scene showcase --cam hero`.

| Gotcha | Detail |
| --- | --- |
| Splats have no physics | Add an invisible `ground` (`visible: false`) at the capture floor, `bounds` for its edges and body-only static entities (no `mesh`) for furniture. |
| Align the floor first | Tune `position`/`rotation`/`scale` until the capture floor sits at y = 0, then set `floorY` to it: the invisible shadow catcher goes there and depth of field uses it for ground splats. Field Notes' `?scout=<scene>&pose=...` renders a 1 m grid over the splat for this. |
| Splats neither cast nor receive shadows | Only meshes cast, onto the shadow catcher. |
| `envFromSplat` | Lights meshes from a cube capture of the splat (once, at load) instead of the HDRI; the background stays. |
| Colour | `exposure` and `saturation` compensate the tone mapper; `renderer.splatColor` (`exposure`, `saturation`, `tint`) changes them live, for example a dusk grade. |
| Formats | `.spz`, `.ply`, `.splat`, `.ksplat`, picked by extension. |
| Budget | Above 1,500,000 splats the renderer logs a `console.warn`, which fails `pnpm shot`. Decimate first (the manifest's `derive` step runs `splat-transform`). |
| Missing file | A failed load is reported once as a console error and the game runs without the splat (`showcase-badsplat.json` tests this); `pnpm shot` then fails unless you pass `--allow-console-error`. |

See it in: [apps/playground/scenes/showcase.json](../../apps/playground/scenes/showcase.json), [apps/field-notes/scenes/courtyard.json](../../apps/field-notes/scenes/courtyard.json) (an interior capture), [apps/field-notes/src/main.ts](../../apps/field-notes/src/main.ts) (obstacles injected as static boxes, lines 75-98), [apps/field-notes/src/scout.ts](../../apps/field-notes/src/scout.ts) (alignment grid), [apps/katana-defense/src/game/view/dusk.ts](../../apps/katana-defense/src/game/view/dusk.ts) (live `splatColor` grade, lines 136-145).
