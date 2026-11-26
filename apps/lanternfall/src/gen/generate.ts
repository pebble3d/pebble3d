import { parseScene, type Scene, type SceneInput } from "@pebble3d/sdk/schema";
import { type Grid, rasterize, TILE } from "./grid.ts";
import { Rng } from "./rng.ts";

/**
 * The keep generator: seed -> a schema-valid Pebble3D scene JSON plus the game metadata the
 * scene format has no field for (guard routes, light pools, loot, the exit).
 *
 * Layout: COLS x ROWS square cells. A randomised spanning tree over the cells plus a few loop
 * edges become doorways; one more edge may be knocked out into a colonnaded great hall. The
 * relic sits in the cell farthest (by doors) from the gate. Every cell gets a furnishing
 * (pillared hall, storeroom, library, gallery with partitions), wall lanterns or braziers or
 * nothing (dark rooms), and the guards get patrol loops through the door graph.
 *
 * Pure and deterministic: no Math.random, no Date, the same seed always gives the same JSON.
 */

export const COLS = 4;
export const ROWS = 3;
export const CELL = 10;
export const X0 = (-COLS * CELL) / 2;
export const Z0 = (-ROWS * CELL) / 2;
export const X1 = X0 + COLS * CELL;
export const Z1 = Z0 + ROWS * CELL;
export const WALL_H = 3;
export const WALL_T = 0.5;
export const OUTER_H = 4.2;
export const OUTER_T = 0.8;
export const DOOR_W = 2.2;
export const GATE_W = 2.6;
/** The apron outside the gate: crossing `exitZ` with the relic wins. */
export const APRON = 7;
export const LANTERN_RADIUS = 6.5;
export const BRAZIER_RADIUS = 7.5;

export type CellKind =
	| "entrance"
	| "relic"
	| "hall"
	| "store"
	| "library"
	| "gallery"
	| "chamber";

export interface LanternSpec {
	x: number;
	y: number;
	z: number;
	radius: number;
	kind: "sconce" | "brazier" | "relic" | "gate";
}

export interface GuardSpec {
	/** Scene entity id. */
	id: string;
	/** Patrol loop: [x, z, pauseTicks] per node, closed (the last node leads back to the first). */
	route: number[];
	/** Cells the route visits, for the minimap and tests. */
	cells: number[];
}

export interface DoorSpec {
	x: number;
	z: number;
	/** "x": the doorway runs along x (a wall between rows); "z": between columns. */
	along: "x" | "z";
	open: boolean;
}

export interface Layout {
	seed: number;
	attempt: number;
	cells: { c: number; r: number; kind: CellKind; lit: boolean }[];
	doors: DoorSpec[];
	spawn: [number, number];
	relic: [number, number];
	gate: [number, number];
	exitZ: number;
	lanterns: LanternSpec[];
	guards: GuardSpec[];
	loot: [number, number][];
}

export interface Keep {
	scene: SceneInput;
	layout: Layout;
}

export interface GenOptions {
	guards?: number;
}

type Edge = {
	a: number;
	b: number;
	state: "wall" | "door" | "open";
	offset: number;
};

type Ent = Record<string, unknown>;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const v3 = (x: number, y: number, z: number): [number, number, number] => [
	r3(x),
	r3(y),
	r3(z),
];

const PALETTE = {
	wall: "#5b5f6b",
	wallOuter: "#4d525e",
	post: "#686b75",
	tower: "#525662",
	pillar: "#6d6a66",
	flags: "#45444b",
	wood: "#3e2f24",
	carpet: "#5c1c22",
	crate: "#6b4a2e",
	barrel: "#5a3b22",
	shelf: "#3a2a1e",
	iron: "#1e1f24",
	lantern: "#ffb357",
	fire: "#ff8a2a",
	relic: "#7de8ff",
	gold: "#f2c14e",
	ground: "#1b211d",
	path: "#2f2c2a",
};

export function cellCenter(i: number): [number, number] {
	const c = i % COLS;
	const r = Math.floor(i / COLS);
	return [X0 + (c + 0.5) * CELL, Z0 + (r + 0.5) * CELL];
}

export function cellOf(x: number, z: number): number {
	const c = Math.floor((x - X0) / CELL);
	const r = Math.floor((z - Z0) / CELL);
	if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return -1;
	return r * COLS + c;
}

/**
 * Total in practice: a seed that fails validation is regenerated with fresh draws (attempt 1,
 * 2, ...; from attempt 4 the furnishing is simpler). `test/gen.test.ts` sweeps seeds 1..10000.
 * Only a generator bug that fails 256 times in a row throws.
 */
