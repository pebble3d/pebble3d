import type { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import {
	type AnimationClip,
	BoxGeometry,
	type BufferGeometry,
	CapsuleGeometry,
	Color,
	CylinderGeometry,
	type Material,
	Matrix4,
	Mesh,
	MeshStandardNodeMaterial,
	Object3D,
	PerspectiveCamera,
	PlaneGeometry,
	type RenderPipeline,
	type RenderTarget,
	Scene,
	SphereGeometry,
	Vector3,
	WebGPURenderer,
} from "three/webgpu";
import {
	defaultAssetBase,
	defaultWebglFallback,
	resolveAssetUrl,
} from "./asset-base.ts";
import { CharacterView } from "./character/character-view.ts";
import type { CameraController } from "./controllers/controller.ts";
import { FlyController } from "./controllers/fly.ts";
import { OrbitController } from "./controllers/orbit.ts";
import {
	createSun,
	envFromSplat,
	type LoadedEnvironment,
	loadEnvironment,
	updateCsmFrustums,
} from "./defaults/lighting.ts";
import {
	buildPipeline,
	type DepthOfFieldControls,
} from "./defaults/pipeline.ts";
import { InstanceRegistry, readSlot } from "./dynamics/instances.ts";
import { showFallbackNotice } from "./fallback-notice.ts";
import { renderWithFrozenMatrices } from "./frame-matrices.ts";
import { applyLook } from "./gltf/look.ts";
import { estimateTextureBytes } from "./gltf/texture-memory.ts";
import { placeStatic } from "./place.ts";
import {
	createShadowCatcher,
	type LoadedSplat,
	loadSplat,
	SPLAT_BUDGET,
	type SplatColorControls,
	SplatLoadError,
} from "./splat/splat-layer.ts";
import { applySplatGrade } from "./style/splat-grade.ts";
import {
	setToonUniforms,
	stylizeToon,
	ToonNodeMaterial,
} from "./style/toon.ts";
import type {
	AnimClipSpec,
	AnimState,
	LookSpec,
	MaterialSpec,
	MeshSpec,
	RenderEntity,
	RenderSettings,
	RenderStats,
} from "./types.ts";

export interface EngineRenderer {
	three: { renderer: WebGPURenderer; scene: Scene; camera: PerspectiveCamera };
	/** Orbit/fly controller per `settings.controller`; null for `thirdPerson`. */
	controller: CameraController | null;
	csm: CSMShadowNode;
	instances: InstanceRegistry;
	/** Live colour controls of the loaded splat (exposure, saturation, tint), or null. */
	splatColor: SplatColorControls | null;
	/** Opt-in depth of field (off by default; built on first enable). */
	dof: DepthOfFieldControls;
	addEntities(
		list: RenderEntity[],
		slotOf: (simId: number) => number,
	): Promise<void>;
	addSpawned(templateKey: string, slot: number): void;
	removeSlot(slot: number): void;
	sync(prev: Float32Array, curr: Float32Array, alpha: number): void;
	characterObject(simId: number): Object3D | undefined;
	/**
	 * Animation + facing driver for a character added by `addEntities`. `clipMap` maps
	 * states to clip names in its glTF (a primitive character has no clips; it still turns).
	 */
	attachCharacter(
		simId: number,
		clipMap: Partial<Record<AnimState, AnimClipSpec>>,
	): CharacterView;
	render(dt: number): void;
	setCameraPreset(name: string): void;
	resize(w: number, h: number, dpr: number): void;
	stats(): RenderStats;
	hullPoints(
		url: string,
		scale: [number, number, number],
	): Promise<Float32Array>;
	/**
	 * Loads a glTF through the renderer's cached, KTX2-capable loader (one request per url;
	 * its textures count toward `stats().textureMB`). For app-managed models: clone the scene
	 * per instance (skinned: `SkeletonUtils.clone`) and never mutate the cached one, with
	 * one exception: `stylize(gltf.scene)` once, before the first clone (see `stylize`).
	 */
	loadGltf(url: string): Promise<GLTF>;
	/**
	 * `url` resolved against the renderer's asset base (see `createRenderer`'s `assetBase`):
	 * for app-loaded files (audio, JSON) that sit beside the scene's assets.
	 */
	assetUrl(url: string): string;
	/** The scene's art style: `"toon"` when `settings.toon` is set, else `"pbr"`. */
	style: "pbr" | "toon";
	/**
	 * Toon style: swaps the standard materials under `root` for `ToonNodeMaterial` copies
	 * (no-op in the PBR style), one copy per source material. Call it before keeping
	 * material refs. Use it on app-built objects, and on an app-managed model's cached
	 * `loadGltf` scene once before cloning it: every clone then shares the toon copies (in a
	 * toon scene every consumer of that url wants them). Entities and their glTFs are
	 * stylised by the renderer itself, on their own clones.
	 */
	stylize(root: Object3D): void;
	reportError(msg: string): void;
	errors(): string[];
	dispose(): void;
}

/** How an entity is drawn: an instance in a shared InstancedMesh, or its own Object3D. */
type Visual =
	| {
			kind: "instanced";
			key: string;
			geometry: BufferGeometry;
			material: Material;
			castShadow: boolean;
	  }
	| { kind: "object"; build: () => Object3D };

interface DrivenObject {
	slot: number;
	root: Object3D;
}

const DEFAULT_CAMERA = {
	position: [6, 4, 8],
	target: [0, 1, 0],
	fov: 50,
} as const;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 500;
const FPS_SMOOTHING = 0.1;

const _v1 = new Vector3();
const _v2 = new Vector3();

export function primitiveGeometry(
	primitive: Extract<MeshSpec, { kind: "primitive" }>["primitive"],
	size: [number, number, number],
): BufferGeometry {
	const [sx, sy, sz] = size;
	switch (primitive) {
		case "box":
			return new BoxGeometry(sx, sy, sz);
		case "sphere": {
			const g = new SphereGeometry(0.5, 48, 24);
			g.scale(sx, sy, sz);
			return g;
		}
		case "capsule": {
			// diameter x by total height y (schema convention); z stretches the cross-section
			const r = sx / 2;
			const g = new CapsuleGeometry(r, Math.max(0, sy - sx), 8, 24);
			if (sz !== sx && sx > 0) g.scale(1, 1, sz / sx);
			return g;
		}
		case "cylinder": {
			const g = new CylinderGeometry(0.5, 0.5, 1, 32);
			g.scale(sx, sy, sz);
			return g;
		}
		case "plane": {
			const g = new PlaneGeometry(sx, sz);
			g.rotateX(-Math.PI / 2);
			return g;
		}
	}
}

function materialKey(m: MaterialSpec): string {
	return `${m.color}|${m.roughness}|${m.metalness}|${m.emissive ?? ""}`;
}

function isAnimated(
	spec: Extract<MeshSpec, { kind: "gltf" }>,
	gltf: GLTF,
): boolean {
	return (
		gltf.animations.length > 0 ||
		(spec.animations !== undefined && Object.keys(spec.animations).length > 0)
	);
}

function collectMeshes(root: Object3D): Mesh[] {
	const out: Mesh[] = [];
	root.traverse((o) => {
		if ((o as Mesh).isMesh) out.push(o as Mesh);
	});
	return out;
}

function setShadows(root: Object3D, cast: boolean): void {
	root.traverse((o) => {
		if ((o as Mesh).isMesh) {
			o.castShadow = cast;
			o.receiveShadow = true;
		}
	});
}

/** Shadow-catcher size when the splat failed to load (no bounds to fit). */
const FALLBACK_CATCHER_SIZE = 80;
/** The catcher extends this far (fraction) beyond the capture's XZ footprint. */
const CATCHER_MARGIN = 0.25;

export async function createRenderer(
	canvas: HTMLCanvasElement,
	settings: RenderSettings,
	opts: {
		backend: "webgpu" | "webgl";
		/** `?debug=splatOnly`: draw only the splat, untouched by post (colour reference). */
		splatOnly?: boolean;
		/** Basis transcoder location for KTX2 glTF textures. Default `"/basis/"`. */
		transcoderPath?: string;
		/**
		 * Prefix for root-absolute asset URLs (`/assets/...` in the scene's gltf, splat and
		 * hdri fields, `loadGltf`, and the transcoder path). Default `defaultAssetBase()`:
		 * `VITE_PEBBLE3D_ASSET_BASE`, else Vite's `BASE_URL`, else `"/"` (no change).
		 */
		assetBase?: string;
		/**
		 * Opt-in: when `backend` is `"webgpu"` but the browser has no WebGPU, keep the WebGL
		 * backend and show a small dismissible notice instead of throwing
		 * `BackendUnavailable`. Default `defaultWebglFallback()`: on only for builds with
		 * `VITE_PEBBLE3D_WEBGL_FALLBACK=1` or pages with `?webglFallback=1`.
		 */
		webglFallback?: boolean;
	},
): Promise<EngineRenderer> {
	const assetBase = opts.assetBase ?? defaultAssetBase();
	const assetUrl = (url: string): string => resolveAssetUrl(url, assetBase);
	if (settings.hdri !== undefined || settings.splat !== undefined) {
		settings = { ...settings };
		if (settings.hdri !== undefined) settings.hdri = assetUrl(settings.hdri);
		if (settings.splat !== undefined)
			settings.splat = { ...settings.splat, url: assetUrl(settings.splat.url) };
	}
	const renderer = new WebGPURenderer({
		canvas,
		antialias: false,
		forceWebGL: opts.backend === "webgl",
	});
	await renderer.init();
	const isWebGPU =
		(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ===
		true;
	if (
		opts.backend === "webgpu" &&
		!isWebGPU &&
		(opts.webglFallback ?? defaultWebglFallback())
	) {
		console.info("WebGPU unavailable, using the WebGL fallback");
		showFallbackNotice();
	} else if (opts.backend === "webgpu" && !isWebGPU) {
		renderer.dispose();
		throw new Error(
			"BackendUnavailable: webgpu (WebGPURenderer fell back to WebGL)",
		);
	}
	renderer.shadowMap.enabled = true;
	renderer.info.autoReset = false;

	const errorList: string[] = [];
	const reportError = (msg: string): void => {
		if (errorList.includes(msg)) return;
		errorList.push(msg);
		console.error(msg);
	};

	const scene = new Scene();
	const w0 = canvas.clientWidth || canvas.width || 1;
	const h0 = canvas.clientHeight || canvas.height || 1;
	const camera = new PerspectiveCamera(
		DEFAULT_CAMERA.fov,
		w0 / h0,
		CAMERA_NEAR,
		CAMERA_FAR,
	);
	camera.position.set(...DEFAULT_CAMERA.position);
	camera.lookAt(_v1.set(...DEFAULT_CAMERA.target));
	renderer.setSize(w0, h0, false);

	const { light, csm } = createSun(settings, camera);
	const toon = settings.toon ?? null;
	if (toon) setToonUniforms(toon);

	// The splat downloads while the environment loads. Every failure becomes a reported
	// SplatLoadError and the game continues without it.
	const splatCfg = settings.splat;
	const splatPromise: Promise<LoadedSplat | SplatLoadError | null> = splatCfg
		? loadSplat(splatCfg).catch((e: unknown) =>
				e instanceof SplatLoadError ? e : new SplatLoadError(splatCfg.url, e),
			)
		: Promise.resolve(null);

	let env: LoadedEnvironment;
	if (settings.preset === "outdoor" && !settings.hdri) {
		reportError(
			"EnvLoadError: outdoor preset without hdri, using studio environment",
		);
	}
	try {
		env = await loadEnvironment(renderer, settings);
	} catch {
		reportError(`EnvLoadError: ${settings.hdri}`);
		env = await loadEnvironment(renderer, { ...settings, preset: "studio" });
	}
	scene.environment = env.environment;
	scene.environmentIntensity = env.environmentIntensity;
	scene.background = env.background;
	scene.backgroundNode = env.backgroundNode;
	scene.fogNode = env.fogNode;

	const splatResult = await splatPromise;
	const splat = splatResult instanceof SplatLoadError ? null : splatResult;
	if (splatResult instanceof SplatLoadError) reportError(splatResult.message); // logs once
	let splatEnv: RenderTarget | null = null;
	if (splat) {
		if (splat.count > SPLAT_BUDGET)
			console.warn(
				`splat budget: ${splat.count} splats > ${SPLAT_BUDGET} (${splatCfg?.url})`,
			);
		if (opts.splatOnly) {
			splat.color.exposure.value = 1;
			splat.color.saturation.value = 1;
		}
		if (toon && !opts.splatOnly) applySplatGrade(splat.object, toon.splat);
		scene.add(splat.object);
		// Captured before the sun and meshes are in the scene: only the capture and the sky
		// are lit into it, and the CSM node never sees the cube camera.
		if (splatCfg?.envFromSplat && !opts.splatOnly) {
			try {
				splatEnv = envFromSplat(renderer, scene, splat.object);
				scene.environment = splatEnv.texture;
			} catch (err) {
				// Keep the preset environment; the scene still renders.
				splatEnv = null;
				reportError(
					`EnvFromSplatError: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}
	let catcher: Mesh | null = null;
	if (splatCfg) {
		// Sized and centred on the capture's XZ footprint (a fixed size without a splat).
		let size = FALLBACK_CATCHER_SIZE;
		_v1.set(0, 0, 0);
		const box = splat?.object.splatGeometry.boundingBox;
		if (splat && box) {
			const world = box.clone().applyMatrix4(splat.object.matrixWorld);
			size =
				Math.max(world.max.x - world.min.x, world.max.z - world.min.z) *
				(1 + CATCHER_MARGIN);
			world.getCenter(_v1);
		}
		catcher = createShadowCatcher(splatCfg.floorY, size);
		catcher.position.x = _v1.x;
		catcher.position.z = _v1.z;
		scene.add(catcher);
	}
	scene.add(light, light.target);

	const built = buildPipeline(renderer, scene, camera, settings, {
		splatOnly: opts.splatOnly === true,
	});
	const pipeline: RenderPipeline = built.pipeline;
	const instances = new InstanceRegistry(scene);

	let controller: CameraController | null = null;
	if (settings.controller === "orbit")
		controller = new OrbitController(camera, canvas);
	else if (settings.controller === "fly")
		controller = new FlyController(camera, canvas);

	// --- asset caches -------------------------------------------------------------------
	// One KTX2Loader for the renderer's lifetime; its transcoder is fetched lazily on the
	// first KTX2 texture, so glTFs without KTX2 never touch it.
	const ktx2Loader = new KTX2Loader()
		.setTranscoderPath(assetUrl(opts.transcoderPath ?? "/basis/"))
		.detectSupport(renderer);
	const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2Loader);
	const gltfPromises = new Map<string, Promise<GLTF>>();
	/** Estimated texture bytes of every loaded glTF (each url counted once: the promise is cached). */
	let textureBytes = 0;
	const loadGltf = (url: string): Promise<GLTF> => {
		let p = gltfPromises.get(url);
		if (!p) {
			p = gltfLoader.loadAsync(assetUrl(url)).then((gltf) => {
				textureBytes += estimateTextureBytes(gltf.scene);
				return gltf;
			});
			gltfPromises.set(url, p);
			p.catch(() => gltfPromises.delete(url));
		}
		return p;
	};
	/**
	 * The glTF scene with `look` applied, built once per (url, look): a skeleton-safe clone
	 * whose materials are look-adjusted copies, so the cached glTF and entities with other
	 * looks are untouched. No look: the cached scene itself.
	 */
	const lookedScenes = new Map<string, Object3D>();
	const lookedScene = (
		url: string,
		gltf: GLTF,
		look: LookSpec | undefined,
	): { scene: Object3D; lookKey: string } => {
		const noLook =
			!look ||
			(look.envIntensity === undefined &&
				(look.saturation === undefined || look.saturation === 1));
		if (noLook && !toon) return { scene: gltf.scene, lookKey: "" };
		const lookKey = noLook
			? "toon"
			: `${look?.envIntensity ?? ""}|${look?.saturation ?? ""}${toon ? "|toon" : ""}`;
		const key = `${url}|${lookKey}`;
		let scene = lookedScenes.get(key);
		if (!scene) {
			scene = cloneSkinned(gltf.scene);
			applyLook(scene, look);
			if (toon) stylizeToon(scene);
			lookedScenes.set(key, scene);
		}
		return { scene, lookKey };
	};
	const geometries = new Map<string, BufferGeometry>();
	const materials = new Map<string, MeshStandardNodeMaterial>();
	const ownedGeometries: BufferGeometry[] = [];

	const materialFor = (m: MaterialSpec): MeshStandardNodeMaterial => {
		const key = materialKey(m);
		let mat = materials.get(key);
		if (!mat) {
			const Ctor = toon ? ToonNodeMaterial : MeshStandardNodeMaterial;
			mat = new Ctor({
				color: new Color(m.color),
				roughness: m.roughness,
				metalness: m.metalness,
			});
			if (m.emissive) mat.emissive = new Color(m.emissive);
			materials.set(key, mat);
		}
		return mat;
	};
	const primitiveFor = (
		spec: Extract<MeshSpec, { kind: "primitive" }>,
	): BufferGeometry => {
		const key = `${spec.primitive}|${spec.size.join(",")}`;
		let g = geometries.get(key);
		if (!g) {
			g = primitiveGeometry(spec.primitive, spec.size);
			geometries.set(key, g);
			ownedGeometries.push(g);
		}
		return g;
	};

	/** Resolves how `e` is drawn; loads glTF. Returns null (after reporting) on failure. */
	const prepare = async (e: RenderEntity): Promise<Visual | null> => {
		const spec = e.mesh;
		if (!spec) return null;
		const dynamicProp = e.dynamic && !e.character;
		if (spec.kind === "primitive") {
			const geometry = primitiveFor(spec);
			const material = materialFor(e.material);
			if (dynamicProp) {
				const key = `prim|${spec.primitive}|${spec.size.join(",")}|${materialKey(e.material)}|${e.castShadow ? 1 : 0}`;
				return {
					kind: "instanced",
					key,
					geometry,
					material,
					castShadow: e.castShadow,
				};
			}
			return {
				kind: "object",
				build: () => {
					const root = new Object3D();
					const mesh = new Mesh(geometry, material);
					mesh.position.set(...e.visualOffset);
					root.add(mesh);
					setShadows(root, e.castShadow);
					root.name = e.sceneId;
					return root;
				},
			};
		}
		let gltf: GLTF;
		try {
			gltf = await loadGltf(spec.url);
		} catch {
			reportError(`GltfLoadError: ${spec.url}`);
			return null;
		}
		const { scene: source, lookKey } = lookedScene(spec.url, gltf, spec.look);
		const meshes = collectMeshes(source);
		const only = meshes.length === 1 ? meshes[0] : undefined;
		if (
			dynamicProp &&
			only &&
			!isAnimated(spec, gltf) &&
			!Array.isArray(only.material) &&
			!(only as { isSkinnedMesh?: boolean }).isSkinnedMesh
		) {
			const geoKey = `gltf|${spec.url}|${e.scale.join(",")}|${e.castShadow ? 1 : 0}`;
			const key = `${geoKey}|${lookKey}`;
			let geometry = geometries.get(geoKey);
			if (!geometry) {
				source.updateMatrixWorld(true);
				geometry = only.geometry.clone();
				geometry.applyMatrix4(
					new Matrix4().makeScale(...e.scale).multiply(only.matrixWorld),
				);
				geometries.set(geoKey, geometry);
				ownedGeometries.push(geometry);
			}
			return {
				kind: "instanced",
				key,
				geometry,
				material: only.material as Material,
				castShadow: e.castShadow,
			};
		}
		return {
			kind: "object",
			build: () => {
				const root = new Object3D();
				const model = cloneSkinned(source);
				model.scale.set(...e.scale);
				model.position.set(...e.visualOffset);
				root.add(model);
				setShadows(root, e.castShadow);
				root.name = e.sceneId;
				root.userData.model = model;
				root.userData.animations = gltf.animations;
				return root;
			},
		};
	};

	// --- entity bookkeeping -------------------------------------------------------------
	const driven: DrivenObject[] = [];
	const drivenBySlot = new Map<number, DrivenObject>();
	const staticBySlot = new Map<number, Object3D>();
	const pendingStatics: DrivenObject[] = [];
	const characters = new Map<number, Object3D>();
	const templates = new Map<string, Visual>();

	const addInstanced = (
		v: Extract<Visual, { kind: "instanced" }>,
		slot: number,
	): void => {
		removeSlot(slot); // also drops any driven/static root left on a reused slot
		instances.add(v.key, v.geometry, v.material, slot);
		const mesh = instances.mesh(v.key);
		if (mesh) mesh.castShadow = v.castShadow;
	};
	const addDriven = (root: Object3D, slot: number): void => {
		removeSlot(slot); // a reused slot must not leak its previous root
		root.matrixAutoUpdate = true;
		scene.add(root);
		const d = { slot, root };
		driven.push(d);
		drivenBySlot.set(slot, d);
	};

	const removeSlot = (slot: number): void => {
		instances.removeSlot(slot);
		const d = drivenBySlot.get(slot);
		if (d) {
			drivenBySlot.delete(slot);
			const i = driven.indexOf(d);
			if (i >= 0) {
				driven[i] = driven[driven.length - 1] as DrivenObject;
				driven.pop();
			}
			scene.remove(d.root);
			for (const [simId, root] of characters)
				if (root === d.root) characters.delete(simId);
		}
		const s = staticBySlot.get(slot);
		if (s) {
			staticBySlot.delete(slot);
			scene.remove(s);
			const pi = pendingStatics.findIndex((p) => p.slot === slot);
			if (pi >= 0) pendingStatics.splice(pi, 1);
		}
	};

	const addEntities = async (
		list: RenderEntity[],
		slotOf: (simId: number) => number,
	): Promise<void> => {
		const visuals = await Promise.all(list.map((e) => prepare(e)));
		for (let i = 0; i < list.length; i++) {
			const e = list[i] as RenderEntity;
			const v = visuals[i];
			if (!v) continue; // no mesh (bounds walls) or failed load (already reported)
			if (e.templateKey !== undefined && e.simId === undefined) {
				templates.set(e.templateKey, v);
				continue;
			}
			const slot = e.simId !== undefined ? slotOf(e.simId) : -1;
			const isStatic = !e.dynamic && !e.character;
			if (isStatic || slot < 0) {
				// Statics (and decor without a sim body) are plain objects placed once.
				const obj =
					v.kind === "object" ? v.build() : new Mesh(v.geometry, v.material);
				if (v.kind === "instanced") setShadows(obj, v.castShadow);
				if (slot < 0) placeStatic(obj, e);
				if (slot >= 0) {
					removeSlot(slot); // a reused slot must not leak its previous root
					obj.visible = false; // hidden until its first placement in sync
				}
				scene.add(obj);
				if (slot >= 0) {
					staticBySlot.set(slot, obj);
					pendingStatics.push({ slot, root: obj });
				}
				continue;
			}
			if (v.kind === "instanced") addInstanced(v, slot);
			else {
				const root = v.build();
				addDriven(root, slot);
				if (e.character && e.simId !== undefined) characters.set(e.simId, root);
			}
		}
	};

	const addSpawned = (templateKey: string, slot: number): void => {
		const v = templates.get(templateKey);
		if (!v) {
			reportError(`UnknownTemplate: ${templateKey}`);
			return;
		}
		if (v.kind === "instanced") addInstanced(v, slot);
		else addDriven(v.build(), slot);
	};

	const sync = (
		prev: Float32Array,
		curr: Float32Array,
		alpha: number,
	): void => {
		instances.sync(prev, curr, alpha);
		for (let i = 0; i < driven.length; i++) {
			const d = driven[i] as DrivenObject;
			readSlot(prev, curr, d.slot, alpha, d.root.position, d.root.quaternion);
		}
		// Statics: placed from curr on the first sync after they were added, then left alone.
		for (let i = pendingStatics.length - 1; i >= 0; i--) {
			const p = pendingStatics[i] as DrivenObject;
			if (readSlot(prev, curr, p.slot, 1, p.root.position, p.root.quaternion)) {
				p.root.updateMatrix();
				p.root.updateMatrixWorld(true);
				p.root.visible = true;
				pendingStatics[i] = pendingStatics[
					pendingStatics.length - 1
				] as DrivenObject;
				pendingStatics.pop();
			}
		}
	};

	// --- camera -------------------------------------------------------------------------
	const setCameraPreset = (name: string): void => {
		const preset = settings.cameraPresets[name];
		if (!preset) {
			reportError(`UnknownCameraPreset: ${name}`);
			return;
		}
		camera.fov = preset.fov;
		camera.updateProjectionMatrix();
		_v1.set(...preset.position);
		_v2.set(...preset.target);
		if (controller) controller.setPose(_v1, _v2);
		else {
			camera.position.copy(_v1);
			camera.lookAt(_v2);
		}
		camera.updateMatrixWorld();
		updateCsmFrustums(csm);
	};
	const presetNames = Object.keys(settings.cameraPresets);
	const initialPreset = settings.cameraPresets.hero ? "hero" : presetNames[0];
	if (initialPreset) setCameraPreset(initialPreset);
	else if (controller)
		controller.setPose(camera.position, _v1.set(...DEFAULT_CAMERA.target));

	const resize = (w: number, h: number, dpr: number): void => {
		if (w <= 0 || h <= 0) return;
		renderer.setPixelRatio(dpr);
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		updateCsmFrustums(csm);
	};

	// --- frame + stats ------------------------------------------------------------------
	const statsObj: RenderStats = {
		fps: 0,
		frameMs: 0,
		drawCalls: 0,
		triangles: 0,
		splats: splat?.count ?? 0,
		backend: isWebGPU ? "webgpu" : "webgl",
	};
	const render = (dt: number): void => {
		renderer.info.reset();
		controller?.update(dt);
		// World matrices update once per frame, not once per pipeline pass. Objects must
		// not be moved inside pass callbacks (onBeforeRender): they would lag a frame.
		built.applyDof();
		renderWithFrozenMatrices(scene, () => pipeline.render());
		if (dt > 0) {
			const ms = dt * 1000;
			statsObj.frameMs =
				statsObj.frameMs === 0
					? ms
					: statsObj.frameMs + (ms - statsObj.frameMs) * FPS_SMOOTHING;
			statsObj.fps = 1000 / statsObj.frameMs;
		}
		statsObj.drawCalls = renderer.info.render.drawCalls;
		statsObj.triangles = renderer.info.render.triangles;
	};
	const stats = (): RenderStats => {
		statsObj.textureMB = Math.round((textureBytes / (1024 * 1024)) * 10) / 10;
		return statsObj;
	};

	const hullPoints = async (
		url: string,
		scale: [number, number, number],
	): Promise<Float32Array> => {
		const gltf = await loadGltf(url);
		gltf.scene.updateMatrixWorld(true);
		const meshes = collectMeshes(gltf.scene);
		let n = 0;
		for (const m of meshes)
			n += m.geometry.getAttribute("position")?.count ?? 0;
		const out = new Float32Array(n * 3);
		const v = new Vector3();
		let o = 0;
		for (const m of meshes) {
			const pos = m.geometry.getAttribute("position");
			if (!pos) continue;
			for (let i = 0; i < pos.count; i++) {
				v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
				out[o++] = v.x * scale[0];
				out[o++] = v.y * scale[1];
				out[o++] = v.z * scale[2];
			}
		}
		return out;
	};

	const characterViews: CharacterView[] = [];
	const attachCharacter = (
		simId: number,
		clipMap: Partial<Record<AnimState, AnimClipSpec>>,
	): CharacterView => {
		const root = characters.get(simId);
		if (!root)
			throw new Error(
				`attachCharacter: no character object for sim id ${simId}`,
			);
		const clips =
			(root.userData.animations as AnimationClip[] | undefined) ?? [];
		for (const s of Object.keys(clipMap) as AnimState[]) {
			const name = clipMap[s]?.clip;
			if (name !== undefined && !clips.some((c) => c.name === name))
				reportError(`UnknownAnimationClip: ${s} -> "${name}" (${root.name})`);
		}
		const view = new CharacterView(root, clips, clipMap);
		characterViews.push(view);
		return view;
	};

	const dispose = (): void => {
		for (const v of characterViews) v.dispose();
		controller?.dispose();
		built.dispose();
		instances.dispose();
		csm.dispose();
		env.dispose();
		splatEnv?.dispose();
		if (splat) {
			splat.object.geometry.dispose();
			splat.object.splatGeometry.dispose();
			splat.object.material.dispose();
		}
		if (catcher) {
			catcher.geometry.dispose();
			(catcher.material as Material).dispose();
		}
		for (const g of ownedGeometries) g.dispose();
		ktx2Loader.dispose();
		for (const m of materials.values()) m.dispose();
		// look / toon copies owned by the renderer's cloned entity scenes
		const owned = new Set<Material>();
		for (const root of lookedScenes.values())
			root.traverse((o) => {
				const mat = (o as Mesh).material;
				if (!mat) return;
				for (const m of Array.isArray(mat) ? mat : [mat]) owned.add(m);
			});
		for (const m of owned) m.dispose();
		renderer.dispose();
	};

	return {
		three: { renderer, scene, camera },
		get controller() {
			return controller;
		},
		set controller(c: CameraController | null) {
			controller = c;
		},
		csm,
		instances,
		splatColor: splat?.color ?? null,
		dof: built.dof,
		addEntities,
		addSpawned,
		removeSlot,
		sync,
		characterObject: (simId) => characters.get(simId),
		attachCharacter,
		render,
		setCameraPreset,
		resize,
		stats,
		hullPoints,
		loadGltf,
		assetUrl,
		style: toon ? "toon" : "pbr",
		stylize: (root: Object3D) => {
			if (toon) stylizeToon(root);
		},
		reportError,
		errors: () => errorList,
		dispose,
	};
}
