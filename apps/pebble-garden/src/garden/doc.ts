import type { SceneInput } from "@pebble3d/sdk/schema";
import type { BodyKind, EntityInput, Piece } from "./pieces.ts";

/**
 * The editor's source of truth: the raw scene JSON object, exactly what Export writes.
 * Every edit is a small mutation of this object; Play parses it with the engine schema and
 * spawns a fresh world from it, and Reset simply throws that world away, so the edit state
 * is never touched by the simulation (rewind is exact by construction).
 */
export type GardenDoc = SceneInput & { entities: EntityInput[] };

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Decimal places kept for edited transforms (keeps exported JSON tidy). */
const PLACES = 4;

export function round(x: number, places = PLACES): number {
	const k = 10 ** places;
	const r = Math.round(x * k) / k;
	return Object.is(r, -0) ? 0 : r;
}

/** The look every new garden gets (the editor renders with its own fixed lighting). */
export function emptyDoc(): GardenDoc {
	return {
		version: 1,
		environment: { preset: "studio", ground: { color: "#e8dcc4" } },
		camera: {
			presets: {
				hero: { position: [7, 6, 9], target: [0, 0.8, 0], fov: 45 },
			},
		},
		sim: { seed: 1 },
		entities: [],
	};
}

/** Accepts any validated scene object as a doc (entities array made explicit). */
export function toDoc(scene: SceneInput): GardenDoc {
	const d = structuredClone(scene) as GardenDoc;
	if (!Array.isArray(d.entities)) d.entities = [];
	return d;
}

export function cloneDoc(d: GardenDoc): GardenDoc {
	return structuredClone(d);
}

export function findEntity(d: GardenDoc, id: string): EntityInput | undefined {
	return d.entities.find((e) => e.id === id);
}

/** A fresh id: `stem` if free, else `stem-2`, `stem-3`... */
export function newId(d: GardenDoc, stem: string): string {
	const used = new Set(d.entities.map((e) => e.id));
	if (!used.has(stem)) return stem;
	for (let i = 2; ; i++) {
		const id = `${stem}-${i}`;
		if (!used.has(id)) return id;
	}
}

/** Adds a palette piece at `position` (centre). Returns the new entity's id. */
export function addPiece(
	d: GardenDoc,
	piece: Piece,
	position: Vec3,
	rotation?: Quat,
): string {
	const id = newId(d, piece.idStem);
	const pos: Vec3 = [
		round(position[0]),
		round(position[1]),
		round(position[2]),
	];
	const rot = rotation ?? piece.rotation;
	let e: EntityInput;
	if (piece.prefabName && piece.prefab) {
		d.prefabs ??= {};
		if (!Object.hasOwn(d.prefabs, piece.prefabName))
			d.prefabs[piece.prefabName] = structuredClone(piece.prefab);
		e = { id, prefab: piece.prefabName, transform: { position: pos } };
	} else {
		const inline = structuredClone(piece.inline ?? {});
		e = {
			id,
			...inline,
			transform: { ...(inline.transform ?? {}), position: pos },
		};
	}
	if (rot && e.transform) e.transform.rotation = roundQuat(rot);
	d.entities.push(e);
	return id;
}

export function roundQuat(q: Quat): Quat {
	const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [
		round(q[0] / n, 6),
		round(q[1] / n, 6),
		round(q[2] / n, 6),
		round(q[3] / n, 6),
	];
}

const IDENTITY: Quat = [0, 0, 0, 1];

/** Writes a transform edit. `scale` is written only when given. */
export function setTransform(
	d: GardenDoc,
	id: string,
	position: Vec3,
	rotation: Quat,
	scale?: Vec3,
): void {
	const e = findEntity(d, id);
	if (!e) return;
	e.transform ??= {};
	const t = e.transform;
	t.position = [round(position[0]), round(position[1]), round(position[2])];
	const q = roundQuat(rotation);
	if (q.every((v, i) => v === IDENTITY[i]) && !prefabHasRotation(d, e))
		delete t.rotation;
	else t.rotation = q;
	if (scale)
		t.scale = [
			Math.max(0.05, round(scale[0], 3)),
			Math.max(0.05, round(scale[1], 3)),
			Math.max(0.05, round(scale[2], 3)),
		];
}

function prefabHasRotation(d: GardenDoc, e: EntityInput): boolean {
	const p = e.prefab ? d.prefabs?.[e.prefab] : undefined;
	return p?.transform?.rotation !== undefined;
}

export interface MaterialPatch {
	color?: string;
	roughness?: number;
	metalness?: number;
}

/** Material override on the entity (its prefab's other material fields still apply). */
export function setMaterial(d: GardenDoc, id: string, m: MaterialPatch): void {
	const e = findEntity(d, id);
	if (!e) return;
	e.mesh ??= {};
	e.mesh.material ??= {};
	const mat = e.mesh.material;
	if (m.color !== undefined) mat.color = m.color.toLowerCase();
	if (m.roughness !== undefined) mat.roughness = round(clamp01(m.roughness), 2);
	if (m.metalness !== undefined) mat.metalness = round(clamp01(m.metalness), 2);
}

export function setBodyType(d: GardenDoc, id: string, type: BodyKind): void {
	const e = findEntity(d, id);
	if (!e) return;
	e.body = { ...(e.body ?? {}), type };
}

export function removeEntity(d: GardenDoc, id: string): boolean {
	const i = d.entities.findIndex((e) => e.id === id);
	if (i < 0) return false;
	d.entities.splice(i, 1);
	return true;
}

/** Copies an entity, offset by `offset`. Returns the new id. */
export function duplicateEntity(
	d: GardenDoc,
	id: string,
	offset: Vec3,
): string | null {
	const e = findEntity(d, id);
	if (!e) return null;
	const copy = structuredClone(e);
	copy.id = newId(d, stemOf(e.id));
	const p = copy.transform?.position ?? [0, 0, 0];
	copy.transform = {
		...(copy.transform ?? {}),
		position: [
			round(p[0] + offset[0]),
			round(p[1] + offset[1]),
			round(p[2] + offset[2]),
		],
	};
	d.entities.push(copy);
	return copy.id;
}

function stemOf(id: string): string {
	return id.replace(/-\d+$/, "");
}

function clamp01(x: number): number {
	return x < 0 ? 0 : Math.min(x, 1);
}

/**
 * The exported text: 2-space JSON with short numeric arrays kept on one line (positions,
 * quaternions, colours read at a glance). Parsing it gives back an object deep-equal to `d`.
 */
export function exportText(d: GardenDoc): string {
	return `${stringify(d, "")}\n`;
}

/** JSON.stringify with 2-space indent, but arrays of plain numbers on one line. */
function stringify(v: unknown, indent: string): string {
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		if (v.every((x) => typeof x === "number"))
			return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
		const inner = `${indent}  `;
		return `[\n${v.map((x) => inner + stringify(x ?? null, inner)).join(",\n")}\n${indent}]`;
	}
	if (v !== null && typeof v === "object") {
		const keys = Object.keys(v).filter(
			(k) => (v as Record<string, unknown>)[k] !== undefined,
		);
		if (keys.length === 0) return "{}";
		const inner = `${indent}  `;
		return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${stringify((v as Record<string, unknown>)[k], inner)}`).join(",\n")}\n${indent}}`;
	}
	return JSON.stringify(v) ?? "null";
}

/** Entity counts of a doc (for the HUD). */
export function countBodies(d: GardenDoc): number {
	return d.entities.length;
}
