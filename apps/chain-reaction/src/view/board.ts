import { bodyType, mergePrefab } from "@pebble3d/sdk/schema";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
	CanvasTexture,
	Color,
	Group,
	type Material,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	type Object3D,
	PlaneGeometry,
	Quaternion,
	RepeatWrapping,
	type Scene,
	SRGBColorSpace,
} from "three/webgpu";
import type { Level, Placement } from "../puzzle/level.ts";
import { CELL, type PartEntity, partEntities } from "../puzzle/parts.ts";
import type { PuzzleSim } from "../puzzle/sim.ts";
import {
	airMaterial,
	airTexture,
	beamStrength,
	buildBeacon,
	buildBlock,
	buildGoalWall,
	buildVisual,
	MAT,
	type PartVisual,
	SPRING_CAP_Y,
	SPRING_COIL,
	springTilt,
} from "./visuals.ts";

/**
 * The 3D board: a pegboard backplate behind the grid, the level's blocks and goal cup,
 * and one visual per sim entity. Dynamic entities are driven from the sim's prev/curr
 * state buffers with interpolation; nothing allocates per frame.
 */

interface Driven {
	obj: Object3D;
	slot: number;
}

interface SpringFx {
	vis: PartVisual;
	x: number;
	/** Seconds since it fired (large = idle). */
	t: number;
}

const _qa = new Quaternion();
const _qb = new Quaternion();

export class BoardView {
	readonly root = new Group();
	private readonly levelGroup = new Group();
	private readonly simGroup = new Group();
	private readonly ghostGroup = new Group();
	private driven: Driven[] = [];
	private fans: PartVisual[] = [];
	private springs: SpringFx[] = [];
	private beacon: ReturnType<typeof buildBeacon> | null = null;
	private level: Level | null = null;
	private readonly framing = { cx: 0, cy: 3, w: 12, h: 7 };
	/** Per-sim fan zone geometries (sized per fan; disposed on the next setSim). */
	private zoneGeoms: PlaneGeometry[] = [];
	/** The backplate's own material and texture clone (disposed on the next setLevel). */
	private plateMat: MeshStandardNodeMaterial | null = null;
	private readonly ghostOk: Material;
	private readonly ghostBad: Material;
	private readonly cursor: Mesh;
	private readonly air = airMaterial();
	private airScroll = 0;
	/** 0..1: the fans spin up while the machine runs. */
	fanSpeed = 0;
	/** Goal celebration pulse (seconds since solved, or -1). */
	private solvedT = -1;

	constructor(scene: Scene) {
		scene.add(this.root);
		this.root.add(this.levelGroup, this.simGroup, this.ghostGroup);
		this.ghostOk = new MeshBasicNodeMaterial({
			color: new Color("#7dffb0"),
			transparent: true,
			opacity: 0.45,
			depthWrite: false,
		});
		this.ghostBad = new MeshBasicNodeMaterial({
			color: new Color("#ff5a4e"),
			transparent: true,
			opacity: 0.4,
			depthWrite: false,
		});
		this.cursor = new Mesh(
			new PlaneGeometry(CELL * 0.96, CELL * 0.96),
			new MeshBasicNodeMaterial({
				color: new Color("#ffffff"),
				transparent: true,
				opacity: 0.08,
				depthWrite: false,
			}),
		);
		this.cursor.visible = false;
		this.root.add(this.cursor);
	}

	/** Rebuilds the static scenery for a level: backplate, blocks, goal. */
	setLevel(level: Level): void {
		this.level = level;
		disposeChildren(this.levelGroup);
		if (this.plateMat) {
			this.plateMat.map?.dispose();
			this.plateMat.dispose();
		}
		this.framing.cx = level.grid.origin[0] + (level.grid.cols * CELL) / 2;
		this.framing.cy = level.grid.origin[1] + (level.grid.rows * CELL) / 2;
		this.framing.w = level.grid.cols * CELL;
		this.framing.h = level.grid.rows * CELL;
		const { cols, rows, origin } = level.grid;
		const w = cols * CELL;
		const h = rows * CELL;
		const cx = origin[0] + w / 2;
		const cy = origin[1] + h / 2;
		// Pegboard backplate with the grid printed on it.
		this.plateMat = pegboardMaterial(cols, rows);
		const plate = new Mesh(
			new RoundedBoxGeometry(w + 0.5, h + 0.35, 0.12, 3, 0.05),
			this.plateMat,
		);
		plate.position.set(cx, cy + 0.175, -0.62);
		plate.receiveShadow = true;
		this.levelGroup.add(plate);
		// Frame rails.
		const rail = (x: number, y: number, sx: number, sy: number): void => {
			const r = new Mesh(
				new RoundedBoxGeometry(sx, sy, 0.22, 3, 0.04),
				MAT.darkSteel,
			);
			r.position.set(x, y, -0.58);
			r.castShadow = true;
			r.receiveShadow = true;
			this.levelGroup.add(r);
		};
		rail(cx, origin[1] + h + 0.42, w + 0.7, 0.14);
		rail(origin[0] - 0.3, cy + 0.2, 0.14, h + 0.6);
		rail(origin[0] + w + 0.3, cy + 0.2, 0.14, h + 0.6);
		this.cursor.position.z = -0.555;
	}

