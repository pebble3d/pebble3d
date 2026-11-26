# Scene reference

Every field of a Pebble3D scene JSON file: type, default and meaning.

<!-- gen:begin scene -->
Generated from `packages/sdk/scene.schema.json`. One table per object; nested objects are named by path (`entities[].body.collider`), `<name>` is a record key, and `a | b` is a union or enum.

### scene

| field | type | default | description |
| --- | --- | --- | --- |
| `$schema` | `string` |  |  |
| `version` | `1` | `1` |  |
| `environment` | `object (environment)` | `{}` |  |
| `bounds` | `object (bounds)` |  | Invisible static walls around [min, max] in XZ, from y = 0 up to `height`. |
| `lighting` | `object (lighting)` | `{}` |  |
| `post` | `object (post)` | `{}` |  |
| `camera` | `object (camera)` | `{}` |  |
| `entities` | `object[] (entities[])` | `[]` |  |
| `sim` | `object (sim)` | `{}` |  |
| `prefabs` | `record<string, object (prefabs.<name>)>` | `{}` |  |

### environment

| field | type | default | description |
| --- | --- | --- | --- |
| `preset` | `"outdoor" \| "studio"` | `"outdoor"` |  |
| `hdri` | `string` |  | Equirect .hdr URL; the outdoor preset has a bundled default. |
| `splat` | `object (environment.splat)` |  | A Gaussian-splat capture (.spz, .ply, .splat or .ksplat) drawn with the meshes. Splats neither cast nor receive shadows; a shadow catcher at `floorY` shows mesh shadows on the capture floor. |
| `fog` | `false \| object (environment.fog)` |  | Range fog that hides the ground's far edge. `false` disables it. Defaults per preset (studio near 14 / far 42, outdoor near 25 / far 110). |
| `backdrop` | `object (environment.backdrop)` | `{}` | Studio background: a vertical gradient from `horizon` (eye level and below) to `zenith` (overhead). Ignored by the outdoor preset. |
| `ground` | `object (environment.ground)` |  | Static ground plane collider, plus a visible plane unless `visible: false`. |

### environment.splat

A Gaussian-splat capture (.spz, .ply, .splat or .ksplat) drawn with the meshes. Splats neither cast nor receive shadows; a shadow catcher at `floorY` shows mesh shadows on the capture floor.

| field | type | default | description |
| --- | --- | --- | --- |
| `url` | `string (non-empty)` | required |  |
| `position` | `[number, number, number]` | `[0,0,0]` |  |
| `rotation` | `[number, number, number, number]` | `[0,0,0,1]` |  |
| `scale` | `number (> 0)` | `1` |  |
| `envFromSplat` | `boolean` | `false` | Image-based lighting from the capture: a cube capture at the splat's bounding-box centre, PMREM-filtered once at load. Replaces the preset's environment map (the background stays). |
| `floorY` | `number` | `0` | World y of the capture's floor (after the transform); places the invisible shadow-catcher plane. |
| `exposure` | `number (> 0)` | `1` | Splat colour multiplier (linear) before tone mapping. Compensates the tone mapper's compression; 1 = as captured. |
| `saturation` | `number (>= 0)` | `1` | Splat colour saturation before tone mapping (1 = as captured). Compensates AgX desaturation. |

### environment.fog

| field | type | default | description |
| --- | --- | --- | --- |
| `near` | `number (>= 0)` |  | metres from the camera (view depth). Default: studio 14, outdoor 25. |
| `far` | `number (>= 0)` |  | Fully fogged from here. Default: studio 42, outdoor 110. |
| `color` | `string` |  | Default: studio = backdrop.horizon; outdoor = the HDRI's horizon colour in the view direction. |

### environment.backdrop

Studio background: a vertical gradient from `horizon` (eye level and below) to `zenith` (overhead). Ignored by the outdoor preset.

| field | type | default | description |
| --- | --- | --- | --- |
| `horizon` | `string` | `"#55504a"` |  |
| `zenith` | `string` | `"#141416"` |  |

### environment.ground

Static ground plane collider, plus a visible plane unless `visible: false`.