export function generateKeep(seed: number, opts: GenOptions = {}): Keep {
	let lastErr = "";
	for (let attempt = 0; attempt < 256; attempt++) {
		const k = tryGenerate(seed, attempt, opts);
		if (typeof k !== "string") return k;
		lastErr = k;
	}
	throw new Error(`generateKeep(${seed}): no valid layout (${lastErr})`);
}

function tryGenerate(
	seed: number,
	attempt: number,
	opts: GenOptions,
): Keep | string {
	const rng = new Rng((seed * 2654435761 + attempt * 40503) >>> 0);
	const nCells = COLS * ROWS;
	const simple = attempt >= 4;

	// --- doors: spanning tree + loops ------------------------------------------------
	const edges: Edge[] = [];
	const edgeAt = new Map<string, Edge>();
	for (let r = 0; r < ROWS; r++)
		for (let c = 0; c < COLS; c++) {
			const i = r * COLS + c;
			if (c + 1 < COLS)
				edges.push({ a: i, b: i + 1, state: "wall", offset: 0 });
			if (r + 1 < ROWS)
				edges.push({ a: i, b: i + COLS, state: "wall", offset: 0 });
		}
	for (const e of edges) edgeAt.set(`${e.a},${e.b}`, e);
	const edgeOf = (a: number, b: number): Edge | undefined =>
		edgeAt.get(a < b ? `${a},${b}` : `${b},${a}`);
	const neighbours = (i: number): number[] => {
		const c = i % COLS;
		const r = Math.floor(i / COLS);
		const out: number[] = [];
		if (c > 0) out.push(i - 1);
		if (c + 1 < COLS) out.push(i + 1);
		if (r > 0) out.push(i - COLS);
		if (r + 1 < ROWS) out.push(i + COLS);
		return out;
	};

	const entrance = (ROWS - 1) * COLS + rng.int(COLS);
	const seen = new Uint8Array(nCells);
	const stack = [entrance];
	seen[entrance] = 1;
	while (stack.length > 0) {
		const cur = stack[stack.length - 1] as number;
		const open = neighbours(cur).filter((n) => seen[n] === 0);
		if (open.length === 0) {
			stack.pop();
			continue;
		}
		const n = rng.pick(open);
		const e = edgeOf(cur, n);
		if (e) e.state = "door";
		seen[n] = 1;
		stack.push(n);
	}
	const walls = edges.filter((e) => e.state === "wall");
	rng.shuffle(walls);
	const loops = 2 + rng.int(2);
	for (let k = 0; k < loops && k < walls.length; k++)
		(walls[k] as Edge).state = "door";
	for (const e of edges)
		if (e.state === "door") e.offset = rng.int(11) * 0.5 - 2.5;

	const linked = (i: number): number[] =>
		neighbours(i).filter((n) => (edgeOf(i, n)?.state ?? "wall") !== "wall");
	const bfs = (from: number): Int32Array => {
		const d = new Int32Array(nCells).fill(-1);
		d[from] = 0;
		const q = [from];
		for (let h = 0; h < q.length; h++) {
			const c = q[h] as number;
			for (const n of linked(c))
				if (d[n] === -1) {
					d[n] = (d[c] as number) + 1;
					q.push(n);
				}
		}
		return d;
	};
	const dist = bfs(entrance);
	let maxD = -1;
	const far: number[] = [];
	for (let i = 0; i < nCells; i++) {
		const d = dist[i] as number;
		if (d > maxD) {
			maxD = d;
			far.length = 0;
		}
		if (d === maxD) far.push(i);
	}
	const relicCell = rng.pick(far);

	// --- cell kinds -------------------------------------------------------------------
	const kinds: CellKind[] = new Array(nCells).fill("chamber");
	kinds[entrance] = "entrance";
	kinds[relicCell] = "relic";
	const pool: CellKind[] = simple
		? ["chamber", "store", "hall"]
		: ["hall", "store", "library", "gallery", "store", "hall", "chamber"];
	for (let i = 0; i < nCells; i++)
		if (kinds[i] === "chamber") kinds[i] = rng.pick(pool);

	// A great hall: one door edge between two ordinary cells knocked through.
	const mergeable = edges.filter(
		(e) =>
			e.state === "door" &&
			kinds[e.a] !== "entrance" &&
			kinds[e.a] !== "relic" &&
			kinds[e.b] !== "entrance" &&
			kinds[e.b] !== "relic",
	);
	if (mergeable.length > 0 && rng.chance(0.75)) {
		const e = rng.pick(mergeable);
		e.state = "open";
		kinds[e.a] = "hall";
		kinds[e.b] = "hall";
	}

	// --- entities ---------------------------------------------------------------------
	const ents: Ent[] = [];
	const lanterns: LanternSpec[] = [];
	let uid = 0;
	const id = (p: string): string => `${p}-${uid++}`;
	const box = (
		prefix: string,
		x: number,
		y: number,
		z: number,
		sx: number,
		sy: number,
		sz: number,
		color: string,
		opts: {
			body?: boolean;
			rough?: number;
			metal?: number;
			emissive?: string;
			shadow?: boolean;
		} = {},
	): void => {
		const e: Ent = {
			id: id(prefix),
			transform: { position: v3(x, y, z), scale: v3(sx, sy, sz) },
			mesh: {
				primitive: "box",
				material: {
					color,
					roughness: opts.rough ?? 0.9,
					...(opts.metal !== undefined ? { metalness: opts.metal } : {}),
					...(opts.emissive ? { emissive: opts.emissive } : {}),
				},
				...(opts.shadow === false ? { castShadow: false } : {}),
			},
		};
		if (opts.body) e.body = { type: "static" };
		ents.push(e);
	};
	const cyl = (
		prefix: string,
		x: number,
		y: number,
		z: number,
		d: number,
		h: number,
		color: string,
		body: boolean,
		emissive?: string,
	): void => {
		const e: Ent = {
			id: id(prefix),
			transform: { position: v3(x, y, z), scale: v3(d, h, d) },
			mesh: {
				primitive: "cylinder",
				material: {
					color,
					roughness: 0.85,
					...(emissive ? { emissive } : {}),
				},
			},
		};
		if (body) e.body = { type: "static" };
		ents.push(e);
	};

	// Floors (decor; the scene ground is the collider).
	for (let i = 0; i < nCells; i++) {
		const [cx, cz] = cellCenter(i);
		const kind = kinds[i];
		const col = kind === "library" ? PALETTE.wood : PALETTE.flags;
		box(
			kind === "library" ? "floor-wood" : "floor",
			cx,
			0.015,
			cz,
			CELL,
			0.03,
			CELL,
			col,
			{
				rough: 0.95,
				shadow: false,
			},
		);
	}

	// Outer walls, the gate and corner towers.
	const [gx] = cellCenter(entrance);
	const half = GATE_W / 2;
	box(
		"outer-n",
		0,
		OUTER_H / 2,
		Z0,
		X1 - X0 + OUTER_T,
		OUTER_H,
		OUTER_T,
		PALETTE.wallOuter,
		{ body: true },
	);
	box(
		"outer-w",
		X0,
		OUTER_H / 2,
		0,
		OUTER_T,
		OUTER_H,
		Z1 - Z0,
		PALETTE.wallOuter,
		{ body: true },
	);
	box(
		"outer-e",
		X1,
		OUTER_H / 2,
		0,
		OUTER_T,
		OUTER_H,
		Z1 - Z0,
		PALETTE.wallOuter,
		{ body: true },
	);
	const sw = gx - half - (X0 - OUTER_T / 2);
	const se = X1 + OUTER_T / 2 - (gx + half);
	box(
		"outer-s",
		X0 - OUTER_T / 2 + sw / 2,
		OUTER_H / 2,
		Z1,
		sw,
		OUTER_H,
		OUTER_T,
		PALETTE.wallOuter,
		{ body: true },
	);
	box(
		"outer-s",
		gx + half + se / 2,
		OUTER_H / 2,
		Z1,
		se,
		OUTER_H,
		OUTER_T,
		PALETTE.wallOuter,
		{ body: true },
	);
	for (const [tx, tz] of [
		[X0, Z0],
		[X1, Z0],
		[X0, Z1],
		[X1, Z1],
	] as const)
		cyl("tower", tx, 2.9, tz, 3.2, 5.8, PALETTE.tower, true);
	// Gate: two piers, a lintel, the raised portcullis, a path over the apron.
	box("gate-pier", gx - half - 0.6, 2.5, Z1 + 0.1, 1.2, 5, 1.4, PALETTE.tower, {
		body: true,
	});
	box("gate-pier", gx + half + 0.6, 2.5, Z1 + 0.1, 1.2, 5, 1.4, PALETTE.tower, {
		body: true,
	});
	box("gate-lintel", gx, 4.4, Z1 + 0.1, GATE_W + 0.2, 1.2, 1.2, PALETTE.tower);
	for (let k = 0; k < 6; k++)
		box(
			"portcullis",
			gx - half + 0.2 + k * ((GATE_W - 0.4) / 5),
			3.55,
			Z1 - 0.3,
			0.08,
			0.7,
			0.08,
			PALETTE.iron,
			{ metal: 0.6, rough: 0.5 },
		);
	box(
		"apron-path",
		gx,
		0.02,
		Z1 + APRON / 2 + 0.4,
		GATE_W + 0.6,
		0.04,
		APRON,
		PALETTE.path,
		{ shadow: false },
	);
	const exitZ = Z1 + 2.5;
	for (const s of [-1, 1]) {
		cyl(
			"gate-brazier",
			gx + s * 2.6,
			0.45,
			Z1 + 2.2,
			0.6,
			0.9,
			PALETTE.iron,
			true,
		);
		ents.push({
			id: id("gate-fire"),
			transform: {
				position: v3(gx + s * 2.6, 1.0, Z1 + 2.2),
				scale: v3(0.38, 0.38, 0.38),
			},
			mesh: {
				primitive: "sphere",
				material: { color: PALETTE.fire, emissive: PALETTE.fire },
				castShadow: false,
			},
		});
		lanterns.push({
			x: r3(gx + s * 2.6),
			y: 1.5,
			z: r3(Z1 + 2.2),
			radius: 5,
			kind: "gate",
		});
	}

	// Interior walls with doorways, door frames and lintels.
	const doors: DoorSpec[] = [];
	for (const e of edges) {
		const ca = e.a % COLS;
		const ra = Math.floor(e.a / COLS);
		const vertical = e.b === e.a + 1; // wall runs along z at x = boundary
		const lineX = X0 + (ca + 1) * CELL;
		const lineZ = Z0 + (ra + 1) * CELL;
		const start = vertical ? Z0 + ra * CELL : X0 + ca * CELL;
		const mid = start + CELL / 2;
		const end = start + CELL;
		if (e.state === "open") {
			doors.push(
				vertical
					? { x: lineX, z: mid, along: "z", open: true }
					: { x: mid, z: lineZ, along: "x", open: true },
			);
			for (const s of [-2.6, 2.6]) {
				const p = mid + s;
				if (vertical)
					cyl(
						"colonnade",
						lineX,
						WALL_H / 2,
						p,
						0.8,
						WALL_H,
						PALETTE.pillar,
						true,
					);
				else
					cyl(
						"colonnade",
						p,
						WALL_H / 2,
						lineZ,
						0.8,
						WALL_H,
						PALETTE.pillar,
						true,
					);
			}
			continue;
		}
		const seg = (a: number, b: number): void => {
			if (b - a < 0.05) return;
			const m = (a + b) / 2;
			if (vertical)
				box("wall", lineX, WALL_H / 2, m, WALL_T, WALL_H, b - a, PALETTE.wall, {
					body: true,
				});
			else
				box("wall", m, WALL_H / 2, lineZ, b - a, WALL_H, WALL_T, PALETTE.wall, {
					body: true,
				});
		};
		if (e.state === "wall") {
			seg(start, end);
			continue;
		}
		const dc = mid + e.offset;
		seg(start, dc - DOOR_W / 2);
		seg(dc + DOOR_W / 2, end);
		doors.push(
			vertical
				? { x: lineX, z: dc, along: "z", open: false }
				: { x: dc, z: lineZ, along: "x", open: false },
		);
		// Lintel over the doorway and wooden jambs.
		const lintelH = WALL_H - 2.35;
		if (vertical) {
			box(
				"lintel",
				lineX,
				2.35 + lintelH / 2,
				dc,
				WALL_T,
				lintelH,
				DOOR_W,
				PALETTE.wall,
			);
			for (const s of [-1, 1])
				box(
					"jamb",
					lineX,
					1.2,
					dc + s * (DOOR_W / 2 + 0.06),
					WALL_T + 0.12,
					2.4,
					0.14,
					PALETTE.wood,
				);
		} else {
			box(
				"lintel",
				dc,
				2.35 + lintelH / 2,
				lineZ,
				DOOR_W,
				lintelH,
				WALL_T,
				PALETTE.wall,
			);
			for (const s of [-1, 1])
				box(
					"jamb",
					dc + s * (DOOR_W / 2 + 0.06),
					1.2,
					lineZ,
					0.14,
					2.4,
					WALL_T + 0.12,
					PALETTE.wood,
				);
		}
	}
	// Wall junction posts (hide seams, read as buttresses from above).
	for (let r = 1; r < ROWS; r++)
		for (let c = 1; c < COLS; c++) {
			const x = X0 + c * CELL;
			const z = Z0 + r * CELL;
			const around = [
				edgeOf(r * COLS + c - 1, r * COLS + c),
				edgeOf((r - 1) * COLS + c - 1, (r - 1) * COLS + c),
				edgeOf((r - 1) * COLS + c - 1, r * COLS + c - 1),
				edgeOf((r - 1) * COLS + c, r * COLS + c),
			];
			if (around.every((e) => e?.state === "open")) continue;
			box(
				"post",
				x,
				(WALL_H + 0.3) / 2,
				z,
				0.8,
				WALL_H + 0.3,
				0.8,
				PALETTE.post,
				{ body: true },
			);
		}

	// --- furnishing and lights per cell ------------------------------------------------
	const doorOn = (i: number, side: "n" | "s" | "e" | "w"): number | null => {
		const c = i % COLS;
		const r = Math.floor(i / COLS);
		let n = -1;
		if (side === "n" && r > 0) n = i - COLS;
		if (side === "s" && r + 1 < ROWS) n = i + COLS;
		if (side === "w" && c > 0) n = i - 1;
		if (side === "e" && c + 1 < COLS) n = i + 1;
		if (n < 0) return side === "s" && i === entrance ? 0 : null;
		const e = edgeOf(i, n);
		if (!e || e.state === "wall") return null;
		return e.state === "open" ? 99 : e.offset;
	};
	const lit: boolean[] = new Array(nCells).fill(false);
	const IN = CELL / 2 - WALL_T / 2; // centre to inner wall face (interior walls)

	const sconce = (i: number): boolean => {
		const [cx, cz] = cellCenter(i);
		const sides = rng.shuffle(["n", "s", "e", "w"] as (
			| "n"
			| "s"
			| "e"
			| "w"
		)[]);
		for (const side of sides) {
			const d = doorOn(i, side);
			if (d === 99) continue; // open colonnade side
			let u = rng.range(-3.2, 3.2);
			if (d !== null && Math.abs(u - d) < 2) u = d > 0 ? d - 2.4 : d + 2.4;
			if (Math.abs(u) > 3.8) continue;
			const outer =
				(side === "n" && i < COLS) ||
				(side === "s" && i >= (ROWS - 1) * COLS) ||
				(side === "w" && i % COLS === 0) ||
				(side === "e" && i % COLS === COLS - 1);
			const face = outer ? CELL / 2 - OUTER_T / 2 : IN;
			const nx = side === "e" ? 1 : side === "w" ? -1 : 0;
			const nz = side === "s" ? 1 : side === "n" ? -1 : 0;
			const tx = nz !== 0 ? u : 0;
			const tz = nx !== 0 ? u : 0;
			const fx = cx + nx * face + tx;
			const fz = cz + nz * face + tz;
			box(
				"bracket",
				fx - nx * 0.2,
				2.25,
				fz - nz * 0.2,
				nx !== 0 ? 0.4 : 0.08,
				0.08,
				nz !== 0 ? 0.4 : 0.08,
				PALETTE.iron,
				{ metal: 0.5, rough: 0.6, shadow: false },
			);
			box(
				"lantern",
				fx - nx * 0.38,
				2.05,
				fz - nz * 0.38,
				0.22,
				0.34,
				0.22,
				PALETTE.lantern,
				{ emissive: PALETTE.lantern, shadow: false },
			);
			lanterns.push({
				x: r3(fx - nx * 0.6),
				y: 2.0,
				z: r3(fz - nz * 0.6),
				radius: LANTERN_RADIUS,
				kind: "sconce",
			});
			return true;
		}
		return false;
	};
	const brazier = (x: number, z: number, radius = BRAZIER_RADIUS): void => {
		cyl("brazier", x, 0.45, z, 0.7, 0.9, PALETTE.iron, true);
		ents.push({
			id: id("fire"),
			transform: { position: v3(x, 1.0, z), scale: v3(0.45, 0.45, 0.45) },
			mesh: {
				primitive: "sphere",
				material: { color: PALETTE.fire, emissive: PALETTE.fire },
				castShadow: false,
			},
		});
		lanterns.push({ x: r3(x), y: 1.55, z: r3(z), radius, kind: "brazier" });
	};

	for (let i = 0; i < nCells; i++) {
		const [cx, cz] = cellCenter(i);
		const kind = kinds[i] as CellKind;
		const wantLight =
			kind === "entrance" || kind === "relic" || rng.chance(0.68);
		switch (kind) {
			case "entrance":
				for (const s of [-1, 1])
					cyl(
						"barrel",
						cx + s * 3.6,
						0.5,
						cz + 3.4,
						0.7,
						1.0,
						PALETTE.barrel,
						true,
					);
				box("crates", cx - 3.4, 0.8, cz - 3.2, 1.2, 1.6, 1.2, PALETTE.crate, {
					body: true,
				});
				break;
			case "relic": {
				ents.push({
					id: "pedestal",
					transform: { position: v3(cx, 0.5, cz), scale: v3(0.9, 1.0, 0.9) },
					mesh: {
						primitive: "cylinder",
						material: { color: "#8c8577", roughness: 0.6 },
					},
					body: { type: "static" },
				});
				box("rug", cx, 0.035, cz, 5, 0.01, 6, PALETTE.carpet, {
					shadow: false,
					rough: 1,
				});
				ents.push({
					id: "relic",
					transform: {
						position: v3(cx, 1.32, cz),
						scale: v3(0.34, 0.34, 0.34),
					},
					mesh: {
						primitive: "sphere",
						material: {
							color: PALETTE.relic,
							emissive: PALETTE.relic,
							roughness: 0.2,
							metalness: 0.3,
						},
						castShadow: false,
					},
				});
				lanterns.push({
					x: r3(cx),
					y: 1.6,
					z: r3(cz),
					radius: 4,
					kind: "relic",
				});
				break;
			}
			case "hall":
				for (const sx of [-1, 1])
					for (const sz of [-1, 1])
						cyl(
							"pillar",
							cx + sx * 2.6,
							WALL_H / 2,
							cz + sz * 2.6,
							0.8,
							WALL_H,
							PALETTE.pillar,
							true,
						);
				break;
			case "store": {
				const spots: [number, number][] = [];
				for (const a of [-3, -1, 1, 3])
					for (const b of [-3, -1, 1, 3])
						if (Math.abs(a) + Math.abs(b) > 2) spots.push([a, b]);
				rng.shuffle(spots);
				const n = 3 + rng.int(3);
				for (let k = 0; k < n; k++) {
					const [a, b] = spots[k] as [number, number];
					const h = rng.chance(0.6) ? 1.7 : 1.1;
					if (h < 1.5 && rng.chance(0.5))
						cyl("barrel", cx + a, 0.5, cz + b, 0.75, 1.0, PALETTE.barrel, true);
					else
						box("crates", cx + a, h / 2, cz + b, 1.15, h, 1.15, PALETTE.crate, {
							body: true,
						});
				}
				break;
			}
			case "library":
				for (const sx of [-1, 1])
					for (const sz of [-1, 1])
						box(
							"shelf",
							cx + sx * 2.3,
							1.0,
							cz + sz * 2.0,
							2.6,
							2.0,
							0.55,
							PALETTE.shelf,
							{ body: true },
						);
				break;
			case "gallery": {
				const flip = rng.chance(0.5) ? 1 : -1;
				box(
					"partition",
					cx - 1.6,
					WALL_H / 2,
					cz - 1.3 * flip,
					6.3,
					WALL_H,
					WALL_T,
					PALETTE.wall,
					{ body: true },
				);
				box(
					"partition",
					cx + 1.6,
					WALL_H / 2,
					cz + 1.3 * flip,
					6.3,
					WALL_H,
					WALL_T,
					PALETTE.wall,
					{ body: true },
				);
				break;
			}
			default:
				box("table", cx, 0.4, cz, 2.4, 0.8, 1.2, PALETTE.wood, { body: true });
		}
		if (!wantLight) continue;
		lit[i] = true;
		if (kind === "relic") {
			brazier(cx - 2.4, cz - 2.4, 5);
			brazier(cx + 2.4, cz + 2.4, 5);
		} else if (kind === "hall" && rng.chance(0.6)) {
			brazier(cx, cz);
		} else {
			sconce(i);
			if (rng.chance(0.25)) sconce(i);
		}
	}

	// --- player, guards, loot -----------------------------------------------------------
	const spawn: [number, number] = [gx, Z1 - 3.6]; // clear of the outer wall in the follow camera
	const [rx, rz] = cellCenter(relicCell);
	const entities: Ent[] = [
		{
			id: "player",
			character: { speed: 2.8, sprintSpeed: 5.2, jumpSpeed: 0, accel: 18 },
			mesh: {
				gltf: {
					url: "/assets/rocketbox-male-adult-16.glb",
					animations: {
						idle: "Idle",
						walk: { clip: "Walk", speed: 0.979 },
						run: { clip: "Run", speed: 5.649 },
						jump: "Jump",
						fall: "Fall",
					},
					look: { envIntensity: 1.0, saturation: 0.7 },
				},
			},
			transform: {
				position: v3(spawn[0], 0.8, spawn[1]),
				rotation: [0, 1, 0, 0],
			},
			body: {
				type: "kinematic",
				collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
			},
		},
	];
	const nGuards = opts.guards ?? 4;
	entities.push(...ents);

	const scene: SceneInput = {
		version: 1,
		environment: {
			preset: "studio",
			backdrop: { horizon: "#0d1018", zenith: "#04050a" },
			fog: { near: 38, far: 95, color: "#090b11" },
			ground: { size: 160, color: PALETTE.ground, roughness: 1 },
		},
		bounds: {
			min: [X0 - 1.6, Z0 - 1.6],
			max: [X1 + 1.6, Z1 + APRON],
			height: 5,
		},
		lighting: {
			sun: { direction: [0.45, 1.0, -0.55], intensity: 0.3, color: "#86a0ff" },
		},
		post: {
			toneMapping: "aces",
			exposure: 1.1,
			bloom: { enabled: true, strength: 0.5, threshold: 1.4 },
			ao: { enabled: true, radius: 0.6 },
		},
		camera: {
			controller: "orbit",
			presets: {
				hero: { position: [0, 36, Z1 + 26], target: [0, 0, 1], fov: 42 },
				overview: { position: [0, 36, Z1 + 26], target: [0, 0, 1], fov: 42 },
			},
		},
		sim: { build: "deterministic", seed: seed >>> 0 },
		entities: entities as SceneInput["entities"],
	};

	// --- validate, rasterise, plan --------------------------------------------------------
	let parsed: Scene;
	try {
		parsed = parseScene(scene);
	} catch (err) {
		return `schema: ${err instanceof Error ? err.message : String(err)}`;
	}
	const grid = rasterize(parsed);
	const reach = new Uint8Array(grid.size);
	const s0 = grid.nearestWalkable(spawn[0], spawn[1]);
	if (s0 < 0) return "spawn blocked";
	grid.flood(s0, reach);
	for (let i = 0; i < nCells; i++) {
		const [cx, cz] = cellCenter(i);
		const t = grid.nearestWalkable(cx, cz, 10);
		if (t < 0 || reach[t] !== 1) return `cell ${i} unreachable`;
	}
	const relicTile = grid.nearestWalkable(rx, rz + 1.0, 4);
	if (relicTile < 0 || reach[relicTile] !== 1) return "relic unreachable";
	const exitTile = grid.nearestWalkable(gx, exitZ + 1.5, 4);
	if (exitTile < 0 || reach[exitTile] !== 1) return "exit unreachable";

	const guards = planGuards(rng, grid, reach, nGuards, {
		entrance,
		relicCell,
		linked,
		dist,
	});
	if (typeof guards === "string") return guards;
	// Guards go right after the player (the player must stay the first character entity),
	// each starting on the first node of its route.
	entities.splice(
		1,
		0,
		...guards.map((g) => ({
			id: g.id,
			character: { speed: 1.5, sprintSpeed: 3.7, jumpSpeed: 0, accel: 10 },
			mesh: {
				gltf: {
					url: "/assets/RobotExpressive.glb",
					animations: {
						idle: "Idle",
						walk: "Walking",
						run: "Running",
						jump: "Jump",
						fall: "Jump",
					},
				},
			},
			transform: {
				position: v3(g.route[0] as number, 0.8, g.route[1] as number),
				scale: v3(0.4, 0.4, 0.4),
			},
			body: {
				type: "kinematic",
				collider: { shape: "capsule", halfHeight: 0.5, radius: 0.3 },
			},
		})),
	);

	// Loot: corners and wall middles of non-entrance cells, on reachable tiles.
	const loot: [number, number][] = [];
	const lootCells = rng.shuffle(
		Array.from({ length: nCells }, (_, i) => i).filter((i) => i !== entrance),
	);
	for (const i of lootCells) {
		if (loot.length >= 6) break;
		const [cx, cz] = cellCenter(i);
		const offs: [number, number][] = [
			[-3.9, -3.9],
			[3.9, -3.9],
			[-3.9, 3.9],
			[3.9, 3.9],
			[0, -3.9],
			[-3.9, 0],
			[3.9, 0],
		];
		rng.shuffle(offs);
		for (const [a, b] of offs) {
			const t = grid.index(cx + a, cz + b);
			if (t >= 0 && reach[t] === 1) {
				const x = r3(grid.cx(t));
				const z = r3(grid.cz(t));
				loot.push([x, z]);
				entities.push({
					id: `loot-${loot.length - 1}`,
					transform: { position: v3(x, 0.14, z), scale: v3(0.3, 0.22, 0.24) },
					mesh: {
						primitive: "box",
						material: {
							color: PALETTE.gold,
							emissive: "#6b4a10",
							metalness: 0.9,
							roughness: 0.3,
						},
					},
				});
				break;
			}
		}
	}

	try {
		parseScene(scene);
	} catch (err) {
		return `schema (final): ${err instanceof Error ? err.message : String(err)}`;
	}
	const layout: Layout = {
		seed,
		attempt,
		cells: kinds.map((kind, i) => ({
			c: i % COLS,
			r: Math.floor(i / COLS),
			kind,
			lit: lit[i] as boolean,
		})),
		doors,
		spawn,
		relic: [r3(rx), r3(rz)],
		gate: [r3(gx), Z1],
		exitZ,
		lanterns,
		guards,
		loot,
	};
	return { scene, layout };
}

