# Post-processing and the toon style

Goal: tune exposure, tone mapping, bloom and AO, or switch the whole scene to the opt-in cel-shaded look with ink outlines.

```json
{
	"version": 1,
	"environment": { "preset": "studio", "ground": {} },
	"post": {
		"exposure": 1,
		"toneMapping": "aces",
		"bloom": { "enabled": true, "strength": 0.45, "threshold": 1.4 },
		"ao": { "enabled": true, "radius": 0.5 },
		"style": "toon",
		"toon": {
			"bands": 3,
			"shadowTone": 0.22,
			"rim": 0.6,
			"specular": 0.7,
			"outline": { "width": 1.5, "color": "#1a1418" },
			"splat": { "levels": 3, "saturation": 1.3 }
		}
	},
	"entities": [
		{ "id": "ball", "mesh": { "primitive": "sphere", "material": { "color": "#e8553a" } }, "body": {}, "transform": { "position": [0, 2, 0] } }
	]
}
```

`post.style` defaults to `"pbr"`, which ignores `post.toon`. With `"toon"`, scene entities and their glTFs are converted by the renderer. Objects your code builds are not:

```ts
import { ToonNodeMaterial } from "@pebble3d/renderer";

const gltf = await game.renderer.loadGltf(url);
game.renderer.stylize(gltf.scene); // once, on the cached scene, before any clone (no-op in pbr)
const steel = new ToonNodeMaterial({ metalness: 0.85, roughness: 0.22 });
steel.toonRim = 1.5; // multiplies post.toon.rim for this material
steel.toonSpecular = 1.6; // multiplies post.toon.specular
```

| Gotcha | Detail |
| --- | --- |
| Opt-in | Leave `style` unset for PBR. Existing scenes must not change look, so never flip a default. |
| Bloom threshold is HDR luminance | The default 2 catches only highlights and emissives; lower it (1.0-1.4) for a softer glow. |
| Outlines come from meshes | The ink pass reads a mesh-only depth/normal prepass: splats and transparent meshes get no lines. |
| Splats are graded, not shaded | `toon.splat` posterises the capture's lightness into `levels` and tints shadows/highlights. |
| One toon style per page | The toon parameters are page-global uniforms (`TOON`); a second renderer overwrites them. `setToonUniforms(settings)` changes them live. |
| Check `renderer.style` | `"toon"` or `"pbr"`; shared code can branch on it. `stylize` is safe to call in either. |
| Exposure at runtime | `game.renderer.three.renderer.toneMappingExposure` (Field Notes' photo EV, Ronin Outpost's dusk). |

Every field and range: [scene-reference.md](../scene-reference.md#post). Look at the result: `pnpm shot --scene showcase-toon --cam hero`.

See it in: [apps/katana-defense/scenes/arena.json](../../apps/katana-defense/scenes/arena.json) (toon post, lines 31-52), [apps/katana-defense/src/main.ts](../../apps/katana-defense/src/main.ts) (`stylize` on cached glTFs, lines 120-127), [apps/katana-defense/src/game/view/katana.ts](../../apps/katana-defense/src/game/view/katana.ts) (`ToonNodeMaterial` with rim and specular multipliers, lines 76-88), [apps/playground/scenes/showcase-toon.json](../../apps/playground/scenes/showcase-toon.json).
