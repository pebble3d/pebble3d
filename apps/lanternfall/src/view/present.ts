import type { CharacterView } from "@pebble3d/renderer";
import type { Game } from "@pebble3d/sdk/game";
import { attribute, uniform } from "three/tsl";
import {
	AdditiveBlending,
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	Color,
	DoubleSide,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardMaterial,
	type Object3D,
	PointLight,
	RingGeometry,
	Vector3,
} from "three/webgpu";
import { type LanternSim, PHASE, TUNE } from "../game/sim.ts";
import { type Keep, Z1 } from "../gen/generate.ts";
import { dressKeep, glow } from "./materials.ts";

/** Point lights in the pool: the lanterns nearest the camera focus get one each. */
const LIGHT_POOL = 10;
/** Rays per vision cone (fan resolution). */
const RAYS = 28;
const CONE_Y = 0.06;
const RAY_STATIC = 1;

const CONE_COLORS = [
	new Color("#ffe9b0"), // patrol
	new Color("#ff9a2e"), // suspicious
	new Color("#ff2d2d"), // alert
	new Color("#ffc46b"), // search
	new Color("#ffe9b0"), // return
];

interface LightSource {
	x: number;
	y: number;
	z: number;
	radius: number;
	color: Color;
	power: number;
	phase: number;
	/** Guard index for a moving hand lantern, else -1. */
	guard: number;
}

/**
 * Everything drawn that is not a scene entity: the follow camera, a pooled set of point lights
 * for the lanterns, guard animation and facing, the raycast vision cones, the carried relic,
 * loot visibility and the player's light ring. Reads the sim; never writes it.
 */
export class Presentation {
	private readonly cam: Game["renderer"]["three"]["camera"];
	private readonly focus = new Vector3();
	private readonly camPos = new Vector3();
	private readonly lights: PointLight[] = [];
	private readonly sources: LightSource[] = [];
	private readonly order: Int32Array;
	private readonly dist: Float32Array;
	private readonly guardViews: CharacterView[] = [];
	private readonly cones: {
		mesh: Mesh;
		pos: Float32Array;
		color: ReturnType<typeof uniform>;
	}[] = [];
	private readonly relic: Object3D | null;
	private readonly loot: (Object3D | null)[];
	private readonly ring: Mesh;
	private readonly ringMat: MeshBasicNodeMaterial;
	private readonly ringOpacity = uniform(0);
	private t = 0;
	private dressed = false;
	/** Draw calls the static keep was baked into. */
	mergedMeshes = 0;
	private camInit = false;
	private readonly frame = {
		grounded: true,
		vx: 0,
		vz: 0,
		vy: 0,
		sprintSpeed: 4.4,
	};
	/** Guard visual positions (live references), for HUD markers. */
	get guardPositions(): Vector3[] {
		return this.guardRoots;
	}
	private readonly guardRoots: Vector3[] = [];
	/** Shot override: a fixed camera [px, py, pz, tx, ty, tz, fov]. */
	shotCam: number[] | null = null;

