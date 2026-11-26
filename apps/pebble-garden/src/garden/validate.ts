import { formatPath, type Scene, SceneSchema } from "@pebble3d/sdk/schema";
import { type GardenDoc, toDoc } from "./doc.ts";

/**
 * Import validation with readable errors: JSON syntax errors get a line and column; schema
 * problems (every one zod reports, not just the first) get the field path, the line it
 * sits on in the pasted text, the offending value and, for misspelt keys, a suggestion.
 * A scene that is valid but uses features the sandbox does not simulate (glTF meshes,
 * characters, spawners, splats) loads with warnings: those entities are kept verbatim so
 * they round-trip through Export unchanged.
 */

export interface ImportIssue {
	/** `entities[2].mesh.material.color`, or "" for the root / a syntax error. */
	path: string;
	message: string;
	/** 1-based line in the source text, when known. */
	line?: number;
	column?: number;
	/** e.g. `did you mean "color"?` */
	hint?: string;
}

export type ImportResult =
	| { ok: true; doc: GardenDoc; scene: Scene; warnings: string[] }
	| { ok: false; stage: "json" | "schema"; issues: ImportIssue[] };

/** Validates scene JSON text (a file, a paste or a drop). */
/** Largest scene text accepted (bytes of UTF-16 text; files are checked by size first). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
/** Most entities a garden may hold, and most dynamic bodies among them. */
export const MAX_ENTITIES = 1500;
export const MAX_DYNAMIC = 600;

export function tooLargeIssue(bytes: number): ImportIssue {
	return {
		path: "",
		message: `the file is ${(bytes / 1048576).toFixed(1)} MB; gardens are limited to ${MAX_IMPORT_BYTES / 1048576} MB`,
	};
}

export function importText(text: string): ImportResult {
	if (text.length > MAX_IMPORT_BYTES)
		return { ok: false, stage: "json", issues: [tooLargeIssue(text.length)] };
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (e) {
		return { ok: false, stage: "json", issues: [jsonIssue(text, e)] };
	}
	const lines = locatePaths(text);
	return importValue(value, lines);
}

/** Validates an already-parsed value. `lines` maps formatted paths to source lines. */
export function importValue(
	value: unknown,
	lines: Map<string, number> = new Map(),
): ImportResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {
			ok: false,
			stage: "schema",
			issues: [
				{
					path: "",
					message: `a scene must be a JSON object like {"version": 1, "entities": [...]}, got ${describe(value)}`,
					line: 1,
				},
			],
		};
	}
	const r = SceneSchema.safeParse(value);
	if (!r.success) {
		const issues: ImportIssue[] = [];
		for (const iss of r.error.issues) {
			for (const out of readable(iss as ZodIssueLike, value))
				issues.push(withLine(out, lines));
		}
		// Top to bottom through the file, so the list reads like the source.
		issues.sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9));
		return { ok: false, stage: "schema", issues };
	}
	const caps = capIssues(r.data);
	if (caps.length) return { ok: false, stage: "schema", issues: caps };
	return {
		ok: true,
		doc: toDoc(value as GardenDoc),
		scene: r.data,
		warnings: warningsFor(r.data),
	};
}

