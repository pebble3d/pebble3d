import { expandScene } from "@pebble3d/sdk/expand";
import {
	deepMerge,
	parseScene,
	type Scene,
	type SceneInput,
} from "@pebble3d/sdk/schema";
import type { ExpandedScene } from "@pebble3d/sdk/types";
import baseScene from "../../levels/base.json" with { type: "json" };
import type { Level, PartKind, Placement } from "./level.ts";
import {
	BALL_RADIUS,
	CELL,
	cellCenter,
	footprint,
	PART_DIRS,
	type PartEntity,
	partEntities,
} from "./parts.ts";

/** Half-depth of the board channel the ball runs in (invisible glass front and back). */
export const CHANNEL_HALF_DEPTH = 0.55;

export interface GoalZone {
	min: [number, number];
	max: [number, number];
}

export interface ComposedLevel {
	/** The full scene, validated by the sdk schema. */
	scene: Scene;
	expanded: ExpandedScene;
	/** Placed and fixed parts, in spawn order. */
	parts: PartEntity[];
	goal: GoalZone;
	/** Player placements in canonical order (the order they spawn). */
	placements: Placement[];
}

const GOAL_W = 0.9;
const GOAL_WALL_H = 0.55;
const GOAL_T = 0.1;

/** Canonical placement order (row, then column): spawn order never depends on click order. */
export function canonical(ps: readonly Placement[]): Placement[] {
	return [...ps].sort(
		(a, b) =>
			a.cell[1] - b.cell[1] ||
			a.cell[0] - b.cell[0] ||
			a.part.localeCompare(b.part),
	);
}

const cellKey = (c: number, r: number): string => `${c},${r}`;

/**
 * Cells the player cannot build in: the ball and goal cells, fixed parts, and cells whose
 * centre lies inside a level body (its world AABB, conservatively for rotated boxes).
 */
export function blockedCells(level: Level): Set<string> {
	const out = new Set<string>();
	out.add(cellKey(level.ball.cell[0], level.ball.cell[1]));
	out.add(cellKey(level.goal.cell[0], level.goal.cell[1]));
	for (const m of level.marbles) out.add(cellKey(m.cell[0], m.cell[1]));
	for (const p of level.fixed)
		for (const [c, r] of footprint(p)) out.add(cellKey(c, r));
	for (const b of levelBoxes(level))
		for (let c = 0; c < level.grid.cols; c++)
			for (let r = 0; r < level.grid.rows; r++) {
				const [x, y] = cellCenter(level, c, r);
				if (Math.abs(x - b.cx) < b.hx + 0.1 && Math.abs(y - b.cy) < b.hy + 0.1)
					out.add(cellKey(c, r));
			}
	return out;
}

interface Box2 {
	cx: number;
	cy: number;
	hx: number;
	hy: number;
}

/** World XY half-extent boxes of the level's own entities (rotation about Z only). */
function levelBoxes(level: Level): Box2[] {
	const ents = (level.scene.entities ?? []) as {
		transform?: {
			position?: number[];
			scale?: number[];
			rotation?: number[];
		};
	}[];
	return ents.map((e) => {
		const pos = e.transform?.position ?? [0, 0, 0];
		const sc = e.transform?.scale ?? [1, 1, 1];
		const q = e.transform?.rotation ?? [0, 0, 0, 1];
		const ang = 2 * Math.atan2(q[2] ?? 0, q[3] ?? 1);
		const c = Math.abs(Math.cos(ang));
		const s = Math.abs(Math.sin(ang));
		return {
			cx: pos[0] ?? 0,
			cy: pos[1] ?? 0,
			hx: (c * (sc[0] ?? 1) + s * (sc[1] ?? 1)) / 2,
			hy: (s * (sc[0] ?? 1) + c * (sc[1] ?? 1)) / 2,
		};
	});
}

/**
 * Whether a cell has a floor to stand on: the ground (row 0 of a grid on y = 0) or the top
 * of a level block under the cell centre. Dominoes need one: no dropping them from the sky.
 */
export function hasFloor(level: Level, c: number, r: number): boolean {
	const [x, y] = cellCenter(level, c, r);
	const floorY = y - CELL / 2;
	if (Math.abs(floorY) < 0.01) return true;
	return levelBoxes(level).some(
		(b) =>
			Math.abs(b.cy + b.hy - floorY) < 0.12 && Math.abs(x - b.cx) < b.hx - 0.1,
	);
}

