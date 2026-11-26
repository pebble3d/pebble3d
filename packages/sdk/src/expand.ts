import type {
	AnimClipSpec,
	AnimState,
	MaterialSpec,
	MeshSpec,
	RenderEntity,
	RenderSettings,
} from "@pebble3d/renderer/types";
import {
	bodyType,
	ENTITY_DEFAULTS,
	ENV_DEFAULTS,
	mergePrefab,
	type Prefab,
	resolveCollider,
	type Scene,
	type SceneEntity,
	SceneError,
} from "./schema.ts";
import type {
	BodyJson,
	CharacterJson,
	ColliderJson,
	EntityDescJson,
	ExpandedScene,
	Quat,
	SimEntry,
	Vec3,
} from "./types.ts";

/**
 * Turns a parsed scene into sim descs (spawned in order: ground, bounds, then
 * entities) and render entities.
 *
 * Conventions:
 * - Primitive meshes are unit-sized, so `MeshSpec.size` = `transform.scale` and the
 *   render entity's `scale` is `[1,1,1]`. glTF meshes keep `scale` = `transform.scale`.
 * - `simId` is never set here; ids exist only once `World.spawn` runs.
 * - `pendingHulls` lists sceneIds whose convex hull must be filled in from the
 *   glTF vertices before spawning. The empty hull is at `desc.body.collider`,
 *   or at `desc.spawner.template.body.collider` for a spawner.
 */
export function expandScene(scene: Scene): ExpandedScene {
	const sim: SimEntry[] = [];
	const render: RenderEntity[] = [];
	const pendingHulls: string[] = [];

	const ground = scene.environment.ground;
	if (ground) {
		sim.push({
			sceneId: "__ground",
			desc: {
				name: "__ground",
				position: [0, ground.y, 0],
				rotation: [0, 0, 0, 1],
				body: staticBody({ shape: "plane" }),
			},
		});
		if (ground.visible) {
			render.push({
				sceneId: "__ground",
				mesh: {
					kind: "primitive",
					primitive: "plane",
					size: [ground.size, 1, ground.size],
				},
				material: {
					color: ground.color,
					roughness: ground.roughness,
					metalness: 0,
				},
				scale: [1, 1, 1],
				dynamic: false,
				character: false,
				castShadow: false,
				visualOffset: [0, 0, 0],
			});
		}
	}

	if (scene.bounds) {
		const { min, max, height, thickness: t } = scene.bounds;
		const [x0, z0] = min;
		const [x1, z1] = max;
		const cx = (x0 + x1) / 2;
		const cz = (z0 + z1) / 2;
		const hx = (x1 - x0) / 2 + t;
		const hz = (z1 - z0) / 2 + t;
		const hy = height / 2;
		const walls: [string, Vec3, Vec3][] = [
			["minX", [x0 - t / 2, hy, cz], [t / 2, hy, hz]],
			["maxX", [x1 + t / 2, hy, cz], [t / 2, hy, hz]],
			["minZ", [cx, hy, z0 - t / 2], [hx, hy, t / 2]],
			["maxZ", [cx, hy, z1 + t / 2], [hx, hy, t / 2]],
		];
		for (const [side, position, halfExtents] of walls) {
			const sceneId = `__bounds.${side}`;
			sim.push({
				sceneId,
				desc: {
					name: sceneId,
					position,
					rotation: [0, 0, 0, 1],
					body: staticBody({ shape: "box", halfExtents }),
				},
			});
		}
	}

	scene.entities.forEach((raw, index) => {
		const e = mergePrefab(scene, raw);
		const transform = resolveTransform(e);

		if (e.spawner) {
			const sp = e.spawner;
			const prefab = scene.prefabs[sp.prefab];
			if (!prefab?.body) {
				throw new SceneError(
					`entities[${index}].spawner.prefab`,
					`prefab "${sp.prefab}" has no body to spawn`,
				);
			}
			const tplTransform = resolveTransform(prefab);
			const tplBody = bodyJson(prefab, `entities[${index}].spawner.prefab`);
			if (tplBody.pendingHull) pendingHulls.push(e.id);
			sim.push({
				sceneId: e.id,
				desc: {
					name: e.id,
					position: transform.position,
					rotation: transform.rotation,
					spawner: {
						template: {
							name: `${e.id}:${sp.prefab}`,
							position: [0, 0, 0],
							rotation: tplTransform.rotation,
							body: tplBody.body,
						},
						rate: sp.rate,
						count: sp.count,
						areaMin: sp.area.min,
						areaMax: sp.area.max,
						seed: sp.seed ?? (scene.sim.seed + index) >>> 0,
					},
				},
			});
			if (prefab.mesh) {
				render.push({
					...renderBase(e.id, prefab, tplTransform.scale),
					dynamic: bodyType(prefab) !== "static",
					templateKey: e.id,
				});
			}
			return;
		}

		let visualOffset: Vec3 = [0, 0, 0];
		if (e.body) {
			const b = bodyJson(e, `entities[${index}].body.collider`);
			if (b.pendingHull) pendingHulls.push(e.id);
			const desc: EntityDescJson = {
				name: e.id,
				position: transform.position,
				rotation: transform.rotation,
				body: b.body,
			};
			if (e.character) {
				desc.character = characterJson(e);
				const c = b.body.collider;
				if (c.shape !== "capsule") {
					throw new SceneError(
						`entities[${index}].character`,
						"character requires a capsule collider",
					);
				}
				if (e.mesh?.gltf) {
					visualOffset = [0, -(c.halfHeight + c.radius), 0];
				}
			}
			sim.push({ sceneId: e.id, desc });
		}

		if (e.mesh) {
			render.push({
				...renderBase(e.id, e, transform.scale),
				dynamic: e.body !== undefined && bodyType(e) !== "static",
				character: e.character !== undefined,
				visualOffset,
				// Body-less decor has no sim slot to place it, so it carries its own transform.
				...(e.body === undefined
					? { position: transform.position, rotation: transform.rotation }
					: {}),
			});
		}
	});

	return { settings: renderSettings(scene), sim, render, pendingHulls };
}