	/** Rebuilds the entity visuals for a sim (edit preview or a run). */
	setSim(sim: PuzzleSim): void {
		disposeChildren(this.simGroup, false);
		for (const g of this.zoneGeoms) g.dispose();
		this.zoneGeoms = [];
		this.driven = [];
		this.fans = [];
		this.springs = [];
		this.beacon = null;
		this.solvedT = -1;
		const { scene, parts } = sim.composed;
		const partById = new Map<string, PartEntity>();
		for (const p of parts) partById.set(p.entity.id, p);
		sim.views.refresh();
		const curr = sim.views.curr;
		for (const raw of scene.entities) {
			const e = mergePrefab(scene, raw);
			const id = sim.ids.get(e.id);
			if (id === undefined) continue;
			const slot = sim.world.slotOf(id);
			const pe = partById.get(e.id);
			const sc = e.transform?.scale ?? [1, 1, 1];
			let obj: Object3D;
			if (e.prefab === "block") obj = buildBlock(sc[0], sc[1], sc[2]);
			else if (e.prefab === "goalWall")
				obj = buildGoalWall(sc[0], sc[1], sc[2]);
			else {
				const vis = buildVisual(e.prefab ?? "", null);
				obj = vis.root;
				if (vis.rotors) this.fans.push(vis);
				if (vis.cap && pe) {
					(vis.cap.parent as Object3D).rotation.z = springTilt(
						pe.placement.dir,
					);
					this.springs.push({ vis, x: e.transform?.position?.[0] ?? 0, t: 9 });
				}
			}
			if (slot >= 0) {
				const o = slot * 8;
				obj.position.set(
					curr[o] as number,
					curr[o + 1] as number,
					curr[o + 2] as number,
				);
				obj.quaternion.set(
					curr[o + 3] as number,
					curr[o + 4] as number,
					curr[o + 5] as number,
					curr[o + 6] as number,
				);
				if (e.body && bodyType(e) === "dynamic")
					this.driven.push({ obj, slot });
			}
			this.simGroup.add(obj);
		}
		// Airflow zones: where each fan pushes, drawn on the board.
		for (const pe of parts) {
			const r = pe.role;
			if (r?.kind !== "fan") continue;
			const w = r.max[0] - r.min[0];
			const h = r.max[1] - r.min[1];
			const up = r.accel[1] !== 0;
			const len = up ? h : w;
			const across = up ? w : h;
			const g = new PlaneGeometry(across * 0.9, len);
			this.zoneGeoms.push(g);
			const uv = g.attributes.uv;
			if (uv)
				for (let i = 0; i < uv.count; i++)
					uv.setXY(i, uv.getX(i) * 1.6, uv.getY(i) * len * 1.6);
			const zone = new Mesh(g, this.air);
			zone.position.set(
				(r.min[0] + r.max[0]) / 2,
				(r.min[1] + r.max[1]) / 2,
				-0.545,
			);
			zone.rotation.z = up ? 0 : r.accel[0] > 0 ? -Math.PI / 2 : Math.PI / 2;
			zone.renderOrder = 1;
			this.simGroup.add(zone);
		}
		// Beacon over the goal cup.
		const g = sim.goal;
		this.beacon = buildBeacon();
		this.beacon.root.position.set((g.min[0] + g.max[0]) / 2, g.min[1] - 0.1, 0);
		this.simGroup.add(this.beacon.root);
	}

	/** Interpolated poses of the moving bodies; animation of fans, springs and the goal. */
	update(sim: PuzzleSim, alpha: number, dt: number, time: number): void {
		const prev = sim.views.prev;
		const curr = sim.views.curr;
		for (const d of this.driven) {
			const o = d.slot * 8;
			const a = alpha;
			d.obj.position.set(
				(prev[o] as number) + ((curr[o] as number) - (prev[o] as number)) * a,
				(prev[o + 1] as number) +
					((curr[o + 1] as number) - (prev[o + 1] as number)) * a,
				(prev[o + 2] as number) +
					((curr[o + 2] as number) - (prev[o + 2] as number)) * a,
			);
			_qa.set(
				prev[o + 3] as number,
				prev[o + 4] as number,
				prev[o + 5] as number,
				prev[o + 6] as number,
			);
			_qb.set(
				curr[o + 3] as number,
				curr[o + 4] as number,
				curr[o + 5] as number,
				curr[o + 6] as number,
			);
			d.obj.quaternion.slerpQuaternions(_qa, _qb, a);
		}
		for (const f of this.fans)
			if (f.rotors)
				for (const r of f.rotors)
					r.rotation.z -= dt * (1.5 + 30 * this.fanSpeed);
		this.airScroll -= dt * (0.15 + 2.2 * this.fanSpeed);
		const at = airTexture();
		if (at) at.offset.y = this.airScroll % 1;
		this.air.opacity = 0.1 + 0.22 * this.fanSpeed;
		for (const s of this.springs) {
			s.t += dt;
			const cap = s.vis.cap as Object3D;
			const coil = s.vis.coil as Object3D;
			// Fire: the cap snaps up and rings down.
			const k = s.t < 0.5 ? Math.exp(-s.t * 9) * Math.cos(s.t * 40) : 0;
			cap.position.y = SPRING_CAP_Y + 0.22 * Math.max(0, k);
			coil.scale.y = SPRING_COIL + 0.22 * Math.max(0, k);
		}
		if (this.beacon) {
			const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
			let glow = 2.0 + 0.8 * pulse;
			let ringY = 0.75 + 0.06 * Math.sin(time * 1.7);
			if (this.solvedT >= 0) {
				this.solvedT += dt;
				const s = Math.exp(-this.solvedT * 1.5);
				glow += 5 * s;
				ringY += this.solvedT * 0.6 * s;
				this.beacon.ring.scale.setScalar(1 + 1.5 * (1 - s));
			} else this.beacon.ring.scale.setScalar(1);
			MAT.goal.emissiveIntensity = glow * 0.2;
			beamStrength.value =
				0.1 +
				0.06 * pulse +
				(this.solvedT >= 0 ? 0.5 * Math.exp(-this.solvedT * 1.2) : 0);
			this.beacon.ring.position.y = ringY;
			this.beacon.ring.rotation.z = time * 0.6;
		}
	}