function planGuards(
	rng: Rng,
	grid: Grid,
	reach: Uint8Array,
	n: number,
	k: {
		entrance: number;
		relicCell: number;
		linked: (i: number) => number[];
		dist: Int32Array;
	},
): GuardSpec[] | string {
	const nCells = COLS * ROWS;
	const kk = k;
	const out: GuardSpec[] = [];
	const used = new Set<number>([k.entrance]);
	const path = new Int32Array(grid.size);
	const candidates = Array.from({ length: nCells }, (_, i) => i).filter(
		(i) => i !== k.entrance && i !== k.relicCell && (k.dist[i] as number) >= 1,
	);
	rng.shuffle(candidates);
	// Farther cells first so the gate area starts quiet.
	candidates.sort((a, b) => (k.dist[b] as number) - (k.dist[a] as number));
	for (let g = 0; g < n; g++) {
		let start: number;
		if (g === 0) start = k.relicCell;
		else {
			const c = candidates.find((i) => !used.has(i));
			if (c === undefined) break;
			start = c;
		}
		used.add(start);
		// Random walk through doors, never into the entrance cell.
		const cells = [start];
		const len = g === 0 ? 3 : 3 + rng.int(2);
		for (let s = 1; s < len; s++) {
			const cur = cells[cells.length - 1] as number;
			const prev = cells.length > 1 ? (cells[cells.length - 2] as number) : -1;
			let opts = k
				.linked(cur)
				.filter((i) => i !== k.entrance && !cells.includes(i));
			if (opts.length === 0)
				opts = k.linked(cur).filter((i) => i !== k.entrance && i !== prev);
			if (opts.length === 0) break;
			cells.push(rng.pick(opts));
		}
		// Posts: a point in each visited cell; ping-pong unless the walk closes a loop.
		const posts: [number, number, number][] = [];
		for (const c of cells) {
			const [cx, cz] = cellCenter(c);
			const ox = rng.range(-1.8, 1.8);
			const oz = rng.range(-1.8, 1.8);
			const t = grid.nearestWalkable(cx + ox, cz + oz, 10);
			if (t < 0 || reach[t] !== 1) return `guard ${g} post unreachable`;
			posts.push([grid.cx(t), grid.cz(t), 90 + rng.int(4) * 30]);
		}
		const last = cells[cells.length - 1] as number;
		const loop = cells.length > 2 && k.linked(last).includes(start);
		const seq = loop ? posts : [...posts, ...posts.slice(1, -1).reverse()];
		const route: number[] = [];
		for (let p = 0; p < seq.length; p++) {
			const a = seq[p] as [number, number, number];
			const b = seq[(p + 1) % seq.length] as [number, number, number];
			route.push(r3(a[0]), r3(a[1]), a[2]);
			if (seq.length === 1) break;
			const len2 = grid.findPath(
				grid.index(a[0], a[1]),
				grid.index(b[0], b[1]),
				path,
			);
			if (len2 === 0) return `guard ${g} route broken`;
			// String-pull: keep only the nodes needed for clear straight lines.
			let anchor = 0;
			for (let q = 2; q < len2; q++) {
				const ta = path[anchor] as number;
				const tq = path[q] as number;
				if (
					!grid.clearLine(grid.cx(ta), grid.cz(ta), grid.cx(tq), grid.cz(tq))
				) {
					const keep = path[q - 1] as number;
					if (q - 1 !== 0 && q - 1 !== len2 - 1)
						route.push(r3(grid.cx(keep)), r3(grid.cz(keep)), 0);
					anchor = q - 1;
				}
			}
		}
		// Keep the gatehouse quiet: no patrol leg may cross the entrance cell.
		for (let k = 0; k < route.length; k += 3)
			if (cellOf(route[k] as number, route[k + 1] as number) === kk.entrance)
				return `guard ${g} crosses the entrance`;
		out.push({ id: `guard-${g}`, route, cells });
	}
	if (out.length < Math.min(n, 2)) return "too few guards";
	return out;
}

/** Grid tile size re-exported for the minimap and sim. */
export { TILE };