| field | type | default | description |
| --- | --- | --- | --- |
| `y` | `number` | `0` |  |
| `size` | `number (> 0)` | `50` |  |
| `color` | `string` | `"#808080"` |  |
| `roughness` | `number (>= 0, <= 1)` | `0.9` |  |
| `visible` | `boolean` | `true` |  |

### bounds

Invisible static walls around [min, max] in XZ, from y = 0 up to `height`.

| field | type | default | description |
| --- | --- | --- | --- |
| `min` | `[number, number]` | required | [x, z] |
| `max` | `[number, number]` | required | [x, z] |
| `height` | `number (> 0)` | `4` |  |
| `thickness` | `number (> 0)` | `0.5` |  |

### lighting

| field | type | default | description |
| --- | --- | --- | --- |
| `sun` | `object (lighting.sun)` | `{}` |  |

### lighting.sun

| field | type | default | description |
| --- | --- | --- | --- |
| `direction` | `[number, number, number]` | `[0.5,1,0.3]` | Direction from the scene towards the sun. |
| `intensity` | `number (>= 0)` | `3` |  |
| `color` | `string` | `"#ffffff"` |  |

### post

| field | type | default | description |
| --- | --- | --- | --- |
| `exposure` | `number (> 0)` | `1` |  |
| `toneMapping` | `"agx" \| "aces" \| "none"` | `"agx"` |  |
| `bloom` | `object (post.bloom)` | `{}` |  |
| `ao` | `object (post.ao)` | `{}` |  |
| `style` | `"pbr" \| "toon"` | `"pbr"` | Art style. "toon": cel-banded mesh lighting (lit standard materials become ToonNodeMaterial), ink outlines from the mesh-only depth/normal prepass, and a posterised splat grade, tuned by `toon`. "pbr" (default) ignores `toon`. |
| `toon` | `object (post.toon)` | `{}` |  |

### post.bloom

| field | type | default | description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` |  |
| `strength` | `number (>= 0)` | `0.3` |  |
| `threshold` | `number (>= 0)` | `2` | Linear HDR luminance (before tone mapping) a pixel must exceed to bloom. The default only catches specular highlights and emissives, not sunlit white surfaces. |

### post.ao

| field | type | default | description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` |  |
| `radius` | `number (> 0)` | `0.5` |  |

### post.toon

| field | type | default | description |
| --- | --- | --- | --- |
| `bands` | `integer (>= 2, <= 8)` | `3` | Sun-light tones, shadow tone included. |
| `shadowTone` | `number (>= 0, <= 1)` | `0` | Sun light kept by the darkest band (0 = ambient only). |
| `terminator` | `number (>= -1, <= 1)` | `0` | Added to N·L before banding; > 0 widens the lit bands. |
| `rim` | `number (>= 0)` | `0.35` | Sun-side rim light strength (per-material toonRim scales it). |
| `rimWidth` | `number (>= 0, <= 1)` | `0.3` |  |
| `specular` | `number (>= 0)` | `0.6` | Stepped highlight strength (per-material toonSpecular scales it). |
| `outline` | `object (post.toon.outline)` | `{}` |  |
| `splat` | `object (post.toon.splat)` | `{}` |  |

### post.toon.outline

