import { z } from "zod";
import type { ColliderJson, Vec3 } from "./types.ts";

// ---------------------------------------------------------------------------
// Entity defaults
//
// Entity and prefab fields stay `undefined` when unset (no zod defaults), so a
// prefab deep-merge can tell "not given" from "defaulted": an entity that sets
// only `material.color` keeps its prefab's `roughness`. `expandScene` applies
// these defaults after the merge. They are also emitted as JSON Schema
// `default`s (via `.meta`) so agents can see them.
// ---------------------------------------------------------------------------

export const ENTITY_DEFAULTS = {
	position: [0, 0, 0] as Vec3,
	rotation: [0, 0, 0, 1] as [number, number, number, number],
	scale: [1, 1, 1] as Vec3,
	material: { color: "#cccccc", roughness: 0.5, metalness: 0 },
	castShadow: true,
	body: {
		friction: 0.5,
		restitution: 0,
		linearDamping: 0,
		angularDamping: 0,
		ccd: false,
	},
	character: {
		speed: 4,
		sprintSpeed: 7,
		jumpSpeed: 5.5,
		maxSlopeDeg: 45,
		stepHeight: 0.35,
		snap: 0.3,
		accel: 0,
		ridePlatforms: false,
	},
} as const;

/**
 * Per-preset environment defaults, resolved by `expandScene` (they depend on `preset`).
 * Fog is a view-depth range fog: studio fades the floor into the backdrop's horizon colour,
 * outdoor into the HDRI's horizon (sampled per view direction when `color` is unset).
 */
export const ENV_DEFAULTS = {
	fog: {
		studio: { near: 14, far: 42 },
		outdoor: { near: 25, far: 110 },
	},
	backdrop: { horizon: "#55504a", zenith: "#141416" },
} as const;

const Vec2 = z.tuple([z.number(), z.number()]);
const Vec3S = z.tuple([z.number(), z.number(), z.number()]);
const QuatS = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const PositiveVec3 = z.tuple([
	z.number().positive(),
	z.number().positive(),
	z.number().positive(),
]);
const nonNeg = () => z.number().nonnegative();

export const PRIMITIVES = [
	"box",
	"sphere",
	"capsule",
	"plane",
	"cylinder",
] as const;
export const ANIM_STATES = ["idle", "walk", "run", "jump", "fall"] as const;

const opt = <T extends z.ZodType>(s: T, def: unknown, description?: string) =>
	s
		.optional()
		.meta(description ? { default: def, description } : { default: def });

const TransformSchema = z.strictObject({
	position: opt(Vec3S, ENTITY_DEFAULTS.position),
	rotation: opt(QuatS, ENTITY_DEFAULTS.rotation, "Quaternion [x, y, z, w]."),
	scale: opt(
		PositiveVec3,
		ENTITY_DEFAULTS.scale,
		"Primitives are unit-sized (box 1x1x1, sphere diameter 1, capsule diameter x by total height y, cylinder diameter x by height y), so scale is their size in metres.",
	),
});

const MaterialSchema = z.strictObject({
	color: opt(z.string(), ENTITY_DEFAULTS.material.color),
	roughness: opt(z.number().min(0).max(1), ENTITY_DEFAULTS.material.roughness),
	metalness: opt(z.number().min(0).max(1), ENTITY_DEFAULTS.material.metalness),
	emissive: z.string().optional(),
});

const MeshSchema = z
	.strictObject({
		primitive: z.enum(PRIMITIVES).optional(),
		gltf: z
			.strictObject({
				url: z.string().min(1),
				animations: z
					.partialRecord(
						z.enum(ANIM_STATES),
						z.union([
							z.string(),
							z.strictObject({
								clip: z.string().min(1),
								speed: z
									.number()
									.positive()
									.optional()
									.describe("Authored ground speed of the clip, m/s."),
							}),
						]),
					)
					.optional()
					.describe(
						"Animation state -> clip name, or { clip, speed? } in the glTF.",
					),
				look: z
					.strictObject({
						envIntensity: z.number().min(0).optional(),
						saturation: z.number().min(0).max(2).optional(),
					})
					.optional()
					.describe("Per-model look tweaks."),
			})
			.optional(),
		material: MaterialSchema.optional(),
		castShadow: opt(z.boolean(), ENTITY_DEFAULTS.castShadow),
	})
	.describe("Exactly one of `primitive` or `gltf`.");

