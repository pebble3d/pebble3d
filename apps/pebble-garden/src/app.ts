import { primitiveGeometry } from "@pebble3d/renderer";
import type { Game } from "@pebble3d/sdk/game";
import { parseScene, type Scene } from "@pebble3d/sdk/schema";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
	Box3,
	type BufferGeometry,
	Color,
	Euler,
	Mesh,
	MeshStandardNodeMaterial,
	type Object3D,
	Plane,
	Quaternion,
	Raycaster,
	Vector2,
	Vector3,
} from "three/webgpu";
import type { Sfx } from "./audio/sfx.ts";
import {
	addPiece,
	cloneDoc,
	duplicateEntity,
	emptyDoc,
	exportText,
	findEntity,
	type GardenDoc,
	type Quat,
	removeEntity,
	setBodyType,
	setMaterial,
	setTransform,
	type Vec3,
} from "./garden/doc.ts";
import { GARDENS, type GardenInfo, gardenByKey } from "./garden/gardens.ts";
import { History } from "./garden/history.ts";
import {
	type BodyKind,
	PIECES,
	type Piece,
	pieceByKey,
} from "./garden/pieces.ts";
import { type ResolvedEntity, resolveScene } from "./garden/resolve.ts";
import {
	DT,
	type Engine,
	GardenSim,
	GOAL_HOLD,
	type SimEvent,
	simulationProblem,
} from "./garden/sim.ts";
import {
	type ImportResult,
	importText,
	MAX_IMPORT_BYTES,
	tooLargeIssue,
} from "./garden/validate.ts";
import type { FieldChange, Hud, HudAction, InspectorData } from "./ui/hud.ts";
import { Fx } from "./view/fx.ts";
import { GardenView } from "./view/garden-view.ts";
import { Ground } from "./view/ground.ts";

/**
 * The Pebble Garden app: title, garden picker, the editor (place, select, gizmo, inspect),
 * Play / Reset over a fresh deterministic sim per run, the goal result card, and scene
 * export / import. The garden doc (raw scene JSON) is the only edit state; Play never
 * writes to it, so Reset is an exact rewind.
 */

export type Phase = "title" | "picker" | "edit" | "play" | "result";
type GizmoMode = "translate" | "rotate" | "scale";

/** Ticks to linger on the garden after the goal / failure before the result card. */
const GOAL_LINGER = 80;
const FAIL_LINGER = 45;
const SNAP = 0.25;
/** Inspector entries are clamped to a sane garden-sized range. */
const POS_LIMIT = 100;
const SCALE_LIMIT = 50;
const TITLE_LOOP = 60 * 14;

const _v = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _box = new Box3();

interface GhostInfo {
	geometry: BufferGeometry;
	rotation: Quat;
	/** Distance from the piece's centre down to its lowest point (as placed). */
	lift: number;
}

export class App {
	phase: Phase = "title";
	doc: GardenDoc = emptyDoc();
	scene: Scene = parseScene(emptyDoc());
	resolved: ResolvedEntity[] = [];
	garden: GardenInfo | null = null;
	gardenName = "Blank garden";
	challenge = false;
	locked = new Set<string>();
	sim: GardenSim | null = null;
	selected: string | null = null;
	armed: Piece | null = null;
	runs = 0;
	exports = 0;
	lastExport = "";
	imports = { ok: 0, failed: 0 };
	best: Record<string, number> = {};
	result: { won: boolean; stars: number; tick: number } | null = null;
	readonly view: GardenView;
	readonly fx: Fx;
	readonly ground: Ground;
	private readonly history = new History();
	private readonly gizmo: TransformControls;
	private gizmoMode: GizmoMode = "translate";
	private gizmoDragging = false;
	private readonly ray = new Raycaster();
	private readonly ndc = new Vector2();
	private readonly floor = new Plane(new Vector3(0, 1, 0), 0);
	private readonly pickList: Object3D[] = [];
	private readonly ghost: Mesh;
	private readonly ghostInfo = new Map<string, GhostInfo>();
	private pointerDown: { x: number; y: number; button: number } | null = null;
	private linger = -1;
	/** Title backdrop: the Rock Garden simulating on a loop. */
	private titleSim: GardenSim | null = null;
	private titleTick = 0;
	private camAuto: { pos: Vector3; target: Vector3 } | null = null;
	readonly camTarget = new Vector3(0, 0.8, 0);
	private time = 0;