	/** A spring at world x fired. */
	springFired(x: number): void {
		let best: SpringFx | null = null;
		for (const s of this.springs)
			if (!best || Math.abs(s.x - x) < Math.abs(best.x - x)) best = s;
		if (best) best.t = 0;
	}

	celebrate(): void {
		this.solvedT = 0;
	}

	/** The hover cursor and ghost part (null hides them). */
	setGhost(p: Placement | null, ok: boolean): void {
		disposeChildren(this.ghostGroup, false);
		const level = this.level;
		if (!p || !level) {
			this.cursor.visible = false;
			return;
		}
		this.cursor.visible = true;
		this.cursor.position.x = level.grid.origin[0] + (p.cell[0] + 0.5) * CELL;
		this.cursor.position.y = level.grid.origin[1] + (p.cell[1] + 0.5) * CELL;
		for (const pe of partEntities(level, p, "ghost", false)) {
			const vis = buildVisual(
				pe.entity.prefab,
				ok ? this.ghostOk : this.ghostBad,
			);
			const t = pe.entity.transform;
			vis.root.position.set(...t.position);
			if (t.rotation) vis.root.quaternion.set(...t.rotation);
			if (vis.cap) (vis.cap.parent as Object3D).rotation.z = springTilt(p.dir);
			vis.root.traverse((o) => {
				o.castShadow = false;
			});
			this.ghostGroup.add(vis.root);
		}
	}

	/** World centre and size of the level's grid (camera framing). */
	/** World centre and size of the level's grid (camera framing). Updated by setLevel; not a copy. */
	frame(): Readonly<{ cx: number; cy: number; w: number; h: number }> {
		return this.framing;
	}
}

/** Removes children (geometry is shared/cached in visuals.ts, so it is kept). */
function disposeChildren(g: Group, disposeGeometry = true): void {
	for (const c of [...g.children]) {
		g.remove(c);
		if (disposeGeometry)
			c.traverse((o) => {
				if (o instanceof Mesh) o.geometry.dispose();
			});
	}
}

let pegTex: CanvasTexture | null = null;
/** Dark blue-grey pegboard: a hole at every cell corner and faint cell lines. */
function pegboardMaterial(
	cols: number,
	rows: number,
): MeshStandardNodeMaterial {
	if (!pegTex) {
		const c = document.createElement("canvas");
		c.width = 128;
		c.height = 128;
		const g = c.getContext("2d") as CanvasRenderingContext2D;
		g.fillStyle = "#1b1f29";
		g.fillRect(0, 0, 128, 128);
		g.strokeStyle = "rgba(150,175,220,0.075)";
		g.lineWidth = 2;
		g.strokeRect(1, 1, 126, 126);
		g.fillStyle = "#0d0f14";
		for (const [x, y] of [
			[64, 64],
			[0, 0],
			[128, 0],
			[0, 128],
			[128, 128],
		] as const) {
			g.beginPath();
			g.arc(x, y, 4, 0, Math.PI * 2);
			g.fill();
		}
		pegTex = new CanvasTexture(c);
		pegTex.colorSpace = SRGBColorSpace;
		pegTex.wrapS = RepeatWrapping;
		pegTex.wrapT = RepeatWrapping;
		pegTex.anisotropy = 8;
	}
	const t = pegTex.clone();
	t.needsUpdate = true;
	// The plate is the grid plus margins; repeat one tile per cell, aligned to the grid.
	const w = cols + 0.5;
	const h = rows + 0.35;
	t.repeat.set(w, h);
	t.offset.set(-0.25, -0.0);
	return new MeshStandardNodeMaterial({
		map: t,
		roughness: 0.85,
		metalness: 0,
	});
}