const ExplicitColliderSchema = z.discriminatedUnion("shape", [
	z.strictObject({ shape: z.literal("box"), halfExtents: PositiveVec3 }),
	z.strictObject({ shape: z.literal("sphere"), radius: z.number().positive() }),
	z.strictObject({
		shape: z.literal("capsule"),
		halfHeight: z.number().positive(),
		radius: z.number().positive(),
	}),
	z.strictObject({
		shape: z.literal("convexHull"),
		points: z.array(z.number()),
	}),
	z.strictObject({
		shape: z.literal("trimesh"),
		vertices: z.array(z.number()),
		indices: z.array(z.number().int().nonnegative()),
		fixInternalEdges: z
			.boolean()
			.optional()
			.describe(
				"Smooth contacts across triangle seams (a rolling ball does not bump on internal edges). Default false.",
			),
	}),
	z.strictObject({ shape: z.literal("plane") }),
]);

const BodySchema = z.strictObject({
	type: z
		.enum(["dynamic", "static", "kinematic"])
		.optional()
		.describe(
			"Default 'dynamic', or 'kinematic' when the entity has a `character`.",
		),
	mass: z
		.number()
		.positive()
		.optional()
		.describe("kg. Default: from collider volume at density 1."),
	friction: opt(nonNeg(), ENTITY_DEFAULTS.body.friction),
	restitution: opt(nonNeg(), ENTITY_DEFAULTS.body.restitution),
	linearDamping: opt(nonNeg(), ENTITY_DEFAULTS.body.linearDamping),
	angularDamping: opt(nonNeg(), ENTITY_DEFAULTS.body.angularDamping),
	ccd: opt(z.boolean(), ENTITY_DEFAULTS.body.ccd),
	collider: opt(
		z.union([z.literal("auto"), ExplicitColliderSchema]),
		"auto",
		"'auto' fits the mesh primitive and scale; for glTF it becomes a convex hull computed in JS.",
	),
});

const CharacterSchema = z
	.strictObject({
		speed: opt(
			z.number().positive(),
			ENTITY_DEFAULTS.character.speed,
			"Walk speed, m/s.",
		),
		sprintSpeed: opt(
			z.number().positive(),
			ENTITY_DEFAULTS.character.sprintSpeed,
			"m/s.",
		),
		jumpSpeed: opt(
			nonNeg(),
			ENTITY_DEFAULTS.character.jumpSpeed,
			"Initial upward velocity, m/s.",
		),
		maxSlopeDeg: opt(
			z.number().gt(0).lt(90),
			ENTITY_DEFAULTS.character.maxSlopeDeg,
		),
		stepHeight: opt(nonNeg(), ENTITY_DEFAULTS.character.stepHeight, "metres."),
		snap: opt(
			nonNeg(),
			ENTITY_DEFAULTS.character.snap,
			"Ground snap distance, metres.",
		),
		accel: opt(
			nonNeg(),
			ENTITY_DEFAULTS.character.accel,
			"Horizontal acceleration toward the input velocity, m/s². Starts, stops and turns ramp instead of snapping; 0 (default) changes velocity instantly.",
		),
		ridePlatforms: opt(
			z.boolean(),
			ENTITY_DEFAULTS.character.ridePlatforms,
			"Opt-in: while grounded on a kinematic body (a moving or rotating platform driven by `setKinematicPose`), move with it exactly and keep its velocity as momentum when jumping or walking off. Without it, walking on a kinematic body is unreliable.",
		),
	})
	.describe("Requires a kinematic body with a capsule collider.");

const SpawnerSchema = z.strictObject({
	prefab: z.string().describe("Prefab to spawn; it must have a `body`."),
	rate: nonNeg().describe("Spawns per second."),
	count: z.number().int().nonnegative().describe("Total spawns."),
	area: z
		.strictObject({ min: Vec3S, max: Vec3S })
		.describe("World-space box spawns land in, uniformly."),
	seed: z
		.number()
		.int()
		.nonnegative()
		.max(0xffffffff)
		.optional()
		.describe("Default: sim.seed + entity index."),
});

const prefabShape = {
	transform: TransformSchema.optional(),
	mesh: MeshSchema.optional(),
	body: BodySchema.optional(),
	character: CharacterSchema.optional(),
};

