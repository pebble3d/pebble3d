# Depth of field

Goal: a photo-mode blur with a focus distance you control, that also works on splat captures.

Depth of field is a renderer control, not a scene field: `game.renderer.dof` (`DepthOfFieldControls`). It is off by default and costs nothing until first enabled.

```ts
// Defaults (DOF_DEFAULTS in @pebble3d/renderer): focus 5, range 3, bokeh 1, backdrop 30.
const dof = game.renderer.dof;
dof.bokeh.value = 1.1; // bokeh size, unitless
dof.backdrop.value = 30; // metres assumed for depthless pixels that miss the floor (sky, far walls)

let photoMode = false;
window.addEventListener("keydown", (e) => {
	if (e.code === "KeyF") photoMode = !photoMode;
});

game.onFrame(() => {
	dof.enabled = photoMode;
	if (!photoMode) return;
	const focus = distanceToSubject(); // metres along the view direction
	dof.focus.value = focus;
	dof.range.value = Math.min(8, Math.max(0.35, focus * 0.42)); // metres to full blur
});
```

| Gotcha | Detail |
| --- | --- |
| First enable builds the chain | The DOF passes are built the first time `enabled` turns true, so that frame does extra work; enable it once early (as a warm-up) if a hitch matters. Toggling afterwards only swaps the pipeline output. |
| Values are uniforms | Set `focus.value`, `range.value`, `bokeh.value`, `backdrop.value`, never replace the objects. |
| Focus is view depth | Distance along the camera's forward axis, not the straight-line distance to the subject (they differ off-centre). |
| Splats have no depth | A pixel with no mesh depth gets a proxy: where its view ray hits the plane at `environment.splat.floorY`, that distance; otherwise `backdrop`. Set `floorY` correctly or ground splats blur wrongly. |
| Transparent meshes blur like the backdrop | Additive glows and particles write no depth, so they take the proxy distance of what is behind them even when they sit in focus. |
| Tie `range` to the lens | Field Notes uses `focus * 0.42 * (40 / fovDeg)`, clamped to 0.35-8 m: the blur ramp grows with focus distance and with zoom. |

See it in: [apps/field-notes/src/game/present.ts](../../apps/field-notes/src/game/present.ts) (`bokeh`/`backdrop` per site, lines 115-117; enable while the camera is raised and drive focus and range, lines 280-290). The controls and defaults are in [api-reference.md](../api-reference.md) (`DepthOfFieldControls`, `DOF_DEFAULTS`).