/** Size limits that keep the editor and the sim responsive. */
export function capIssues(scene: Scene): ImportIssue[] {
	const out: ImportIssue[] = [];
	const n = scene.entities.length;
	if (n > MAX_ENTITIES)
		out.push({
			path: "entities",
			message: `${n} entities; a garden holds at most ${MAX_ENTITIES}`,
		});
	let dynamic = 0;
	for (const e of scene.entities) {
		const body =
			e.body ??
			(e.prefab && Object.hasOwn(scene.prefabs, e.prefab)
				? scene.prefabs[e.prefab]?.body
				: undefined);
		if (body && (body.type ?? "dynamic") === "dynamic") dynamic++;
	}
	if (dynamic > MAX_DYNAMIC)
		out.push({
			path: "entities",
			message: `${dynamic} dynamic bodies; a garden simulates at most ${MAX_DYNAMIC}`,
		});
	return out;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Things a valid scene may contain that the sandbox keeps but does not simulate. */
export function warningsFor(scene: Scene): string[] {
	const w: string[] = [];
	const gltf = scene.entities.filter((e) => {
		const m = e.mesh ?? (e.prefab ? scene.prefabs[e.prefab]?.mesh : undefined);
		return m?.gltf !== undefined;
	});
	const chars = scene.entities.filter(
		(e) => e.character || (e.prefab && scene.prefabs[e.prefab]?.character),
	);
	const spawners = scene.entities.filter((e) => e.spawner);
	const list = (es: { id: string }[]): string =>
		es
			.slice(0, 3)
			.map((e) => `"${e.id}"`)
			.join(", ") + (es.length > 3 ? ` and ${es.length - 3} more` : "");
	if (gltf.length)
		w.push(
			`${gltf.length} glTF entit${gltf.length === 1 ? "y" : "ies"} (${list(gltf)}) kept in the file but not simulated here.`,
		);
	if (chars.length)
		w.push(
			`${chars.length} character${chars.length === 1 ? "" : "s"} (${list(chars)}) kept but not simulated here.`,
		);
	if (spawners.length)
		w.push(
			`${spawners.length} spawner${spawners.length === 1 ? "" : "s"} (${list(spawners)}) kept but not run here.`,
		);
	if (scene.environment.splat)
		w.push(
			`The splat environment (${scene.environment.splat.url}) is kept in the file but not drawn here.`,
		);
	if (scene.environment.hdri)
		w.push(
			`The HDRI ${scene.environment.hdri} is kept in the file but not loaded here.`,
		);
	for (const e of gltf) {
		const m = e.mesh ?? (e.prefab ? scene.prefabs[e.prefab]?.mesh : undefined);
		if (m?.gltf)
			w.push(
				`"${e.id}" references the model ${m.gltf.url} (kept, not loaded).`,
			);
	}
	const badColour = scene.entities.filter((e) => {
		const c = e.mesh?.material?.color;
		return c !== undefined && !HEX.test(c);
	});
	if (badColour.length)
		w.push(
			`${badColour.length} entit${badColour.length === 1 ? "y has" : "ies have"} a colour that is not #rgb or #rrggbb (${list(badColour)}); shown as grey.`,
		);
	if (scene.sim.build === "fast")
		w.push(
			'sim.build "fast" is kept; the garden simulates on the deterministic build.',
		);
	return w;
}

// ---------------------------------------------------------------------------
// zod issues -> readable messages
// ---------------------------------------------------------------------------

interface ZodIssueLike {
	code: string;
	path: PropertyKey[];
	message: string;
	keys?: string[];
	values?: unknown[];
	expected?: string;
	minimum?: number | bigint;
	maximum?: number | bigint;
	inclusive?: boolean;
	origin?: string;
	errors?: ZodIssueLike[][];
}

/** Known keys per object kind, for "did you mean" on unrecognised keys. */
const KNOWN_KEYS: Record<string, readonly string[]> = {
	scene: [
		"$schema",
		"version",
		"environment",
		"bounds",
		"lighting",
		"post",
		"camera",
		"entities",
		"sim",
		"prefabs",
	],
	entity: ["id", "prefab", "transform", "mesh", "body", "character", "spawner"],
	prefab: ["transform", "mesh", "body", "character"],
	transform: ["position", "rotation", "scale"],
	mesh: ["primitive", "gltf", "material", "castShadow"],
	material: ["color", "roughness", "metalness", "emissive"],
	body: [
		"type",
		"mass",
		"friction",
		"restitution",
		"linearDamping",
		"angularDamping",
		"ccd",
		"collider",
	],
	environment: ["preset", "hdri", "splat", "fog", "backdrop", "ground"],
	ground: ["y", "size", "color", "roughness", "visible"],
	sim: ["build", "seed", "gravity"],
	camera: ["controller", "presets"],
};

function kindOf(path: PropertyKey[]): string | undefined {
	if (path.length === 0) return "scene";
	const last = path[path.length - 1];
	const prev = path[path.length - 2];
	if (typeof last === "number" && prev === "entities") return "entity";
	if (prev === "prefabs") return "prefab";
	if (typeof last === "string" && Object.hasOwn(KNOWN_KEYS, last)) return last;
	return undefined;
}

function readable(iss: ZodIssueLike, root: unknown): ImportIssue[] {
	const path = formatPath(iss.path);
	const got = valueAt(root, iss.path);
	switch (iss.code) {
		case "unrecognized_keys": {
			const kind = kindOf(iss.path);
			return (iss.keys ?? []).map((k) => {
				const known =
					kind && Object.hasOwn(KNOWN_KEYS, kind)
						? KNOWN_KEYS[kind]
						: undefined;
				const near = known ? closest(k, known) : undefined;
				return {
					path: path ? `${path}.${k}` : k,
					message: `unknown field "${k}"${kind ? ` on ${article(kind)}` : ""}`,
					...(near ? { hint: `did you mean "${near}"?` } : {}),
				};
			});
		}
		case "invalid_type":
			return [
				{
					path,
					message:
						got === undefined
							? `missing: expected ${iss.expected ?? "a value"}`
							: `expected ${iss.expected ?? "another type"}, got ${describe(got)}`,
				},
			];
		case "invalid_value": {
			const opts = (iss.values ?? []).map((v) => JSON.stringify(v));
			return [
				{
					path,
					message:
						opts.length === 1
							? `must be ${opts[0]}, got ${describe(got)}`
							: `must be one of ${opts.join(", ")}; got ${describe(got)}`,
				},
			];
		}
		case "too_small":
		case "too_big": {
			const small = iss.code === "too_small";
			const bound = small ? iss.minimum : iss.maximum;
			if (iss.origin === "array")
				return [
					{
						path,
						message: `needs ${small ? "at least" : "at most"} ${String(bound)} item${bound === 1 ? "" : "s"}, got ${Array.isArray(got) ? got.length : describe(got)}`,
					},
				];
			if (iss.origin === "string")
				return [{ path, message: "must not be empty" }];
			const op = small
				? iss.inclusive
					? ">="
					: ">"
				: iss.inclusive
					? "<="
					: "<";
			return [
				{
					path,
					message: `must be ${op} ${String(bound)}, got ${describe(got)}`,
				},
			];
		}
		case "invalid_union": {
			if (iss.path[iss.path.length - 1] === "collider")
				return [
					{
						path,
						message: `not a collider: use "auto" or an object like {"shape": "box", "halfExtents": [x, y, z]}; got ${describe(got)}`,
					},
				];
			return [
				{
					path,
					message: `does not match any allowed form; got ${describe(got)}`,
				},
			];
		}
		default:
			return [{ path, message: iss.message }];
	}
}

function article(kind: string): string {
	return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}

function valueAt(root: unknown, path: PropertyKey[]): unknown {
	let v: unknown = root;
	for (const k of path) {
		if (v === null || typeof v !== "object") return undefined;
		v = (v as Record<PropertyKey, unknown>)[k];
	}
	return v;
}

function describe(v: unknown): string {
	if (v === undefined) return "nothing";
	if (v === null) return "null";
	if (Array.isArray(v)) {
		const s = JSON.stringify(v);
		return s.length > 40 ? `an array of ${v.length}` : s;
	}
	if (typeof v === "object") return "an object";
	const s = JSON.stringify(v);
	return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

/** The known key within edit distance 2 of `k`, if any. */
export function closest(
	k: string,
	known: readonly string[],
): string | undefined {
	let best: string | undefined;
	let bestD = 3;
	const lk = k.toLowerCase();
	for (const c of known) {
		const d = lk === c.toLowerCase() ? 0 : editDistance(lk, c.toLowerCase());
		if (d < bestD) {
			bestD = d;
			best = c;
		}
	}
	return best;
}

function editDistance(a: string, b: string): number {
	const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		let prev = dp[0] as number;
		dp[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = dp[j] as number;
			dp[j] = Math.min(
				(dp[j] as number) + 1,
				(dp[j - 1] as number) + 1,
				prev + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			prev = tmp;
		}
	}
	return dp[b.length] as number;
}

function withLine(i: ImportIssue, lines: Map<string, number>): ImportIssue {
	// Walk up the path until a located prefix is found (a missing field reports its parent).
	let p = i.path;
	for (;;) {
		const line = lines.get(p);
		if (line !== undefined) return { ...i, line };
		if (!p) return i;
		const cut = Math.max(p.lastIndexOf("."), p.lastIndexOf("["));
		p = cut > 0 ? p.slice(0, cut) : "";
	}
}

// ---------------------------------------------------------------------------
// JSON syntax errors and path -> line location
// ---------------------------------------------------------------------------

function jsonIssue(text: string, e: unknown): ImportIssue {
	const msg = e instanceof Error ? e.message : String(e);
	if (text.trim() === "")
		return {
			path: "",
			message: "the file is empty: paste or drop a scene JSON",
		};
	let line: number | undefined;
	let column: number | undefined;
	const lc = /line (\d+) column (\d+)/.exec(msg);
	const pos = /position (\d+)/.exec(msg);
	if (lc) {
		line = Number(lc[1]);
		column = Number(lc[2]);
	} else {
		const at = pos ? Number(pos[1]) : syntaxErrorAt(text);
		const before = text.slice(0, at).split("\n");
		line = before.length;
		column = (before[before.length - 1]?.length ?? 0) + 1;
	}
	const clean = msg
		.replace(/, "[\s\S]*" is not valid JSON$/, "")
		.replace(/^JSON\.parse: /, "")
		.replace(/ in JSON at position \d+.*$/, "")
		.replace(/\s*\(line \d+ column \d+\)/, "");
	const hint = /,\s*[}\]]/.test(text)
		? "JSON does not allow a trailing comma before } or ]"
		: undefined;
	return {
		path: "",
		message: `not valid JSON: ${clean}`,
		...(line !== undefined ? { line } : {}),
		...(column !== undefined ? { column } : {}),
		...(hint ? { hint } : {}),
	};
}