const PrefabSchema = z.strictObject(prefabShape);

const EntitySchema = z.strictObject({
	id: z
		.string()
		.min(1)
		.refine((s) => !s.startsWith("__"), 'ids starting with "__" are reserved'),
	prefab: z
		.string()
		.optional()
		.describe("Prefab deep-merged under this entity (entity fields win)."),
	...prefabShape,
	spawner: SpawnerSchema.optional(),
});

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const SceneObjectSchema = z.strictObject({
	$schema: z.string().optional(),
	version: z.literal(1).default(1),
	environment: z
		.strictObject({
			preset: z.enum(["outdoor", "studio"]).default("outdoor"),
			hdri: z
				.string()
				.optional()
				.describe(
					"Equirect .hdr URL; the outdoor preset has a bundled default.",
				),
			splat: z
				.strictObject({
					url: z.string().min(1),
					position: Vec3S.default([0, 0, 0]),
					rotation: QuatS.default([0, 0, 0, 1]),
					scale: z.number().positive().default(1),
					envFromSplat: z
						.boolean()
						.default(false)
						.describe(
							"Image-based lighting from the capture: a cube capture at the splat's bounding-box centre, PMREM-filtered once at load. Replaces the preset's environment map (the background stays).",
						),
					floorY: z
						.number()
						.default(0)
						.describe(
							"World y of the capture's floor (after the transform); places the invisible shadow-catcher plane.",
						),
					exposure: z
						.number()
						.positive()
						.default(1)
						.describe(
							"Splat colour multiplier (linear) before tone mapping. Compensates the tone mapper's compression; 1 = as captured.",
						),
					saturation: z
						.number()
						.nonnegative()
						.default(1)
						.describe(
							"Splat colour saturation before tone mapping (1 = as captured). Compensates AgX desaturation.",
						),
				})
				.optional()
				.describe(
					"A Gaussian-splat capture (.spz, .ply, .splat or .ksplat) drawn with the meshes. Splats neither cast nor receive shadows; a shadow catcher at `floorY` shows mesh shadows on the capture floor.",
				),
			fog: z
				.union([
					z.literal(false),
					z.strictObject({
						near: nonNeg()
							.optional()
							.describe(
								"metres from the camera (view depth). Default: studio 14, outdoor 25.",
							),
						far: nonNeg()
							.optional()
							.describe(
								"Fully fogged from here. Default: studio 42, outdoor 110.",
							),
						color: z
							.string()
							.optional()
							.describe(
								"Default: studio = backdrop.horizon; outdoor = the HDRI's horizon colour in the view direction.",
							),
					}),
				])
				.optional()
				.describe(
					"Range fog that hides the ground's far edge. `false` disables it. Defaults per preset (studio near 14 / far 42, outdoor near 25 / far 110).",
				),
			backdrop: z
				.strictObject({
					horizon: z.string().default(ENV_DEFAULTS.backdrop.horizon),
					zenith: z.string().default(ENV_DEFAULTS.backdrop.zenith),
				})
				.prefault({})
				.describe(
					"Studio background: a vertical gradient from `horizon` (eye level and below) to `zenith` (overhead). Ignored by the outdoor preset.",
				),
			ground: z
				.strictObject({
					y: z.number().default(0),
					size: z.number().positive().default(50),
					color: z.string().default("#808080"),
					roughness: z.number().min(0).max(1).default(0.9),
					visible: z.boolean().default(true),
				})
				.optional()
				.describe(
					"Static ground plane collider, plus a visible plane unless `visible: false`.",
				),
		})
		.prefault({}),
	bounds: z
		.strictObject({
			min: Vec2.describe("[x, z]"),
			max: Vec2.describe("[x, z]"),
			height: z.number().positive().default(4),
			thickness: z.number().positive().default(0.5),
		})
		.optional()
		.describe(
			"Invisible static walls around [min, max] in XZ, from y = 0 up to `height`.",
		),
	lighting: z
		.strictObject({
			sun: z
				.strictObject({
					direction: Vec3S.default([0.5, 1, 0.3]).describe(
						"Direction from the scene towards the sun.",
					),
					intensity: nonNeg().default(3),
					color: z.string().default("#ffffff"),
				})
				.prefault({}),
		})
		.prefault({}),
	post: z
		.strictObject({
			exposure: z.number().positive().default(1),
			toneMapping: z.enum(["agx", "aces", "none"]).default("agx"),
			bloom: z
				.strictObject({
					enabled: z.boolean().default(true),
					strength: nonNeg().default(0.3),
					threshold: nonNeg()
						.default(2)
						.describe(
							"Linear HDR luminance (before tone mapping) a pixel must exceed to bloom. The default only catches specular highlights and emissives, not sunlit white surfaces.",
						),
				})
				.prefault({}),
			ao: z
				.strictObject({
					enabled: z.boolean().default(true),
					radius: z.number().positive().default(0.5),
				})
				.prefault({}),
			style: z
				.enum(["pbr", "toon"])
				.default("pbr")
				.describe(
					'Art style. "toon": cel-banded mesh lighting (lit standard materials become ToonNodeMaterial), ink outlines from the mesh-only depth/normal prepass, and a posterised splat grade, tuned by `toon`. "pbr" (default) ignores `toon`.',
				),
			toon: z
				.strictObject({
					bands: z
						.number()
						.int()
						.min(2)
						.max(8)
						.default(3)
						.describe("Sun-light tones, shadow tone included."),
					shadowTone: z
						.number()
						.min(0)
						.max(1)
						.default(0)
						.describe("Sun light kept by the darkest band (0 = ambient only)."),
					terminator: z
						.number()
						.min(-1)
						.max(1)
						.default(0)
						.describe("Added to N·L before banding; > 0 widens the lit bands."),
					rim: nonNeg()
						.default(0.35)
						.describe(
							"Sun-side rim light strength (per-material toonRim scales it).",
						),
					rimWidth: z.number().min(0).max(1).default(0.3),
					specular: nonNeg()
						.default(0.6)
						.describe(
							"Stepped highlight strength (per-material toonSpecular scales it).",
						),
					outline: z
						.strictObject({
							enabled: z.boolean().default(true),
							width: z
								.number()
								.positive()
								.max(4)
								.default(1)
								.describe("CSS pixels (scaled by the device pixel ratio)."),
							color: z.string().default("#1a1418"),
							opacity: z.number().min(0).max(1).default(1),
							depthThreshold: z
								.number()
								.positive()
								.default(0.04)
								.describe(
									"Relative inverse-depth Laplacian that starts a line.",
								),
							normalThreshold: z
								.number()
								.positive()
								.max(2)
								.default(0.35)
								.describe(
									"1 - cos(angle) between neighbour normals that starts a crease line.",
								),
						})
						.prefault({}),
					splat: z
						.strictObject({
							levels: z
								.number()
								.int()
								.min(2)
								.max(32)
								.default(5)
								.describe("Posterised lightness steps of the splat."),
							saturation: nonNeg().default(1.15),
							strength: z
								.number()
								.min(0)
								.max(1)
								.default(1)
								.describe("Blend of the splat grade with the source colour."),
							shadowTint: z.string().default("#4a5662"),
							highlightTint: z.string().default("#fff2df"),
						})
						.prefault({}),
				})
				.prefault({}),
		})
		.prefault({}),
	camera: z
		.strictObject({
			controller: z.enum(["thirdPerson", "orbit", "fly"]).default("orbit"),
			presets: z
				.record(
					z.string(),
					z.strictObject({
						position: Vec3S,
						target: Vec3S.default([0, 0, 0]),
						fov: z.number().positive().default(50),
					}),
				)
				.default({}),
		})
		.prefault({}),
	prefabs: z.record(z.string(), PrefabSchema).default({}),
	entities: z.array(EntitySchema).default([]),
	sim: z
		.strictObject({
			build: z.enum(["deterministic", "fast"]).default("deterministic"),
			seed: z.number().int().nonnegative().max(0xffffffff).default(1),
			gravity: z.number().default(-9.81),
		})
		.prefault({}),
});