| field | type | default | description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` |  |
| `width` | `number (> 0, <= 4)` | `1` | CSS pixels (scaled by the device pixel ratio). |
| `color` | `string` | `"#1a1418"` |  |
| `opacity` | `number (>= 0, <= 1)` | `1` |  |
| `depthThreshold` | `number (> 0)` | `0.04` | Relative inverse-depth Laplacian that starts a line. |
| `normalThreshold` | `number (> 0, <= 2)` | `0.35` | 1 - cos(angle) between neighbour normals that starts a crease line. |

### post.toon.splat

| field | type | default | description |
| --- | --- | --- | --- |
| `levels` | `integer (>= 2, <= 32)` | `5` | Posterised lightness steps of the splat. |
| `saturation` | `number (>= 0)` | `1.15` |  |
| `strength` | `number (>= 0, <= 1)` | `1` | Blend of the splat grade with the source colour. |
| `shadowTint` | `string` | `"#4a5662"` |  |
| `highlightTint` | `string` | `"#fff2df"` |  |

### camera

| field | type | default | description |
| --- | --- | --- | --- |
| `controller` | `"thirdPerson" \| "orbit" \| "fly"` | `"orbit"` |  |
| `presets` | `record<string, object (camera.presets.<name>)>` | `{}` |  |

### camera.presets.<name>

| field | type | default | description |
| --- | --- | --- | --- |
| `position` | `[number, number, number]` | required |  |
| `target` | `[number, number, number]` | `[0,0,0]` |  |
| `fov` | `number (> 0)` | `50` |  |

### entities[]

| field | type | default | description |
| --- | --- | --- | --- |
| `id` | `string (non-empty)` | required |  |
| `prefab` | `string` |  | Prefab deep-merged under this entity (entity fields win). |
| `transform` | `object (entities[].transform)` |  |  |
| `mesh` | `object (entities[].mesh)` |  | Exactly one of `primitive` or `gltf`. |
| `body` | `object (entities[].body)` |  |  |
| `character` | `object (entities[].character)` |  | Requires a kinematic body with a capsule collider. |
| `spawner` | `object (entities[].spawner)` |  |  |

### entities[].transform

| field | type | default | description |
| --- | --- | --- | --- |
| `position` | `[number, number, number]` | `[0,0,0]` |  |
| `rotation` | `[number, number, number, number]` | `[0,0,0,1]` | Quaternion [x, y, z, w]. |
| `scale` | `[number (> 0), number (> 0), number (> 0)]` | `[1,1,1]` | Primitives are unit-sized (box 1x1x1, sphere diameter 1, capsule diameter x by total height y, cylinder diameter x by height y), so scale is their size in metres. |

### entities[].mesh

Exactly one of `primitive` or `gltf`.

| field | type | default | description |
| --- | --- | --- | --- |
| `primitive` | `"box" \| "sphere" \| "capsule" \| "plane" \| "cylinder"` |  |  |
| `gltf` | `object (entities[].mesh.gltf)` |  |  |
| `material` | `object (entities[].mesh.material)` |  |  |
| `castShadow` | `boolean` | `true` |  |

### entities[].mesh.gltf

| field | type | default | description |
| --- | --- | --- | --- |
| `url` | `string (non-empty)` | required |  |
| `animations` | `record<"idle" \| "walk" \| "run" \| "jump" \| "fall", string \| object (entities[].mesh.gltf.animations.<state>)>` |  | Animation state -> clip name, or { clip, speed? } in the glTF. |
| `look` | `object (entities[].mesh.gltf.look)` |  | Per-model look tweaks. |

### entities[].mesh.gltf.animations.<state>

| field | type | default | description |
| --- | --- | --- | --- |
| `clip` | `string (non-empty)` | required |  |
| `speed` | `number (> 0)` |  | Authored ground speed of the clip, m/s. |

### entities[].mesh.gltf.look

Per-model look tweaks.

| field | type | default | description |
| --- | --- | --- | --- |
| `envIntensity` | `number (>= 0)` |  |  |
| `saturation` | `number (>= 0, <= 2)` |  |  |

### entities[].mesh.material

| field | type | default | description |
| --- | --- | --- | --- |
| `color` | `string` | `"#cccccc"` |  |
| `roughness` | `number (>= 0, <= 1)` | `0.5` |  |
| `metalness` | `number (>= 0, <= 1)` | `0` |  |
| `emissive` | `string` |  |  |

### entities[].body

| field | type | default | description |
| --- | --- | --- | --- |
| `type` | `"dynamic" \| "static" \| "kinematic"` |  | Default 'dynamic', or 'kinematic' when the entity has a `character`. |
| `mass` | `number (> 0)` |  | kg. Default: from collider volume at density 1. |
| `friction` | `number (>= 0)` | `0.5` |  |
| `restitution` | `number (>= 0)` | `0` |  |
| `linearDamping` | `number (>= 0)` | `0` |  |
| `angularDamping` | `number (>= 0)` | `0` |  |
| `ccd` | `boolean` | `false` |  |
| `collider` | `"auto" \| { shape: "box" } \| { shape: "sphere" } \| { shape: "capsule" } \| { shape: "convexHull" } \| { shape: "trimesh" } \| { shape: "plane" }` | `"auto"` | 'auto' fits the mesh primitive and scale; for glTF it becomes a convex hull computed in JS. |

### entities[].body.collider (shape: "box")

| field | type | default | description |
| --- | --- | --- | --- |
| `shape` | `"box"` | required |  |
| `halfExtents` | `[number (> 0), number (> 0), number (> 0)]` | required |  |

### entities[].body.collider (shape: "sphere")

| field | type | default | description |
| --- | --- | --- | --- |
| `shape` | `"sphere"` | required |  |
| `radius` | `number (> 0)` | required |  |

### entities[].body.collider (shape: "capsule")

| field | type | default | description |
| --- | --- | --- | --- |
| `shape` | `"capsule"` | required |  |
| `halfHeight` | `number (> 0)` | required |  |
| `radius` | `number (> 0)` | required |  |

### entities[].body.collider (shape: "convexHull")

| field | type | default | description |
| --- | --- | --- | --- |
| `shape` | `"convexHull"` | required |  |
| `points` | `number[]` | required |  |

### entities[].body.collider (shape: "trimesh")

| field | type | default | description |
| --- | --- | --- | --- |
| `shape` | `"trimesh"` | required |  |
| `vertices` | `number[]` | required |  |
| `indices` | `(integer (>= 0))[]` | required |  |
| `fixInternalEdges` | `boolean` |  | Smooth contacts across triangle seams (a rolling ball does not bump on internal edges). Default false. |

### entities[].body.collider (shape: "plane")

| field | type | default | description |
| --- | --- | --- | --- |
| `shape` | `"plane"` | required |  |

### entities[].character

Requires a kinematic body with a capsule collider.

| field | type | default | description |
| --- | --- | --- | --- |
| `speed` | `number (> 0)` | `4` | Walk speed, m/s. |
| `sprintSpeed` | `number (> 0)` | `7` | m/s. |
| `jumpSpeed` | `number (>= 0)` | `5.5` | Initial upward velocity, m/s. |
| `maxSlopeDeg` | `number (> 0, < 90)` | `45` |  |
| `stepHeight` | `number (>= 0)` | `0.35` | metres. |
| `snap` | `number (>= 0)` | `0.3` | Ground snap distance, metres. |
| `accel` | `number (>= 0)` | `0` | Horizontal acceleration toward the input velocity, m/s². Starts, stops and turns ramp instead of snapping; 0 (default) changes velocity instantly. |
| `ridePlatforms` | `boolean` | `false` | Opt-in: while grounded on a kinematic body (a moving or rotating platform driven by `setKinematicPose`), move with it exactly and keep its velocity as momentum when jumping or walking off. Without it, walking on a kinematic body is unreliable. |

### entities[].spawner

| field | type | default | description |
| --- | --- | --- | --- |
| `prefab` | `string` | required | Prefab to spawn; it must have a `body`. |
| `rate` | `number (>= 0)` | required | Spawns per second. |
| `count` | `integer (>= 0)` | required | Total spawns. |
| `area` | `object (entities[].spawner.area)` | required | World-space box spawns land in, uniformly. |
| `seed` | `integer (>= 0, <= 4294967295)` |  | Default: sim.seed + entity index. |

### entities[].spawner.area

World-space box spawns land in, uniformly.

| field | type | default | description |
| --- | --- | --- | --- |
| `min` | `[number, number, number]` | required |  |
| `max` | `[number, number, number]` | required |  |

### sim

| field | type | default | description |
| --- | --- | --- | --- |
| `build` | `"deterministic" \| "fast"` | `"deterministic"` |  |
| `seed` | `integer (>= 0, <= 4294967295)` | `1` |  |
| `gravity` | `number` | `-9.81` |  |

### prefabs.<name>

| field | type | default | description |
| --- | --- | --- | --- |
| `transform` | `object (entities[].transform)` |  |  |
| `mesh` | `object (entities[].mesh)` |  | Exactly one of `primitive` or `gltf`. |
| `body` | `object (entities[].body)` |  |  |
| `character` | `object (entities[].character)` |  | Requires a kinematic body with a capsule collider. |
<!-- gen:end scene -->