	constructor(
		private readonly game: Game,
		private readonly sim: LanternSim,
		private readonly keep: Keep,
	) {
		const r = game.renderer;
		r.controller?.dispose(); // detach the default controller's canvas listeners
		r.controller = null; // the game drives the camera
		const scene = r.three.scene;
		scene.environmentIntensity = 0.06;
		this.cam = r.three.camera;
		this.cam.fov = 42;
		this.cam.updateProjectionMatrix();

		const L = sim.layout;
		for (const l of L.lanterns) {
			const relic = l.kind === "relic";
			this.sources.push({
				x: l.x,
				y: l.y,
				z: l.z,
				radius: l.radius,
				color: new Color(
					relic
						? "#6fe3ff"
						: l.kind === "brazier" || l.kind === "gate"
							? "#ff8f3a"
							: "#ffb45c",
				),
				power: relic ? 8 : l.kind === "sconce" ? 34 : 38,
				phase: (l.x * 12.9898 + l.z * 78.233) % 6.283,
				guard: -1,
			});
		}
		for (let i = 0; i < sim.guards.length; i++)
			this.sources.push({
				x: 0,
				y: 1.1,
				z: 0,
				radius: TUNE.guardLanternRadius + 1,
				color: new Color("#ffd28a"),
				power: 3,
				phase: i * 1.7,
				guard: i,
			});
		this.order = new Int32Array(this.sources.length);
		this.dist = new Float32Array(this.sources.length);
		for (let i = 0; i < LIGHT_POOL; i++) {
			const pl = new PointLight(0xffffff, 0, 8, 2);
			pl.castShadow = false;
			scene.add(pl);
			this.lights.push(pl);
		}

		// Guards: animation views, hand lanterns, cones.
		const lanternGeo = new BoxGeometry(0.16, 0.24, 0.16);
		const lanternMat = new MeshStandardMaterial({
			color: "#ffcf7a",
			emissive: new Color("#ffb347"),
			emissiveIntensity: 2.2,
		});
		for (const g of sim.guards) {
			const view = r.attachCharacter(g.simId, {
				idle: { clip: "Idle" },
				walk: { clip: "Walking", speed: 1.5 },
				run: { clip: "Running", speed: 4.4 },
			});
			this.guardViews.push(view);
			this.guardRoots.push(view.root.position);
			// The automaton has ~20 meshes: no moon shadows for it (3 cascades x 20 draws each).
			view.root.traverse((o) => {
				o.castShadow = false;
			});
			const lantern = new Mesh(lanternGeo, lanternMat);
			lantern.position.set(0.32, 0.2, 0.28);
			lantern.castShadow = false;
			view.root.add(lantern);

			const pos = new Float32Array((RAYS + 2) * 3);
			const fade = new Float32Array(RAYS + 2);
			fade[0] = 1;
			const idx: number[] = [];
			for (let k = 0; k <= RAYS; k++) {
				idx.push(0, k + 2, k + 1);
				fade[k + 1] = 0;
			}
			const geo = new BufferGeometry();
			geo.setAttribute("position", new BufferAttribute(pos, 3));
			geo.setAttribute("fade", new BufferAttribute(fade, 1));
			geo.setIndex(idx.slice(0, RAYS * 3));
			const color = uniform(new Color("#ffe9b0"));
			const mat = new MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				blending: AdditiveBlending,
				side: DoubleSide,
			});
			mat.colorNode = color;
			mat.opacityNode = attribute("fade", "float").mul(0.3).add(0.06);
			const mesh = new Mesh(geo, mat);
			mesh.frustumCulled = false;
			mesh.renderOrder = 2;
			scene.add(mesh);
			this.cones.push({ mesh, pos, color });
		}

		this.relic = scene.getObjectByName("relic") ?? null;
		if (this.relic) {
			this.relic.matrixAutoUpdate = true;
			const gem = glow("#5fd8ff", 2.6);
			this.relic.traverse((o) => {
				const m = o as Mesh;
				if (m.isMesh) m.material = gem;
			});
		}
		this.loot = L.loot.map(
			(_, k) => scene.getObjectByName(`loot-${k}`) ?? null,
		);

		this.ringMat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: AdditiveBlending,
			side: DoubleSide,
		});
		this.ringMat.colorNode = uniform(new Color("#ffcf7a"));
		this.ringMat.opacityNode = this.ringOpacity;
		this.ring = new Mesh(new RingGeometry(0.42, 0.55, 40), this.ringMat);
		this.ring.rotation.x = -Math.PI / 2;
		this.ring.renderOrder = 3;
		scene.add(this.ring);
	}

	update(dt: number): void {
		if (!this.dressed) {
			// After the first sync: static bodies are placed, so they can be baked.
			const ids = new Set<string>();
			for (const e of this.keep.scene.entities ?? [])
				if (
					e.id !== "player" &&
					e.id !== "relic" &&
					!e.id.startsWith("guard-") &&
					!e.id.startsWith("loot-")
				)
					ids.add(e.id);
			this.mergedMeshes = dressKeep(this.game.renderer.three.scene, ids);
			this.dressed = true;
		}
		this.t += dt;
		const s = this.sim;
		const world = this.game.sim.world;
		const sc = this.game.views.scratch;

		// --- guards: animation from the engine's character state, facing from the sim ----
		for (let i = 0; i < s.guards.length; i++) {
			const g = s.guards[i];
			const view = this.guardViews[i];
			if (!g || !view) continue;
			if (world.characterState(g.simId)) {
				this.frame.grounded = (sc[8] as number) > 0.5;
				this.frame.vx = sc[9] as number;
				this.frame.vz = sc[10] as number;
				this.frame.vy = 0;
			}
			view.update(this.frame, dt);
			view.root.rotation.set(0, g.yaw, 0);
		}

		// --- camera -------------------------------------------------------------------
		const p = this.game.player?.view.root.position;
		const cam = this.cam;
		if (this.shotCam) {
			const c = this.shotCam;
			cam.position.set(c[0] as number, c[1] as number, c[2] as number);
			this.focus.set(c[3] as number, c[4] as number, c[5] as number);
			if (cam.fov !== c[6]) {
				cam.fov = c[6] as number;
				cam.updateProjectionMatrix();
			}
		} else if (s.phase === PHASE.TITLE || !p) {
			const a = this.t * 0.05;
			// Keep framed right of the title card.
			this.focus.set(-7 + Math.sin(a) * 1.5, 0, 2);
			cam.position.set(-4 + Math.sin(a) * 5, 40, Z1 + 25);
		} else {
			const k = this.camInit ? 1 - Math.exp(-5 * dt) : 1;
			this.camInit = true;
			this.camPos.set(p.x, 0.6, p.z + 0.8);
			this.focus.lerp(this.camPos, k);
			cam.position.set(this.focus.x, this.focus.y + 16.5, this.focus.z + 10.5);
		}
		cam.lookAt(this.focus);

		// --- light pool: the nearest sources to the focus get the lights ----------------
		const n = this.sources.length;
		for (let i = 0; i < n; i++) {
			const src = this.sources[i] as LightSource;
			if (src.guard >= 0) {
				const g = s.guards[src.guard];
				const v = this.guardViews[src.guard];
				if (g && v) {
					src.x =
						v.root.position.x + Math.sin(g.yaw) * 0.3 + Math.cos(g.yaw) * 0.3;
					src.z =
						v.root.position.z + Math.cos(g.yaw) * 0.3 - Math.sin(g.yaw) * 0.3;
				}
			}
			this.order[i] = i;
			this.dist[i] = Math.hypot(
				src.x - this.focus.x,
				(src.z - this.focus.z) * 1.15,
			);
		}
		// Insertion sort by distance (n is small; no allocation).
		for (let i = 1; i < n; i++) {
			const v = this.order[i] as number;
			const dv = this.dist[v] as number;
			let j = i - 1;
			while (j >= 0 && (this.dist[this.order[j] as number] as number) > dv) {
				this.order[j + 1] = this.order[j] as number;
				j--;
			}
			this.order[j + 1] = v;
		}
		const far = s.phase === PHASE.TITLE && !this.shotCam ? 60 : 24;
		for (let k = 0; k < LIGHT_POOL; k++) {
			const pl = this.lights[k] as PointLight;
			if (k >= n) {
				pl.intensity = 0;
				continue;
			}
			const src = this.sources[this.order[k] as number] as LightSource;
			const d = this.dist[this.order[k] as number] as number;
			const fade = Math.max(0, Math.min(1, (far - d) / 6));
			const flicker =
				src.guard >= 0
					? 1
					: 0.9 +
						0.06 * Math.sin(this.t * 9.1 + src.phase) +
						0.04 * Math.sin(this.t * 23.7 + src.phase * 2);
			let power = src.power;
			if (src.radius === 4 && s.hasRelic) power = 0; // the relic's own glow leaves with it
			pl.position.set(src.x, src.y, src.z);
			pl.color.copy(src.color);
			pl.distance = src.radius * 1.15;
			pl.intensity = power * flicker * fade;
		}

		// --- vision cones: a fan of static raycasts at the current sight range ------------
		const play = s.phase === PHASE.PLAY;
		for (let i = 0; i < s.guards.length; i++) {
			const g = s.guards[i];
			const cone = this.cones[i];
			const v = this.guardViews[i];
			if (!g || !cone || !v) continue;
			const ox = v.root.position.x;
			const oz = v.root.position.z;
			// Exactly the sim's sight range against the thief now (a nominal one on the title).
			const range = play
				? s.sightRange(g)
				: TUNE.rangeDark + TUNE.rangeLit * 0.45;
			const pos = cone.pos;
			pos[0] = ox;
			pos[1] = CONE_Y;
			pos[2] = oz;
			for (let k = 0; k <= RAYS; k++) {
				const a = g.yaw - TUNE.coneHalf + (2 * TUNE.coneHalf * k) / RAYS;
				const dx = Math.sin(a);
				const dz = Math.cos(a);
				let len = range;
				// At head height: low props (barrels, short crates) don't stop the guards' sight either.
				if (world.raycast(ox, TUNE.headY, oz, dx, 0, dz, range, RAY_STATIC, 0))
					len = sc[0] as number;
				const o = (k + 1) * 3;
				pos[o] = ox + dx * len;
				pos[o + 1] = CONE_Y;
				pos[o + 2] = oz + dz * len;
			}
			(
				cone.mesh.geometry.getAttribute("position") as BufferAttribute
			).needsUpdate = true;
			(cone.color.value as Color).copy(CONE_COLORS[g.state] as Color);
			cone.mesh.visible = s.phase !== PHASE.ESCAPED;
		}

		// --- relic, loot, player ring --------------------------------------------------
		if (this.relic) {
			if (s.hasRelic && p) {
				this.relic.position.set(p.x, 2.05 + 0.06 * Math.sin(this.t * 3), p.z);
			} else {
				this.relic.position.set(
					s.layout.relic[0],
					1.32 + 0.05 * Math.sin(this.t * 2),
					s.layout.relic[1],
				);
			}
			this.relic.rotation.y = this.t * 0.8;
		}
		for (let k = 0; k < this.loot.length; k++) {
			const o = this.loot[k];
			if (!o) continue;
			const vis = (s.lootMask & (1 << k)) === 0;
			if (o.visible !== vis) o.visible = vis;
		}
		if (p) {
			this.ring.position.set(p.x, 0.05, p.z);
			this.ringOpacity.value = play ? 0.12 + 0.6 * s.playerLight : 0;
		}
	}
}