export type Prefab = z.output<typeof PrefabSchema>;
export type SceneEntity = z.output<typeof EntitySchema>;

export const SceneSchema = SceneObjectSchema.superRefine((scene, ctx) => {
	for (const { path, message } of crossFieldIssues(scene)) {
		ctx.addIssue({ code: "custom", path, message });
	}
});

export type SceneInput = z.input<typeof SceneSchema>;
export type Scene = z.output<typeof SceneSchema>;

export class SceneError extends Error {
	/** Where the problem is, e.g. `entities[3].prefab`. Empty for the scene root. */
	readonly path: string;

	constructor(path: string, message: string) {
		super(path ? `${path}: ${message}` : message);
		this.name = "SceneError";
		this.path = path;
	}
}

/** Validates a scene and fills defaults. Throws `SceneError` (first problem found). */
export function parseScene(input: unknown): Scene {
	const r = SceneSchema.safeParse(input);
	if (r.success) return r.data;
	const issue = r.error.issues[0];
	throw new SceneError(
		formatPath(issue?.path ?? []),
		issue?.message ?? "invalid scene",
	);
}

export function formatPath(path: readonly PropertyKey[]): string {
	let out = "";
	for (const k of path) {
		if (typeof k === "number") out += `[${k}]`;
		else out += out ? `.${String(k)}` : String(k);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Prefab merge and collider resolution (shared with expand.ts)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge; `over` wins. Arrays and tuples are replaced, not merged. */
export function deepMerge<T extends Record<string, unknown>>(
	base: Partial<T>,
	over: T,
): T {
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(over)) {
		if (v === undefined) continue;
		const b = out[k];
		out[k] = isPlainObject(b) && isPlainObject(v) ? deepMerge(b, v) : v;
	}
	return out as T;
}

/** The entity with its prefab (if any) merged underneath. */
export function mergePrefab(
	scene: Pick<Scene, "prefabs">,
	e: SceneEntity,
): SceneEntity {
	const p =
		e.prefab !== undefined && Object.hasOwn(scene.prefabs, e.prefab)
			? scene.prefabs[e.prefab]
			: undefined;
	if (!p) return e;
	const merged = deepMerge<SceneEntity>(p, e);
	// An entity collider replaces the prefab's wholesale (no cross-shape key mixing).
	if (e.body?.collider !== undefined && merged.body) {
		merged.body = { ...merged.body, collider: e.body.collider };
	}
	// An entity primitive/gltf replaces the prefab's mesh kind.
	if (e.mesh && merged.mesh && p.mesh) {
		if (e.mesh.primitive !== undefined && e.mesh.gltf === undefined) {
			const { gltf: _g, ...rest } = merged.mesh;
			merged.mesh = rest;
		} else if (e.mesh.gltf !== undefined && e.mesh.primitive === undefined) {
			const { primitive: _p, ...rest } = merged.mesh;
			merged.mesh = rest;
		}
	}
	return merged;
}

export function bodyType(e: Prefab): "dynamic" | "static" | "kinematic" {
	return e.body?.type ?? (e.character ? "kinematic" : "dynamic");
}

const CYLINDER_SEGMENTS = 16;

export type ColliderResult =
	| { collider: ColliderJson; pendingHull: boolean }
	| { error: string };

/** Resolves `collider` (explicit or `'auto'`) for an entity or prefab that has a body. */
export function resolveCollider(e: Prefab): ColliderResult {
	const c = e.body?.collider ?? "auto";
	const type = bodyType(e);
	let collider: ColliderJson;
	let pendingHull = false;
	if (c !== "auto") {
		collider = c;
	} else {
		const mesh = e.mesh;
		if (!mesh || (mesh.primitive === undefined && mesh.gltf === undefined)) {
			return {
				error:
					"collider 'auto' needs a mesh; give an explicit collider instead",
			};
		}
		const [sx, sy, sz] = e.transform?.scale ?? ENTITY_DEFAULTS.scale;
		switch (mesh.primitive) {
			case "box":
				collider = { shape: "box", halfExtents: [sx / 2, sy / 2, sz / 2] };
				break;
			case "sphere":
				collider = { shape: "sphere", radius: Math.max(sx, sy, sz) / 2 };
				break;
			case "capsule": {
				const radius = sx / 2;
				const halfHeight = sy / 2 - radius;
				if (!(halfHeight > 0)) {
					return {
						error: `collider 'auto' on a capsule needs scale.y > scale.x (got ${sx} x ${sy})`,
					};
				}
				collider = { shape: "capsule", halfHeight, radius };
				break;
			}
			case "plane":
				collider = { shape: "plane" };
				break;
			case "cylinder":
				collider = {
					shape: "convexHull",
					points: cylinderHull(sx / 2, sy / 2, sz / 2),
				};
				break;
			default:
				collider = { shape: "convexHull", points: [] };
				pendingHull = true;
		}
	}
	if (collider.shape === "plane" && type !== "static") {
		return { error: "a plane collider is only allowed on a static body" };
	}
	if (collider.shape === "trimesh" && type === "dynamic") {
		return {
			error: "a trimesh collider is only allowed on a static or kinematic body",
		};
	}
	return { collider, pendingHull };
}

function cylinderHull(rx: number, hy: number, rz: number): number[] {
	const pts: number[] = [];
	for (let i = 0; i < CYLINDER_SEGMENTS; i++) {
		const a = (i / CYLINDER_SEGMENTS) * Math.PI * 2;
		const x = Math.cos(a) * rx;
		const z = Math.sin(a) * rz;
		pts.push(x, -hy, z, x, hy, z);
	}
	return pts;
}

// ---------------------------------------------------------------------------
// Cross-field checks
// ---------------------------------------------------------------------------

interface Issue {
	path: (string | number)[];
	message: string;
}

function crossFieldIssues(scene: z.output<typeof SceneObjectSchema>): Issue[] {
	const issues: Issue[] = [];
	const firstIndex = new Map<string, number>();
	scene.entities.forEach((raw, i) => {
		const at = (...p: (string | number)[]) => ["entities", i, ...p];
		const prev = firstIndex.get(raw.id);
		if (prev !== undefined) {
			issues.push({
				path: at("id"),
				message: `duplicate entity id "${raw.id}" (first used by entities[${prev}])`,
			});
		} else {
			firstIndex.set(raw.id, i);
		}
		if (raw.prefab !== undefined && !Object.hasOwn(scene.prefabs, raw.prefab)) {
			issues.push({
				path: at("prefab"),
				message: `unknown prefab "${raw.prefab}"`,
			});
			return;
		}
		const e = mergePrefab(scene, raw);

		if (
			e.mesh &&
			(e.mesh.primitive === undefined) === (e.mesh.gltf === undefined)
		) {
			issues.push({
				path: at("mesh"),
				message: "mesh needs exactly one of `primitive` or `gltf`",
			});
		}

		if (e.spawner) {
			const sp = e.spawner;
			if (e.mesh || e.body || e.character) {
				issues.push({
					path: at("spawner"),
					message:
						"a spawner entity cannot also have a mesh, body or character (put them on the prefab)",
				});
			}
			const p = Object.hasOwn(scene.prefabs, sp.prefab)
				? scene.prefabs[sp.prefab]
				: undefined;
			if (!p) {
				issues.push({
					path: at("spawner", "prefab"),
					message: `unknown prefab "${sp.prefab}"`,
				});
			} else if (!p.body) {
				issues.push({
					path: at("spawner", "prefab"),
					message: `prefab "${sp.prefab}" has no body to spawn`,
				});
			} else if (p.character) {
				issues.push({
					path: at("spawner", "prefab"),
					message: `prefab "${sp.prefab}" has a character`,
				});
			} else {
				const r = resolveCollider(p);
				if ("error" in r) {
					issues.push({
						path: at("spawner", "prefab"),
						message: `prefab "${sp.prefab}": ${r.error}`,
					});
				}
			}
			if (
				![0, 1, 2].every((k) => (sp.area.min[k] ?? 0) <= (sp.area.max[k] ?? 0))
			) {
				issues.push({
					path: at("spawner", "area"),
					message: "area.min must be <= area.max on every axis",
				});
			}
		} else if (!e.mesh && !e.body) {
			issues.push({
				path: at(),
				message: "entity needs a mesh, body or spawner",
			});
		}

		let shape: ColliderJson["shape"] | undefined;
		if (e.body) {
			const r = resolveCollider(e);
			if ("error" in r)
				issues.push({ path: at("body", "collider"), message: r.error });
			else shape = r.collider.shape;
		}

		if (e.character) {
			if (
				!e.body ||
				bodyType(e) !== "kinematic" ||
				(shape !== undefined && shape !== "capsule")
			) {
				issues.push({
					path: at("character"),
					message: `character requires a kinematic body with a capsule collider (got ${
						e.body ? `${bodyType(e)} ${shape ?? "invalid"}` : "no body"
					})`,
				});
			}
		}
	});
	return issues;
}