/** Why a set of placements is not allowed, or null when it is. */
export function placementError(
	level: Level,
	placements: readonly Placement[],
): string | null {
	const blocked = blockedCells(level);
	const used = new Map<PartKind, number>();
	const taken = new Set<string>();
	for (const p of placements) {
		if (!PART_DIRS[p.part].includes(p.dir))
			return `${p.part} at ${p.cell} cannot face "${p.dir}"`;
		const n = (used.get(p.part) ?? 0) + 1;
		used.set(p.part, n);
		if (n > (level.inventory[p.part] ?? 0))
			return `too many ${p.part} parts (inventory ${level.inventory[p.part] ?? 0})`;
		if (p.part === "domino" && !hasFloor(level, p.cell[0], p.cell[1]))
			return `domino at ${p.cell} has nothing to stand on`;
		for (const [c, r] of footprint(p)) {
			if (c < 0 || r < 0 || c >= level.grid.cols || r >= level.grid.rows)
				return `${p.part} at ${p.cell} is off the grid`;
			const k = cellKey(c, r);
			if (blocked.has(k)) return `${p.part} at ${p.cell} overlaps the level`;
			if (taken.has(k)) return `${p.part} at ${p.cell} overlaps another part`;
			taken.add(k);
		}
	}
	return null;
}

/**
 * The level's scene with `placements` added: base.json, then the level's partial scene
 * (entities appended), the goal cup, the fixed parts, the placed parts and the ball. The
 * result goes through the sdk's `parseScene` (zod) and `expandScene`, exactly as any
 * engine scene does. Throws on invalid placements or an invalid scene.
 */
export function composeLevel(
	level: Level,
	placements: readonly Placement[],
): ComposedLevel {
	const err = placementError(level, placements);
	if (err) throw new Error(`${level.id}: ${err}`);
	const ordered = canonical(placements);
	const { entities: levelEntities = [], ...levelRest } = level.scene as {
		entities?: unknown[];
	};
	const merged = deepMerge(
		baseScene as unknown as Record<string, unknown>,
		levelRest as Record<string, unknown>,
	) as Record<string, unknown>;
	const entities: unknown[] = [...(levelEntities as unknown[])];

	const { cols, rows, origin } = level.grid;
	merged.bounds = {
		min: [origin[0], -CHANNEL_HALF_DEPTH],
		max: [origin[0] + cols * CELL, CHANNEL_HALF_DEPTH],
		height: origin[1] + (rows + 3) * CELL,
		thickness: 0.5,
	};

	// Goal cup: a floor and two walls in the goal cell.
	const [gx, gy] = cellCenter(level, level.goal.cell[0], level.goal.cell[1]);
	const gb = gy - CELL / 2;
	entities.push(
		{
			id: "goal-floor",
			prefab: "goalWall",
			transform: {
				position: [gx, gb + GOAL_T / 2, 0],
				scale: [GOAL_W, GOAL_T, 0.8],
			},
		},
		{
			id: "goal-left",
			prefab: "goalWall",
			transform: {
				position: [gx - GOAL_W / 2 + GOAL_T / 2, gb + GOAL_WALL_H / 2, 0],
				scale: [GOAL_T, GOAL_WALL_H, 0.8],
			},
		},
		{
			id: "goal-right",
			prefab: "goalWall",
			transform: {
				position: [gx + GOAL_W / 2 - GOAL_T / 2, gb + GOAL_WALL_H / 2, 0],
				scale: [GOAL_T, GOAL_WALL_H, 0.8],
			},
		},
	);

	const parts: PartEntity[] = [];
	level.fixed.forEach((p, i) => {
		parts.push(...partEntities(level, p, `f${i}`, true));
	});
	ordered.forEach((p, i) => {
		parts.push(...partEntities(level, p, `p${i}`, false));
	});
	for (const pe of parts) entities.push(pe.entity);

	level.marbles.forEach((m, i) => {
		const [mx, my] = cellCenter(level, m.cell[0], m.cell[1]);
		const pe: PartEntity = {
			entity: {
				id: `marble-${i}`,
				prefab: "marble",
				transform: { position: [mx, my, 0] },
			},
			role: { kind: "marble" },
			part: "marble",
			placement: { part: "domino", cell: m.cell, dir: "up" },
			fixed: true,
		};
		parts.push(pe);
		entities.push(pe.entity);
	});
	const [bx, by] = cellCenter(level, level.ball.cell[0], level.ball.cell[1]);
	entities.push({
		id: "ball",
		prefab: "ball",
		transform: { position: [bx, by, 0] },
	});
	merged.entities = entities;

	const scene = parseScene(merged as SceneInput);
	return {
		scene,
		expanded: expandScene(scene),
		parts,
		goal: {
			min: [gx - GOAL_W / 2 + GOAL_T, gb + GOAL_T],
			max: [gx + GOAL_W / 2 - GOAL_T, gb + GOAL_WALL_H + BALL_RADIUS],
		},
		placements: ordered,
	};
}