/**
 * Maps every value's formatted path (`entities[0].mesh`) to the 1-based line where the
 * value starts (for keys: the line of the key). A small scanner over valid JSON text.
 */
export function locatePaths(text: string): Map<string, number> {
	const out = new Map<string, number>();
	let i = 0;
	let line = 1;
	const ws = (): void => {
		while (i < text.length) {
			const c = text[i];
			if (c === "\n") line++;
			else if (c !== " " && c !== "\t" && c !== "\r") break;
			i++;
		}
	};
	const str = (): string => {
		const start = i;
		i++; // opening quote
		while (i < text.length && text[i] !== '"') {
			if (text[i] === "\\") i++;
			i++;
		}
		i++;
		return JSON.parse(text.slice(start, i)) as string;
	};
	const join = (base: string, k: string | number): string =>
		typeof k === "number" ? `${base}[${k}]` : base ? `${base}.${k}` : k;
	const value = (path: string, keyLine: number): void => {
		ws();
		if (!out.has(path)) out.set(path, keyLine);
		const c = text[i];
		if (c === "{") {
			i++;
			ws();
			if (text[i] === "}") {
				i++;
				return;
			}
			for (;;) {
				ws();
				const kl = line;
				const k = str();
				ws();
				i++; // colon
				value(join(path, k), kl);
				ws();
				if (text[i] === ",") {
					i++;
					continue;
				}
				i++; // }
				return;
			}
		}
		if (c === "[") {
			i++;
			ws();
			if (text[i] === "]") {
				i++;
				return;
			}
			for (let n = 0; ; n++) {
				ws();
				value(join(path, n), line);
				ws();
				if (text[i] === ",") {
					i++;
					continue;
				}
				i++; // ]
				return;
			}
		}
		if (c === '"') {
			str();
			return;
		}
		while (i < text.length && !/[,}\]\s]/.test(text[i] as string)) i++;
	};
	try {
		value("", 1);
	} catch {
		// Location is best effort; validation itself never depends on it.
	}
	return out;
}