	constructor(
		readonly game: Game,
		readonly engine: Engine,
		readonly hud: Hud,
		readonly sfx: Sfx,
		readonly canvas: HTMLCanvasElement,
		readonly interactive: boolean,
	) {
		const three = game.renderer.three;
		this.ground = new Ground(three.scene);
		this.view = new GardenView(three.scene);
		this.fx = new Fx(three.scene);
		this.ghost = new Mesh(
			primitiveGeometry("box", [1, 1, 1]),
			new MeshStandardNodeMaterial({
				color: new Color("#ffffff"),
				transparent: true,
				opacity: 0.45,
				depthWrite: false,
				roughness: 0.6,
			}),
		);
		this.ghost.visible = false;
		this.ghost.renderOrder = 3;
		three.scene.add(this.ghost);

		this.gizmo = new TransformControls(three.camera, canvas);
		this.gizmo.setSize(0.85);
		this.gizmo.setTranslationSnap(null);
		const helper = this.gizmo.getHelper();
		three.scene.add(helper);
		this.gizmo.addEventListener("dragging-changed", (ev) => {
			const dragging = (ev as unknown as { value: boolean }).value;
			this.gizmoDragging = dragging;
			const c = this.game.renderer.controller;
			if (c) c.enabled = !dragging;
			if (!dragging) this.commitGizmo();
		});
		this.gizmo.addEventListener("objectChange", () => this.gizmoLive());
		if (interactive) this.bindInput();
		try {
			const raw = localStorage.getItem("pebble-garden:best");
			const v: unknown = raw ? JSON.parse(raw) : null;
			if (v && typeof v === "object" && !Array.isArray(v))
				for (const [k, n] of Object.entries(v))
					if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 3)
						this.best[k] = n;
		} catch {
			// storage unavailable (private window, sandbox): best stars stay in memory
		}
	}

	// =====================================================================================
	// Screens
	// =====================================================================================

	showTitle(): void {
		this.stopSim();
		this.phase = "title";
		this.hud.show("title");
		this.selectEntity(null);
		this.arm(null);
		this.ground.showGrid(false);
		// The Rock Garden plays behind the title.
		const g = GARDENS.find((x) => x.key === "rock-garden") ?? GARDENS[0];
		if (g) this.loadDoc(g.doc, g, false, false);
		this.startTitleSim();
	}

	showPicker(kind: "challenges" | "sandbox"): void {
		this.phase = "picker";
		this.hud.showPicker(kind, this.best);
	}

	/** Opens a starter garden: `free` makes everything editable. */
	openGarden(key: string, free = false): void {
		const g = gardenByKey(key);
		if (!g) return;
		this.stopTitleSim();
		this.loadDoc(g.doc, g, g.par !== null && !free, true);
		this.enterEdit();
		this.hud.toast(g.blurb);
	}

	openBlank(): void {
		this.stopTitleSim();
		this.loadDoc(emptyDoc(), null, false, true);
		this.gardenName = "Blank garden";
		this.hud.setGarden(this.gardenName);
		this.enterEdit();
	}

	private loadDoc(
		doc: GardenDoc,
		g: GardenInfo | null,
		challenge: boolean,
		frame: boolean,
	): void {
		this.stopSim();
		this.importWarnings = [];
		this.doc = cloneDoc(doc);
		this.garden = g;
		this.gardenName = g?.name ?? "Imported scene";
		this.challenge = challenge;
		this.locked = new Set(challenge ? this.doc.entities.map((e) => e.id) : []);
		this.view.locked = this.locked;
		this.history.clear();
		this.selected = null;
		this.result = null;
		this.refresh();
		this.hud.setGarden(this.gardenName);
		if (frame) this.frameCamera();
	}

	private enterEdit(): void {
		this.stopSim();
		this.phase = "edit";
		this.hud.show("editor");
		this.hud.setPlaying(false);
		this.ground.showGrid(true);
		this.view.syncEdit();
		this.view.goalWon = false;
		this.attachGizmo();
		this.updateGoalStatus();
		this.updateHints();
		this.updateInspector();
	}

	// =====================================================================================
	// Doc edits
	// =====================================================================================

	private snapshot(): string {
		return JSON.stringify(this.doc);
	}

	/** Applies one undoable edit and refreshes everything that depends on the doc. */
	private edit(fn: (d: GardenDoc) => void, record = true): void {
		const before = this.snapshot();
		const trial = cloneDoc(this.doc);
		fn(trial);
		try {
			this.scene = parseScene(trial);
		} catch (e) {
			// Edits only produce valid scenes; this guards against a bad numeric entry.
			this.hud.toast(e instanceof Error ? e.message : String(e), "err");
			return;
		}
		if (record) this.history.push(before);
		this.doc = trial;
		this.refresh(false);
	}

	private refresh(parse = true): void {
		if (parse) this.scene = parseScene(this.doc);
		this.resolved = resolveScene(this.scene);
		this.hasGoal =
			this.resolved.some((e) => e.role === "goal") &&
			this.resolved.some((e) => e.role === "pebble");
		this.piecesUsedCached = this.piecesUsed();
		this.view.setEntities(this.resolved);
		if (this.selected && !this.resolved.some((e) => e.id === this.selected))
			this.selected = null;
		this.view.select(this.selected);
		if (this.phase === "edit") {
			this.attachGizmo();
			this.updateInspector();
			this.updateGoalStatus();
		}
	}

	undo(): void {
		if (this.phase !== "edit") return;
		const s = this.history.undo(this.snapshot());
		if (s === null) {
			this.hud.toast("Nothing to undo", "warn");
			return;
		}
		this.doc = JSON.parse(s) as GardenDoc;
		this.refresh();
		this.sfx.pick();
	}

	redo(): void {
		if (this.phase !== "edit") return;
		const s = this.history.redo(this.snapshot());
		if (s === null) {
			this.hud.toast("Nothing to redo", "warn");
			return;
		}
		this.doc = JSON.parse(s) as GardenDoc;
		this.refresh();
		this.sfx.pick();
	}

	/** Places a palette piece with its centre at `pos` (y as given). Returns the id. */
	place(key: string, pos: Vec3, rotation?: Quat): string | null {
		if (this.phase !== "edit") return null;
		const piece = pieceByKey(key);
		if (!piece) return null;
		let id: string | null = null;
		this.edit((d) => {
			id = addPiece(d, piece, pos, rotation);
		});
		if (id) {
			this.selectEntity(id);
			this.sfx.place();
			const r = this.resolved.find((e) => e.id === id);
			if (r)
				this.fx.puff(r.position[0], r.position[1] - 0.2, r.position[2], 0.6);
		}
		return id;
	}

	/** Where a piece lands when dropped on a surface point: resting on it, snapped. */
	restingPosition(key: string, hit: Vector3, snap: boolean): Vec3 {
		const g = this.ghostFor(key);
		const x = snap ? Math.round(hit.x / SNAP) * SNAP : hit.x;
		const z = snap ? Math.round(hit.z / SNAP) * SNAP : hit.z;
		return [x, hit.y + g.lift, z];
	}

	private ghostFor(key: string): GhostInfo {
		let g = this.ghostInfo.get(key);
		if (g) return g;
		const piece = pieceByKey(key) as Piece;
		const d = emptyDoc();
		addPiece(d, piece, [0, 0, 0]);
		const e = resolveScene(parseScene(d))[0] as ResolvedEntity;
		const geometry = primitiveGeometry(e.primitive ?? "box", e.scale);
		const m = new Mesh(geometry);
		m.quaternion.set(...e.rotation);
		m.updateMatrixWorld(true);
		_box.setFromObject(m);
		g = { geometry, rotation: e.rotation, lift: -_box.min.y };
		this.ghostInfo.set(key, g);
		return g;
	}

	selectEntity(id: string | null): void {
		this.selected = id;
		this.view.select(id);
		this.attachGizmo();
		this.updateInspector();
		this.updateHints();
	}

	isLocked(id: string): boolean {
		return this.locked.has(id);
	}

	deleteSelected(): void {
		const id = this.selected;
		if (!id || this.phase !== "edit") return;
		if (this.isLocked(id)) {
			this.hud.toast("That piece is part of the garden (locked)", "warn");
			return;
		}
		const r = this.resolved.find((e) => e.id === id);
		this.edit((d) => {
			removeEntity(d, id);
		});
		this.selectEntity(null);
		this.sfx.remove();
		if (r) this.fx.puff(r.position[0], r.position[1], r.position[2], 1);
	}

	duplicateSelected(): void {
		const id = this.selected;
		if (!id || this.phase !== "edit") return;
		let copy: string | null = null;
		this.edit((d) => {
			copy = duplicateEntity(d, id, [0.5, 0, 0.5]);
		});
		if (copy) {
			this.selectEntity(copy);
			this.sfx.place();
		}
	}

	setBody(type: BodyKind): void {
		const id = this.selected;
		if (!id || this.isLocked(id) || this.phase !== "edit") return;
		const r = this.resolved.find((e) => e.id === id);
		if (r?.primitive === "plane" && type !== "static") {
			this.hud.toast("A plane collider is static only", "warn");
			return;
		}
		this.edit((d) => setBodyType(d, id, type));
		this.sfx.pick();
	}

	setColor(color: string, record = true): void {
		const id = this.selected;
		if (!id || this.isLocked(id) || this.phase !== "edit") return;
		this.edit((d) => setMaterial(d, id, { color }), record);
	}

	/** Live slider drags update the material directly and commit once on release. */
	field(c: FieldChange, commit: boolean): void {
		const id = this.selected;
		if (!id || this.isLocked(id) || this.phase !== "edit") return;
		const v = this.view.get(id);
		if (c.field === "color") {
			if (!commit && v) {
				v.material.color.set(c.value);
				return;
			}
			this.setColor(c.value);
			return;
		}
		if (c.field === "roughness" || c.field === "metalness") {
			if (!commit) {
				if (v) v.material[c.field] = c.value;
				return;
			}
			this.edit((d) => setMaterial(d, id, { [c.field]: c.value }));
			return;
		}
		const r = this.resolved.find((e) => e.id === id);
		if (!r) return;
		if (c.field === "rotY") {
			if (!commit) {
				if (v) v.root.quaternion.copy(this.withYaw(r.rotation, c.value));
				return;
			}
			const q = this.withYaw(r.rotation, c.value);
			this.edit((d) => setTransform(d, id, r.position, [q.x, q.y, q.z, q.w]));
			return;
		}
		if (c.field !== "pos" && c.field !== "scale") return;
		const pos: Vec3 = [...r.position];
		const scale: Vec3 = [...r.scale];
		if (c.field === "pos")
			pos[c.axis] = Math.max(-POS_LIMIT, Math.min(POS_LIMIT, c.value));
		else {
			if (c.value <= 0) {
				this.hud.toast("Scale must be above 0", "warn");
				return;
			}
			const v = Math.min(SCALE_LIMIT, c.value);
			if (r.primitive === "sphere") scale.fill(v);
			else scale[c.axis] = v;
		}
		this.edit((d) =>
			setTransform(
				d,
				id,
				pos,
				r.rotation,
				c.field === "scale" ? scale : undefined,
			),
		);
	}

	/** `q` with its heading replaced by `deg` (pitch and roll kept). */
	private withYaw(q: Quat, deg: number): Quaternion {
		_q.set(...q);
		_e.setFromQuaternion(_q, "YXZ");
		_e.y = (deg * Math.PI) / 180;
		return new Quaternion().setFromEuler(_e);
	}

	/** Sets the selected piece's size (the demo's "inspector" edit). */
	scaleSelected(scale: Vec3): void {
		const id = this.selected;
		if (!id || this.isLocked(id) || this.phase !== "edit") return;
		const r = this.resolved.find((e) => e.id === id);
		if (!r) return;
		this.edit((d) => setTransform(d, id, r.position, r.rotation, scale));
		this.sfx.pick();
	}

	turnSelected(deg: number): void {
		const id = this.selected;
		if (!id || this.isLocked(id) || this.phase !== "edit") return;
		const r = this.resolved.find((e) => e.id === id);
		if (!r) return;
		_q.setFromAxisAngle(_v.set(0, 1, 0), (deg * Math.PI) / 180);
		const q = new Quaternion(...r.rotation).premultiply(_q);
		this.edit((d) => setTransform(d, id, r.position, [q.x, q.y, q.z, q.w]));
	}

	nudgeSelected(dx: number, dy: number, dz: number): void {
		const id = this.selected;
		if (!id || this.isLocked(id) || this.phase !== "edit") return;
		const r = this.resolved.find((e) => e.id === id);
		if (!r) return;
		const p = r.position;
		this.edit((d) =>
			setTransform(
				d,
				id,
				[p[0] + dx, Math.max(0, p[1] + dy), p[2] + dz],
				r.rotation,
			),
		);
	}

	setGizmoMode(m: GizmoMode): void {
		this.gizmoMode = m;
		this.gizmo.setMode(m);
		this.hud.setGizmoMode(m);
	}

	private attachGizmo(): void {
		const id = this.selected;
		const v = id ? this.view.get(id) : undefined;
		if (this.phase === "edit" && v && !this.isLocked(v.id)) {
			this.gizmo.attach(v.root);
			this.gizmo.setMode(this.gizmoMode);
			const sphere = v.entity.primitive === "sphere";
			this.gizmo.showX = true;
			this.gizmo.showY = true;
			this.gizmo.showZ = true;
			if (this.gizmoMode === "scale" && sphere) {
				this.gizmo.showX = false;
				this.gizmo.showZ = false;
			}
		} else this.gizmo.detach();
		this.gizmo.getHelper().visible = this.gizmo.object !== undefined;
	}

	private gizmoLive(): void {
		const id = this.selected;
		const v = id ? this.view.get(id) : undefined;
		if (!v) return;
		if (v.entity.primitive === "sphere") {
			const s = v.root.scale.y;
			v.root.scale.set(s, s, s);
		}
		if (v.root.position.y < -0.5) v.root.position.y = -0.5;
	}

	private commitGizmo(): void {
		// Only an edit-mode drag may write the doc (Space mid-drag starts the sim).
		if (this.phase !== "edit") return;
		const id = this.selected;
		const v = id ? this.view.get(id) : undefined;
		if (!v || !id) return;
		const r = v.entity;
		const root = v.root;
		const scaled =
			Math.abs(root.scale.x - 1) > 1e-4 ||
			Math.abs(root.scale.y - 1) > 1e-4 ||
			Math.abs(root.scale.z - 1) > 1e-4;
		const scale: Vec3 = [
			r.scale[0] * root.scale.x,
			r.scale[1] * root.scale.y,
			r.scale[2] * root.scale.z,
		];
		const p = root.position;
		const q = root.quaternion;
		const moved =
			scaled ||
			Math.abs(p.x - r.position[0]) > 1e-4 ||
			Math.abs(p.y - r.position[1]) > 1e-4 ||
			Math.abs(p.z - r.position[2]) > 1e-4 ||
			Math.abs(q.x - r.rotation[0]) +
				Math.abs(q.y - r.rotation[1]) +
				Math.abs(q.z - r.rotation[2]) +
				Math.abs(q.w - r.rotation[3]) >
				1e-5;
		if (!moved) return;
		this.edit((d) =>
			setTransform(
				d,
				id,
				[p.x, p.y, p.z],
				[q.x, q.y, q.z, q.w],
				scaled ? scale : undefined,
			),
		);
		this.sfx.pick();
	}

	arm(key: string | null): void {
		this.armed = key ? (pieceByKey(key) ?? null) : null;
		this.hud.setArmed(this.armed?.key ?? null);
		if (this.armed) {
			const g = this.ghostFor(this.armed.key);
			this.ghost.geometry = g.geometry;
			this.ghost.quaternion.set(...g.rotation);
			const e =
				this.armed.prefab?.mesh?.material?.color ??
				this.armed.inline?.mesh?.material?.color;
			(this.ghost.material as MeshStandardNodeMaterial).color.set(
				e ?? "#ffffff",
			);
		} else this.ghost.visible = false;
		this.updateHints();
	}

	/** Shows the placement ghost at a resting point (the demo uses this too). */
	ghostAt(key: string | null, pos?: Vec3): void {
		if (!key || !pos) {
			this.ghost.visible = false;
			return;
		}
		if (this.armed?.key !== key) this.arm(key);
		this.ghost.position.set(...pos);
		this.ghost.visible = true;
	}

	// =====================================================================================
	// Play / Reset
	// =====================================================================================

	play(): void {
		if (this.phase !== "edit") return;
		this.stopSim();
		try {
			this.sim = new GardenSim(this.engine, this.scene);
		} catch (err) {
			this.hud.toast(err instanceof Error ? err.message : String(err), "err");
			this.sfx.error();
			return;
		}
		this.runs++;
		this.phase = "play";
		this.linger = -1;
		this.result = null;
		this.arm(null);
		this.gizmo.detach();
		this.gizmo.getHelper().visible = false;
		this.hud.setPlaying(true);
		this.updateGoalStatus();
		this.ground.showGrid(false);
		this.sfx.play();
		this.updateHints();
	}

	/** Rewinds to the edit state: the run's world is freed; the doc was never touched. */
	reset(): void {
		if (this.phase !== "play" && this.phase !== "result") return;
		this.hud.closeModal();
		this.sfx.rewind();
		this.enterEdit();
	}

	togglePlay(): void {
		if (this.phase === "edit") this.play();
		else if (this.phase === "play" || this.phase === "result") this.reset();
	}

	private stopSim(): void {
		this.sim?.dispose();
		this.sim = null;
	}

	private startTitleSim(): void {
		this.stopTitleSim();
		this.titleSim = new GardenSim(this.engine, this.scene);
		this.titleTick = 0;
	}

	private stopTitleSim(): void {
		this.titleSim?.dispose();
		this.titleSim = null;
	}

	piecesUsed(): number {
		return this.doc.entities.filter((e) => !this.locked.has(e.id)).length;
	}

	starsFor(used: number): number {
		const par = this.garden?.par ?? 1;
		return used <= par ? 3 : used <= par + 1 ? 2 : 1;
	}

	/** One fixed 60 Hz tick (the demo driver runs just before it). */
	tick(): void {
		this.time += DT;
		if (this.titleSim && this.phase !== "edit" && this.phase !== "play") {
			this.titleSim.step();
			this.titleSim.drain(noop);
			if (++this.titleTick >= TITLE_LOOP) this.startTitleSim();
		}
		const sim = this.sim;
		if (!sim) return;
		if (this.phase === "play" || this.phase === "result") {
			sim.step();
			sim.drain(this.onEvent);
		}
		if (this.phase === "play" && sim.goalMode && sim.status !== "running") {
			if (this.linger < 0)
				this.linger = sim.status === "goal" ? GOAL_LINGER : FAIL_LINGER;
			if (--this.linger <= 0) this.finish();
		}
	}

	private readonly onEvent = (e: SimEvent): void => {
		if (e.kind === "impact") {
			this.sfx.impact(e.strength);
			if (e.y < 0.6 && e.strength > 1.6)
				this.fx.puff(e.x, e.y, e.z, e.strength);
		} else if (e.kind === "goal-enter") this.sfx.pick();
		else if (e.kind === "goal") {
			this.sfx.goal();
			this.fx.bloom(e.x, e.y, e.z);
			this.view.goalWon = true;
		} else if (e.kind === "failed") this.sfx.fail();
	};

	private finish(): void {
		const sim = this.sim;
		if (!sim) return;
		const won = sim.status === "goal";
		const used = this.piecesUsed();
		const st = won && this.challenge ? this.starsFor(used) : 0;
		this.result = { won, stars: st, tick: sim.tick };
		this.phase = "result";
		const key = this.garden?.key;
		if (won && key && this.challenge) {
			if ((this.best[key] ?? 0) < st) this.best[key] = st;
			try {
				localStorage.setItem("pebble-garden:best", JSON.stringify(this.best));
			} catch {
				// storage unavailable: keep in memory
			}
		}
		const idx =
			this.challenge && this.garden ? GARDENS.indexOf(this.garden) : -1;
		const nextG = idx >= 0 ? GARDENS[idx + 1] : undefined;
		const reason =
			sim.reason === "lost"
				? "The pebble rolled out of the garden."
				: sim.reason === "stopped"
					? "Everything came to rest, but not in the bowl."
					: "Time ran out.";
		this.hud.showResult({
			won,
			title: won ? "The pebble rests in the bowl" : "Not this time",
			sub: won
				? this.challenge
					? used <= (this.garden?.par ?? 0)
						? "Solved at par. A quiet, perfect garden."
						: `Solved. Par is ${this.garden?.par} piece${this.garden?.par === 1 ? "" : "s"}.`
					: "Your garden reaches its goal."
				: `${reason} Reset rewinds to exactly where you were.`,
			stars: st,
			stats: [
				["Time", `${(sim.tick / 60).toFixed(2)} s`],
				[
					"Pieces",
					this.challenge
						? `${used} / par ${this.garden?.par}`
						: String(this.doc.entities.length),
				],
				["Run", `#${this.runs}`],
			],
			next: won && nextG !== undefined && nextG.par !== null,
		});
	}

	next(): void {
		const idx = this.garden ? GARDENS.indexOf(this.garden) : -1;
		const g = GARDENS[idx + 1];
		if (g && g.par !== null) this.openGarden(g.key);
		else this.showPicker("challenges");
	}

	// =====================================================================================
	// Export / import
	// =====================================================================================

	exportGarden(): string {
		const text = exportText(this.doc);
		const check = importText(text);
		const prefabs = Object.keys(this.doc.prefabs ?? {}).length;
		const kb = (new Blob([text]).size / 1024).toFixed(1);
		const ok = check.ok;
		this.hud.showExport(
			text,
			ok
				? `<span class="ok-chip">schema-valid</span> &nbsp;Checked against the Pebble3D scene schema. Open it in the playground, another game, or hand it to an agent.`
				: "This garden failed its own schema check (please report it).",
			`${this.doc.entities.length} entities · ${prefabs} prefab${prefabs === 1 ? "" : "s"} · ${kb} KB`,
			this.importWarnings,
		);
		this.exports++;
		this.lastExport = text;
		this.sfx.success();
		return text;
	}

	fileName(): string {
		const base = (this.garden?.key ?? this.gardenName)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
		return `${base || "garden"}.json`;
	}

	download(): void {
		const blob = new Blob([this.lastExport || exportText(this.doc)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = this.fileName();
		document.body.append(a);
		a.click();
		a.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
		this.hud.toast(`Saved ${this.fileName()}`);
	}

	copy(): void {
		const text = this.lastExport || exportText(this.doc);
		const done = (): void => {
			this.hud.setCopyLabel("Copied");
			this.hud.toast("Scene JSON copied to the clipboard");
		};
		const clip = navigator.clipboard;
		if (!clip) {
			this.hud.toast(
				"Clipboard unavailable here: select the text and copy it",
				"warn",
			);
			return;
		}
		clip.writeText(text).then(done, () => {
			this.hud.toast(
				"The browser blocked the clipboard: select the text and copy it",
				"warn",
			);
		});
	}

	/** Validates and opens scene JSON text. Returns true when it loaded. */
	/** Warnings from the last import (shown again on the export sheet). */
	importWarnings: string[] = [];

	importScene(text: string, name: string): boolean {
		let r: ImportResult;
		try {
			r = importText(text);
		} catch (err) {
			// Validation itself must never take the page down; report it like any issue.
			r = {
				ok: false,
				stage: "schema",
				issues: [
					{
						path: "",
						message: `could not validate this scene: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
			};
		}
		if (r.ok) {
			// Schema-valid is not enough: the engine must accept every entity too.
			const problem = simulationProblem(this.engine, r.scene);
			if (problem)
				r = {
					ok: false,
					stage: "schema",
					issues: [{ path: "", message: problem }],
				};
		}
		if (!r.ok) {
			this.imports.failed++;
			const n = r.issues.length;
			const huge = text.length > MAX_IMPORT_BYTES;
			this.hud.showImport(
				huge ? "" : text,
				r.issues,
				r.stage === "json"
					? huge
						? "This file is too large, so nothing was changed."
						: "This is not valid JSON, so nothing was changed."
					: `${n} problem${n === 1 ? "" : "s"}: the garden was not changed.`,
			);
			this.sfx.error();
			return false;
		}
		this.imports.ok++;
		this.stopTitleSim();
		this.hud.closeModal();
		this.loadDoc(r.doc, null, false, true);
		this.gardenName = name.replace(/\.json$/i, "") || "Imported scene";
		this.hud.setGarden(this.gardenName);
		this.enterEdit();
		const pieces = r.doc.entities.length;
		const w = r.warnings;
		if (w.length)
			this.hud.toast(
				w.length > 1
					? `${w[0]} (+${w.length - 1} more: see the export sheet)`
					: (w[0] as string),
				"warn",
			);
		else
			this.hud.toast(
				`Opened ${pieces} entit${pieces === 1 ? "y" : "ies"}: schema-valid`,
			);
		this.importWarnings = w;
		this.sfx.success();
		return true;
	}

	/** Reads a dropped or chosen file, refusing oversize files before reading them. */
	importFile(f: File): void {
		if (f.size > MAX_IMPORT_BYTES) {
			this.imports.failed++;
			this.hud.showImport(
				"",
				[tooLargeIssue(f.size)],
				"This file is too large, so nothing was changed.",
			);
			this.sfx.error();
			return;
		}
		f.text().then(
			(t) => this.importScene(t, f.name),
			() => this.hud.toast(`Could not read ${f.name}`, "err"),
		);
	}

	// =====================================================================================
	// Camera and per-frame presentation
	// =====================================================================================

	private frameCamera(): void {
		const hero = this.scene.camera.presets.hero;
		const pos = hero ? new Vector3(...hero.position) : new Vector3(7, 6.5, 10);
		const target = hero ? new Vector3(...hero.target) : new Vector3(0, 0.6, 0);
		const cam = this.game.renderer.three.camera;
		if (hero && cam.fov !== hero.fov) {
			cam.fov = hero.fov;
			cam.updateProjectionMatrix();
		}
		this.camTarget.copy(target);
		const c = this.game.renderer.controller;
		if (c) c.setPose(pos, target);
		else {
			cam.position.copy(pos);
			cam.lookAt(target);
		}
	}

	/** Demo / scripted camera: glide toward a pose (null hands control back). */
	glideCamera(pos: Vec3 | null, target?: Vec3): void {
		this.camAuto = pos
			? {
					pos: new Vector3(...pos),
					target: new Vector3(...(target ?? [0, 0.6, 0])),
				}
			: null;
	}

	frame(dt: number, alpha: number): void {
		const three = this.game.renderer.three;
		const cam = three.camera;
		const ctl = this.game.renderer.controller;
		if (this.phase === "title" || this.phase === "picker") {
			if (ctl) ctl.enabled = false;
			const a = this.time * 0.06 + 0.6;
			cam.position.set(Math.sin(a) * 17, 8.5, Math.cos(a) * 17);
			cam.lookAt(1.5, 0.8, 0);
		} else if (this.camAuto) {
			if (ctl) ctl.enabled = false;
			const k = dt > 0 ? 1 - Math.exp(-dt * 2.2) : 0;
			cam.position.lerp(this.camAuto.pos, k);
			this.camTarget.lerp(this.camAuto.target, k);
			cam.lookAt(this.camTarget);
		} else if (ctl && !this.gizmoDragging) ctl.enabled = this.interactive;

		const titleSim = this.titleSim;
		if ((this.phase === "play" || this.phase === "result") && this.sim)
			this.view.syncPlay(this.sim, alpha);
		else if (titleSim && (this.phase === "title" || this.phase === "picker"))
			this.view.syncPlay(titleSim, alpha);
		this.view.frame(dt);
		this.fx.frame(dt);
		this.ground.frame(dt);
		this.sfx.frame();
		if (this.phase === "play") this.updateGoalLive();
	}

	// =====================================================================================
	// HUD sync
	// =====================================================================================

	/** Full goal readout (edit mode, phase changes): may allocate. */
	updateGoalStatus(): void {
		const pieces =
			this.challenge && this.garden
				? `Pieces ${this.piecesUsedCached} / par ${this.garden.par}`
				: null;
		this.hud.goalPip = this.hasGoal;
		this.shown.tenths = -1;
		this.shown.pct = -1;
		this.shown.status = "";
		if (
			this.hasGoal &&
			this.sim &&
			(this.phase === "play" || this.phase === "result")
		) {
			this.hud.setGoalStatus(pieces, "", false, 0);
			this.updateGoalLive();
		} else
			this.hud.setGoalStatus(
				pieces,
				this.hasGoal
					? "Goal: rest the pebble in the bowl"
					: `${this.doc.entities.length} entities`,
				false,
				null,
			);
	}

	/** Per-frame play readout: touches the DOM only when a shown value changes. */
	private updateGoalLive(): void {
		const sim = this.sim;
		if (!sim || !this.hasGoal) return;
		const tenths = Math.floor(sim.tick / 6);
		const pct = Math.min(100, Math.round((sim.inGoal / GOAL_HOLD) * 100));
		const st = sim.status;
		const s = this.shown;
		if (tenths === s.tenths && pct === s.pct && st === s.status) return;
		if (st === s.status && st !== "running" && pct === s.pct) return;
		s.tenths = tenths;
		s.pct = pct;
		s.status = st;
		const text =
			st === "goal"
				? "In the bowl"
				: st === "failed"
					? "Missed"
					: `${(tenths / 10).toFixed(1)} s`;
		this.hud.setGoalLive(text, st === "goal", pct);
	}

	private readonly shown = { tenths: -1, pct: -1, status: "" };
	private hasGoal = false;
	private piecesUsedCached = 0;

	private updateHints(): void {
		let t: string;
		if (this.phase === "play")
			t =
				"Simulating &middot; <kbd>Space</kbd> reset rewinds exactly to your edit &middot; drag to orbit";
		else if (this.armed)
			t = `Placing <b>${this.armed.label}</b>: click the sand or a surface &middot; <kbd>Shift</kbd>-click keeps placing &middot; <kbd>Alt</kbd> no snap &middot; <kbd>Esc</kbd> cancel`;
		else if (this.selected)
			t = this.isLocked(this.selected)
				? "This piece belongs to the garden and is locked &middot; add your own from the palette"
				: "<kbd>G</kbd> move &middot; <kbd>R</kbd> rotate &middot; <kbd>S</kbd> scale &middot; <kbd>Q</kbd><kbd>E</kbd> turn &middot; arrows nudge &middot; <kbd>Del</kbd> delete &middot; <kbd>Space</kbd> play";
		else
			t =
				"Click a piece, then click the sand to place it &middot; drag to orbit &middot; right-drag to pan &middot; <kbd>Space</kbd> play &middot; <kbd>?</kbd> help";
		this.hud.setHints(t);
	}

	private updateInspector(): void {
		const id = this.selected;
		const r = id ? this.resolved.find((e) => e.id === id) : undefined;
		if (!r || this.phase !== "edit") {
			this.hud.inspect(null);
			return;
		}
		_q.set(...r.rotation);
		_e.setFromQuaternion(_q, "YXZ");
		const piece = r.prefab
			? PIECES.find((p) => p.prefabName === r.prefab)
			: undefined;
		const label = r.unsupported
			? "Kept from the imported file (not simulated here)"
			: `${piece ? piece.label : r.primitive ? `${r.primitive[0]?.toUpperCase()}${r.primitive.slice(1)}` : "Entity"}${r.prefab ? ` · prefab "${r.prefab}"` : ""}${r.role === "pebble" ? " · the pebble" : r.role === "goal" ? " · the goal" : ""}`;
		const data: InspectorData = {
			id: r.id,
			label,
			locked: this.isLocked(r.id),
			editable: !this.isLocked(r.id) && !r.unsupported,
			body: r.body,
			color: normalizeHex(r.color),
			roughness: r.roughness,
			metalness: r.metalness,
			position: r.position,
			rotY: (_e.y * 180) / Math.PI,
			scale: r.scale,
		};
		this.hud.inspect(data);
		this.hud.setGizmoMode(this.gizmoMode);
	}

	// =====================================================================================
	// HUD actions and input
	// =====================================================================================

	action(a: HudAction, arg?: string): void {
		switch (a) {
			case "title":
			case "menu":
				this.showTitle();
				break;
			case "challenges":
				this.showPicker("challenges");
				break;
			case "sandbox":
				this.showPicker("sandbox");
				break;
			case "open": {
				const [key, free] = (arg ?? "").split(":");
				if (key) this.openGarden(key, free === "free");
				break;
			}
			case "blank":
				this.openBlank();
				break;
			case "piece":
				if (this.phase !== "edit") break;
				this.arm(this.armed?.key === arg ? null : (arg ?? null));
				this.sfx.pick();
				break;
			case "play":
				this.togglePlay();
				break;
			case "reset":
				this.reset();
				break;
			case "undo":
				this.undo();
				break;
			case "redo":
				this.redo();
				break;
			case "export":
				this.exportGarden();
				break;
			case "import":
				this.hud.showImport();
				break;
			case "download":
				this.download();
				break;
			case "copy":
				this.copy();
				break;
			case "import-apply":
				this.importScene(this.hud.importValue(), "Pasted scene");
				break;
			case "close":
				this.hud.closeModal();
				break;
			case "delete":
				this.deleteSelected();
				break;
			case "duplicate":
				this.duplicateSelected();
				break;
			case "body":
				if (arg?.startsWith("color:")) this.setColor(arg.slice(6));
				else if (arg === "static" || arg === "dynamic" || arg === "kinematic")
					this.setBody(arg);
				break;
			case "mode":
				if (arg === "translate" || arg === "rotate" || arg === "scale")
					this.setGizmoMode(arg);
				break;
			case "retry":
				this.reset();
				break;
			case "next":
				this.next();
				break;
			case "help":
				this.hud.showHelp();
				break;
		}
	}

	private bindInput(): void {
		const c = this.canvas;
		c.addEventListener("pointerdown", (e) => {
			this.pointerDown = { x: e.clientX, y: e.clientY, button: e.button };
		});
		c.addEventListener("pointermove", (e) => {
			this.hoverAt(e.clientX, e.clientY, e.altKey);
		});
		c.addEventListener("pointerleave", () => {
			this.ghost.visible = false;
			this.view.hover(null);
		});
		c.addEventListener("pointerup", (e) => {
			const d = this.pointerDown;
			this.pointerDown = null;
			if (d?.button !== 0 || this.gizmoDragging) return;
			if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
			if (this.gizmo.axis !== null && this.gizmo.object) return; // a gizmo handle click
			this.clickAt(e.clientX, e.clientY, e.shiftKey, e.altKey);
		});
		window.addEventListener("keydown", (e) => this.onKey(e));
		// Drag and drop a scene file anywhere.
		let depth = 0;
		window.addEventListener("dragenter", (e) => {
			e.preventDefault();
			depth++;
			this.hud.showDrop(true);
		});
		window.addEventListener("dragover", (e) => e.preventDefault());
		window.addEventListener("dragleave", () => {
			depth = Math.max(0, depth - 1);
			if (depth === 0) this.hud.showDrop(false);
		});
		window.addEventListener("drop", (e) => {
			e.preventDefault();
			depth = 0;
			this.hud.showDrop(false);
			const f = e.dataTransfer?.files?.[0];
			if (f) this.importFile(f);
			else {
				const t = e.dataTransfer?.getData("text/plain");
				if (t) this.importScene(t, "Dropped scene");
			}
		});
	}

	private setRay(x: number, y: number): void {
		const r = this.canvas.getBoundingClientRect();
		this.ndc.set(
			((x - r.left) / r.width) * 2 - 1,
			-((y - r.top) / r.height) * 2 + 1,
		);
		this.ray.setFromCamera(this.ndc, this.game.renderer.three.camera);
	}

	/** The entity under the cursor (edit mode) and the surface point to place on. */
	private pickAt(
		x: number,
		y: number,
	): { id: string | null; point: Vector3 | null } {
		this.setRay(x, y);
		const hits = this.ray.intersectObjects(
			this.view.meshes(this.pickList),
			false,
		);
		const h = hits[0];
		if (h)
			return {
				id: (h.object.userData.entityId as string) ?? null,
				point: h.point.clone(),
			};
		const p = new Vector3();
		return { id: null, point: this.ray.ray.intersectPlane(this.floor, p) };
	}

	private hoverAt(x: number, y: number, alt: boolean): void {
		if (this.phase !== "edit" || this.gizmoDragging) return;
		const { id, point } = this.pickAt(x, y);
		this.view.hover(this.armed ? null : id);
		this.canvas.style.cursor = this.armed ? "copy" : id ? "pointer" : "";
		if (this.armed && point) {
			const pos = this.restingPosition(this.armed.key, point, !alt);
			this.ghost.position.set(...pos);
			this.ghost.visible = true;
		} else this.ghost.visible = false;
	}

	private clickAt(x: number, y: number, shift: boolean, alt: boolean): void {
		if (this.phase !== "edit") return;
		const { id, point } = this.pickAt(x, y);
		if (this.armed && point) {
			const key = this.armed.key;
			this.place(key, this.restingPosition(key, point, !alt));
			if (shift) this.arm(key);
			else this.arm(null);
			return;
		}
		this.selectEntity(id);
		if (id) this.sfx.pick();
	}

	private onKey(e: KeyboardEvent): void {
		if (this.phase === "title" || this.phase === "picker") return;
		// Editor shortcuts wait until a gizmo drag is released.
		if (this.gizmoDragging) return;
		const ctrl = e.ctrlKey || e.metaKey;
		const k = e.key;
		if (k === "Escape") {
			if (this.hud.modalOpen && this.hud.modalOpen !== "result")
				this.hud.closeModal();
			else if (this.armed) this.arm(null);
			else if (this.selected) this.selectEntity(null);
			return;
		}
		if (this.hud.modalOpen) return;
		if (e.code === "Space") {
			e.preventDefault();
			this.togglePlay();
			return;
		}
		if (ctrl && (k === "z" || k === "Z")) {
			e.preventDefault();
			if (e.shiftKey) this.redo();
			else this.undo();
			return;
		}
		if (ctrl && (k === "y" || k === "Y")) {
			e.preventDefault();
			this.redo();
			return;
		}
		if (ctrl && (k === "d" || k === "D")) {
			e.preventDefault();
			this.duplicateSelected();
			return;
		}
		if (ctrl) return;
		if (this.phase !== "edit") return;
		const piece = PIECES.find((p) => p.hotkey === k);
		if (piece) {
			this.arm(this.armed?.key === piece.key ? null : piece.key);
			return;
		}
		switch (k) {
			case "Delete":
			case "Backspace":
				this.deleteSelected();
				break;
			case "g":
			case "G":
			case "w":
				this.setGizmoMode("translate");
				break;
			case "r":
			case "R":
				this.setGizmoMode("rotate");
				break;
			case "s":
			case "S":
				this.setGizmoMode("scale");
				break;
			case "q":
				this.turnSelected(15);
				break;
			case "e":
				this.turnSelected(-15);
				break;
			case "ArrowLeft":
				this.nudgeSelected(-SNAP, 0, 0);
				break;
			case "ArrowRight":
				this.nudgeSelected(SNAP, 0, 0);
				break;
			case "ArrowUp":
				this.nudgeSelected(0, 0, -SNAP);
				break;
			case "ArrowDown":
				this.nudgeSelected(0, 0, SNAP);
				break;
			case "PageUp":
				this.nudgeSelected(0, SNAP, 0);
				break;
			case "PageDown":
				this.nudgeSelected(0, -SNAP, 0);
				break;
			case "x":
			case "X":
				this.exportGarden();
				break;
			case "i":
			case "I":
				this.hud.showImport();
				break;
			case "?":
				this.hud.showHelp();
				break;
			default:
				return;
		}
		e.preventDefault();
	}

	/** Entities, for probes. */
	findEntity(id: string): ReturnType<typeof findEntity> {
		return findEntity(this.doc, id);
	}
}

function noop(): void {}

function normalizeHex(c: string): string {
	if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
	if (/^#[0-9a-f]{3}$/i.test(c))
		return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase();
	try {
		return `#${new Color(c).getHexString()}`;
	} catch {
		return "#cccccc";
	}
}
