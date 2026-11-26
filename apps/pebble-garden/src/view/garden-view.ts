import { primitiveGeometry, readSlot } from "@pebble3d/renderer";
import {
	BoxGeometry,
	type BufferGeometry,
	Color,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	Object3D,
	Quaternion,
	RingGeometry,
	type Scene,
	Vector3,
} from "three/webgpu";
import type { ResolvedEntity } from "../garden/resolve.ts";
import type { GardenSim } from "../garden/sim.ts";

/**
 * One Object3D per garden entity, built from the resolved scene: edit mode places them at
 * their authored transforms, play mode drives them from the sim's prev/curr state buffers
 * with interpolation. Geometry is built at the entity's real size (cached by primitive and
 * size), so a root's own scale is always 1 except while the scale gizmo drags it.
 */

export interface EntityVisual {
	id: string;
	root: Object3D;
	mesh: Mesh;
	material: MeshStandardNodeMaterial;
	entity: ResolvedEntity;
	baseEmissive: Color;
}

const _p = new Vector3();
const _q = new Quaternion();

export class GardenView {
	readonly root = new Group();
	visuals: EntityVisual[] = [];
	private readonly byId = new Map<string, EntityVisual>();
	private readonly geometries = new Map<string, BufferGeometry>();
	private readonly proxyGeometry = new BoxGeometry(1, 1, 1);
	private selected: EntityVisual | null = null;
	private hovered: EntityVisual | null = null;
	private time = 0;
	/** Goal bowl decoration: a soft glowing ring that pulses (brighter when won). */
	private readonly goalRing: Mesh;
	private readonly goalMat: MeshBasicNodeMaterial;
	private goalGlow = 0;
	goalWon = false;
	/** Locked entities (challenge scenery) are drawn slightly desaturated when hovered. */
	locked = new Set<string>();

	constructor(scene: Scene) {
		scene.add(this.root);
		this.goalMat = new MeshBasicNodeMaterial({
			color: new Color("#f0a92e"),
			transparent: true,
			opacity: 0.9,
			depthWrite: false,
			side: DoubleSide,
		});
		this.goalRing = new Mesh(new RingGeometry(0.9, 1.0, 96), this.goalMat);
		this.goalRing.rotation.x = -Math.PI / 2;
		this.goalRing.visible = false;
		this.goalRing.renderOrder = 2;
		scene.add(this.goalRing);
	}

	private geometryFor(e: ResolvedEntity): BufferGeometry {
		if (!e.primitive) return this.proxyGeometry;
		const key = `${e.primitive}|${e.scale.join(",")}`;
		let g = this.geometries.get(key);
		if (!g) {
			g = primitiveGeometry(e.primitive, e.scale);
			this.geometries.set(key, g);
		}
		return g;
	}

	/** Rebuilds the visuals for a resolved scene (cheap: geometry is cached). */
	setEntities(list: readonly ResolvedEntity[]): void {
		const selectedId = this.selected?.id ?? null;
		for (const v of this.visuals) {
			this.root.remove(v.root);
			v.material.dispose();
		}
		this.visuals = [];
		this.byId.clear();
		this.selected = null;
		this.hovered = null;
		let goal: ResolvedEntity | null = null;
		for (const e of list) {
			const material = new MeshStandardNodeMaterial({
				color: new Color(safeColor(e.color)),
				roughness: e.roughness,
				metalness: e.metalness,
			});
			if (e.unsupported || !e.primitive) {
				material.transparent = true;
				material.opacity = 0.45;
			}
			const baseEmissive = new Color(safeColor(e.emissive ?? "#000000"));
			material.emissive = baseEmissive.clone();
			const mesh = new Mesh(this.geometryFor(e), material);
			mesh.castShadow = e.castShadow;
			mesh.receiveShadow = true;
			if (!e.primitive) mesh.scale.set(...e.scale);
			const root = new Object3D();
			root.add(mesh);
			root.name = e.id;
			root.userData.entityId = e.id;
			mesh.userData.entityId = e.id;
			root.position.set(...e.position);
			root.quaternion.set(...e.rotation).normalize();
			this.root.add(root);
			const v: EntityVisual = {
				id: e.id,
				root,
				mesh,
				material,
				entity: e,
				baseEmissive,
			};
			this.visuals.push(v);
			this.byId.set(e.id, v);
			if (e.role === "goal" && !goal) goal = e;
		}
		// Drop cached geometry no entity uses any more (each new size made one).
		const used = new Set<BufferGeometry>();
		for (const v of this.visuals) used.add(v.mesh.geometry);
		for (const [k, g] of this.geometries)
			if (!used.has(g)) {
				g.dispose();
				this.geometries.delete(k);
			}
		if (goal) {
			const r = Math.max(goal.scale[0], goal.scale[2]) / 2;
			this.goalRing.scale.set(r * 1.06, r * 1.06, 1);
			this.goalRing.position.set(
				goal.position[0],
				goal.position[1] + goal.scale[1] / 2 + 0.012,
				goal.position[2],
			);
			this.goalRing.visible = true;
		} else this.goalRing.visible = false;
		if (selectedId) this.select(selectedId);
	}

	get(id: string): EntityVisual | undefined {
		return this.byId.get(id);
	}

	/** Back to the authored transforms (Reset / entering edit mode). */
	syncEdit(): void {
		for (const v of this.visuals) {
			v.root.position.set(...v.entity.position);
			v.root.quaternion.set(...v.entity.rotation).normalize();
			v.root.scale.set(1, 1, 1);
		}
	}

	/** Drives the visuals from the sim's state buffers. */
	syncPlay(sim: GardenSim, alpha: number): void {
		const { prev, curr } = sim.views;
		for (const v of this.visuals) {
			const slot = sim.slots[v.entity.index] as number;
			if (slot < 0) continue;
			if (readSlot(prev, curr, slot, alpha, _p, _q)) {
				v.root.position.copy(_p);
				v.root.quaternion.copy(_q);
			}
		}
	}

	select(id: string | null): void {
		this.selected = id ? (this.byId.get(id) ?? null) : null;
	}

	hover(id: string | null): void {
		this.hovered = id ? (this.byId.get(id) ?? null) : null;
	}

	/** Pick targets for the editor's raycaster. */
	meshes(out: Object3D[]): Object3D[] {
		out.length = 0;
		for (const v of this.visuals) out.push(v.mesh);
		return out;
	}

	frame(dt: number): void {
		this.time += dt;
		for (const v of this.visuals) {
			const e = v.material.emissive;
			e.copy(v.baseEmissive);
			if (v === this.selected) {
				const k = 0.16 + 0.08 * Math.sin(this.time * 5);
				e.r += 0.95 * k;
				e.g += 0.62 * k;
				e.b += 0.25 * k;
			} else if (v === this.hovered) {
				const k = this.locked.has(v.id) ? 0.04 : 0.1;
				e.r += k;
				e.g += k;
				e.b += k;
			}
		}
		this.goalGlow +=
			((this.goalWon ? 1 : 0) - this.goalGlow) * Math.min(1, dt * 3);
		this.goalMat.opacity =
			0.65 + 0.25 * Math.sin(this.time * 2.2) + this.goalGlow * 0.1;
	}
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Hex colours pass; anything else becomes grey (three.js would warn per entity). */
function safeColor(c: string): string {
	return HEX.test(c) ? c : "#cccccc";
}