function renderSettings(scene: Scene): RenderSettings {
	const { environment: env, post, lighting, camera } = scene;
	const settings: RenderSettings = {
		preset: env.preset,
		exposure: post.exposure,
		toneMapping: post.toneMapping,
		bloom: { ...post.bloom },
		ao: { ...post.ao },
		sun: {
			direction: lighting.sun.direction,
			intensity: lighting.sun.intensity,
			color: lighting.sun.color,
		},
		cameraPresets: Object.fromEntries(
			Object.entries(camera.presets).map(([k, v]) => [
				k,
				{ position: v.position, target: v.target, fov: v.fov },
			]),
		),
		controller: camera.controller,
	};
	settings.fog =
		env.fog === false
			? false
			: {
					near: env.fog?.near ?? ENV_DEFAULTS.fog[env.preset].near,
					far: env.fog?.far ?? ENV_DEFAULTS.fog[env.preset].far,
					...(env.fog?.color !== undefined ? { color: env.fog.color } : {}),
				};
	settings.backdrop = { ...env.backdrop };
	if (env.hdri !== undefined) settings.hdri = env.hdri;
	if (env.splat) settings.splat = { ...env.splat };
	if (post.style === "toon")
		settings.toon = {
			...post.toon,
			outline: { ...post.toon.outline },
			splat: { ...post.toon.splat },
		};
	return settings;
}

/** Fresh arrays, so callers may mutate the output without touching the scene or defaults. */
function resolveTransform(e: Prefab): {
	position: Vec3;
	rotation: Quat;
	scale: Vec3;
} {
	const t = e.transform;
	return {
		position: [...(t?.position ?? ENTITY_DEFAULTS.position)],
		rotation: [...(t?.rotation ?? ENTITY_DEFAULTS.rotation)],
		scale: [...(t?.scale ?? ENTITY_DEFAULTS.scale)],
	};
}

function staticBody(collider: ColliderJson): BodyJson {
	return { type: "static", ...ENTITY_DEFAULTS.body, collider };
}

function bodyJson(
	e: Prefab,
	path: string,
): { body: BodyJson; pendingHull: boolean } {
	const r = resolveCollider(e);
	if ("error" in r) throw new SceneError(path, r.error);
	const b = e.body ?? {};
	const body: BodyJson = {
		type: bodyType(e),
		friction: b.friction ?? ENTITY_DEFAULTS.body.friction,
		restitution: b.restitution ?? ENTITY_DEFAULTS.body.restitution,
		linearDamping: b.linearDamping ?? ENTITY_DEFAULTS.body.linearDamping,
		angularDamping: b.angularDamping ?? ENTITY_DEFAULTS.body.angularDamping,
		ccd: b.ccd ?? ENTITY_DEFAULTS.body.ccd,
		collider: r.collider,
	};
	if (b.mass !== undefined) body.mass = b.mass;
	return { body, pendingHull: r.pendingHull };
}

function characterJson(e: SceneEntity): CharacterJson {
	const c = e.character ?? {};
	const d = ENTITY_DEFAULTS.character;
	const out: CharacterJson = {
		speed: c.speed ?? d.speed,
		sprintSpeed: c.sprintSpeed ?? d.sprintSpeed,
		jumpSpeed: c.jumpSpeed ?? d.jumpSpeed,
		maxSlopeDeg: c.maxSlopeDeg ?? d.maxSlopeDeg,
		stepHeight: c.stepHeight ?? d.stepHeight,
		snap: c.snap ?? d.snap,
		accel: c.accel ?? d.accel,
	};
	// Only written when on, so default descs stay byte-identical.
	if (c.ridePlatforms === true) out.ridePlatforms = true;
	return out;
}

function renderBase(sceneId: string, e: Prefab, scale: Vec3) {
	const mesh = e.mesh;
	const m = mesh?.material;
	const material: MaterialSpec = {
		color: m?.color ?? ENTITY_DEFAULTS.material.color,
		roughness: m?.roughness ?? ENTITY_DEFAULTS.material.roughness,
		metalness: m?.metalness ?? ENTITY_DEFAULTS.material.metalness,
	};
	if (m?.emissive !== undefined) material.emissive = m.emissive;
	let spec: MeshSpec | undefined;
	let renderScale: Vec3 = [1, 1, 1];
	if (mesh?.primitive) {
		spec = {
			kind: "primitive",
			primitive: mesh.primitive,
			size: [scale[0], scale[1], scale[2]],
		};
	} else if (mesh?.gltf) {
		spec = { kind: "gltf", url: mesh.gltf.url };
		if (mesh.gltf.animations) {
			const anims: Partial<Record<AnimState, AnimClipSpec>> = {};
			for (const [k, v] of Object.entries(mesh.gltf.animations)) {
				anims[k as AnimState] = typeof v === "string" ? { clip: v } : { ...v };
			}
			spec.animations = anims;
		}
		if (mesh.gltf.look) spec.look = { ...mesh.gltf.look };
		renderScale = [scale[0], scale[1], scale[2]];
	}
	const base: RenderEntity = {
		sceneId,
		material,
		scale: renderScale,
		dynamic: false,
		character: false,
		castShadow: mesh?.castShadow ?? ENTITY_DEFAULTS.castShadow,
		visualOffset: [0, 0, 0],
	};
	if (spec) base.mesh = spec;
	return base;
}