/**
 * Offset of the first JSON syntax error (V8's newer messages carry no position). A strict
 * recursive-descent scan; returns text.length when it runs off the end.
 */
export function syntaxErrorAt(text: string): number {
	let i = 0;
	const fail = (): never => {
		throw i;
	};
	const ws = (): void => {
		while (i < text.length && " \t\r\n".includes(text[i] as string)) i++;
	};
	const lit = (w: string): void => {
		if (text.startsWith(w, i)) i += w.length;
		else fail();
	};
	const str = (): void => {
		if (text[i] !== '"') fail();
		i++;
		while (i < text.length && text[i] !== '"') {
			const c = text.charCodeAt(i);
			if (c < 0x20) fail();
			if (text[i] === "\\") i++;
			i++;
		}
		if (i >= text.length) fail();
		i++;
	};
	const num = (): void => {
		const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/.exec(
			text.slice(i, i + 64),
		);
		if (!m) fail();
		i += (m as RegExpExecArray)[0].length;
	};
	const value = (): void => {
		ws();
		const c = text[i];
		if (c === "{") {
			i++;
			ws();
			if (text[i] === "}") {
				i++;
				return;
			}
			for (;;) {
				ws();
				str();
				ws();
				if (text[i] !== ":") fail();
				i++;
				value();
				ws();
				if (text[i] === ",") {
					i++;
					continue;
				}
				if (text[i] === "}") {
					i++;
					return;
				}
				fail();
			}
		} else if (c === "[") {
			i++;
			ws();
			if (text[i] === "]") {
				i++;
				return;
			}
			for (;;) {
				value();
				ws();
				if (text[i] === ",") {
					i++;
					continue;
				}
				if (text[i] === "]") {
					i++;
					return;
				}
				fail();
			}
		} else if (c === '"') str();
		else if (c === "t") lit("true");
		else if (c === "f") lit("false");
		else if (c === "n") lit("null");
		else num();
	};
	try {
		value();
		ws();
		return Math.min(i, text.length);
	} catch (at) {
		return typeof at === "number" ? at : 0;
	}
}
