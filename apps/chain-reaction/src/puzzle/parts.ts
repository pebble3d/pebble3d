import type { Dir, Level, PartKind, Placement } from "./level.ts";

/**
 * The part catalogue: how each placeable part becomes scene entities (prefab references
 * from levels/base.json, positioned on the grid) and which gameplay behaviour the sim
 * attaches to them. Grid cells are 1 m; the board is the XY plane at z = 0.
 */

export const CELL = 1;
export const BALL_RADIUS = 0.2;
/** Ramp plank tilt, radians: corner to corner, so diagonal neighbours join into one slope. */
export const RAMP_ANGLE = Math.PI / 4;
export const RAMP_LENGTH = 1.44;
/** Two cells tall, so a toppling domino strikes its neighbour well above the centre of mass. */
export const DOMINO_SIZE: [number, number, number] = [0.16, 1.6, 0.6];
export const SPRING_PAD_H = 0.3;
/** Spring launch speed, m/s, and the horizontal share of an angled launch. */
export const SPRING_SPEED = 8.2;
export const SPRING_ANGLE = (24 * Math.PI) / 180;
/** Fan stream length (cells) and acceleration (m/s^2; gravity is 9.81). */
export const FAN_RANGE = 4;
export const FAN_ACCEL_UP = 15;
export const FAN_ACCEL_SIDE = 9;
export const SEESAW_FULCRUM_H = 0.4;
export const SEESAW_PLANK: [number, number, number] = [1.9, 0.08, 0.8];

/** Directions each part accepts; the first is the default. */
export const PART_DIRS: Record<PartKind, readonly Dir[]> = {
	ramp: ["right", "left"],
	domino: ["up"],
	spring: ["up", "right", "left"],
	fan: ["right", "left", "up"],
	seesaw: ["left", "right"],
};

/** Cells a part occupies, relative to its anchor cell. */
export function footprint(p: Placement): [number, number][] {
	const [c, r] = p.cell;
	if (p.part === "seesaw")
		return [
			[c, r],
			[c + 1, r],
		];
	if (p.part === "domino")
		return [
			[c, r],
			[c, r + 1],
		];
	return [[c, r]];
}

export type Role =
	| { kind: "ball" }
	| { kind: "marble" }
	| { kind: "domino" }
	| { kind: "plank" }
	| {
			kind: "spring";
			/** Trigger box (world): the ball centre inside it gets launched. */
			min: [number, number];
			max: [number, number];
			/** Launch velocity [vx, vy]. */
			launch: [number, number];
	  }
	| {
			kind: "fan";
			min: [number, number];
			max: [number, number];
			/** Acceleration [ax, ay], m/s^2. */
			accel: [number, number];
	  };

export interface PartEntity {
	/** Scene entity (input form) referencing a base.json prefab. */
	entity: {
		id: string;
		prefab: string;
		transform: {
			position: [number, number, number];
			rotation?: [number, number, number, number];
		};
	};
	role?: Role;
	/** For the view: which part and placement the entity belongs to. */
	part: PartKind | "marble";
	placement: Placement;
	fixed: boolean;
}

/** Quaternion for a rotation about +Z (the board normal). */
export function quatZ(angle: number): [number, number, number, number] {
	return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

/** World centre of a cell. */
export function cellCenter(
	level: Level,
	c: number,
	r: number,
): [number, number] {
	return [
		level.grid.origin[0] + (c + 0.5) * CELL,
		level.grid.origin[1] + (r + 0.5) * CELL,
	];
}

/** Scene entities and behaviours for one placed part. `key` makes the ids unique. */
export function partEntities(
	level: Level,
	p: Placement,
	key: string,
	fixed: boolean,
): PartEntity[] {
	const [cx, cy] = cellCenter(level, p.cell[0], p.cell[1]);
	const bottom = cy - CELL / 2;
	const out: PartEntity[] = [];
	const add = (
		sub: string,
		prefab: string,
		position: [number, number, number],
		rotation?: [number, number, number, number],
		role?: Role,
	): void => {
		out.push({
			entity: {
				id: `${key}-${sub}`,
				prefab,
				transform: rotation ? { position, rotation } : { position },
			},
			...(role ? { role } : {}),
			part: p.part,
			placement: p,
			fixed,
		});
	};
	switch (p.part) {
		case "ramp": {
			// "right": descends towards +x (clockwise tilt).
			const a = p.dir === "left" ? RAMP_ANGLE : -RAMP_ANGLE;
			add("plank", "ramp", [cx, cy, 0], quatZ(a));
			break;
		}
		case "domino":
			add(
				"block",
				"domino",
				[cx, bottom + DOMINO_SIZE[1] / 2 + 0.002, 0],
				undefined,
				{ kind: "domino" },
			);
			break;
		case "spring": {
			const top = bottom + SPRING_PAD_H;
			const s = Math.sin(SPRING_ANGLE) * SPRING_SPEED;
			const vy =
				p.dir === "up" ? SPRING_SPEED : Math.cos(SPRING_ANGLE) * SPRING_SPEED;
			const vx = p.dir === "up" ? 0 : p.dir === "right" ? s : -s;
			add("pad", "spring", [cx, bottom + SPRING_PAD_H / 2, 0], undefined, {
				kind: "spring",
				min: [cx - 0.42, top],
				max: [cx + 0.42, top + BALL_RADIUS + 0.09],
				launch: [vx, vy],
			});
			break;
		}
		case "fan": {
			if (p.dir === "up") {
				add("housing", "fanBase", [cx, bottom + 0.12, 0], undefined, {
					kind: "fan",
					min: [cx - 0.45, bottom + 0.24],
					max: [cx + 0.45, bottom + 0.24 + FAN_RANGE * CELL],
					accel: [0, FAN_ACCEL_UP],
				});
			} else {
				// The housing sits on the cell's upwind side and blows across the row.
				const sgn = p.dir === "right" ? 1 : -1;
				const hx = cx - sgn * 0.38;
				const face = hx + sgn * 0.12;
				add("housing", "fanSide", [hx, cy, 0], undefined, {
					kind: "fan",
					min: [sgn > 0 ? face : face - FAN_RANGE * CELL, bottom + 0.05],
					max: [sgn > 0 ? face + FAN_RANGE * CELL : face, bottom + CELL - 0.05],
					accel: [sgn * FAN_ACCEL_SIDE, 0],
				});
			}
			break;
		}
		case "seesaw": {
			// The fulcrum stands on the boundary between the two cells.
			const fx = cx + CELL / 2;
			add("fulcrum", "fulcrum", [fx, bottom, 0]);
			const [len, th] = SEESAW_PLANK;
			const apex = bottom + SEESAW_FULCRUM_H;
			const a = Math.asin(Math.min(1, (SEESAW_FULCRUM_H - 0.02) / (len / 2)));
			// "left": the left end starts down (counter-clockwise tilt).
			const ang = p.dir === "left" ? a : -a;
			const nx = -Math.sin(ang);
			const ny = Math.cos(ang);
			add(
				"plank",
				"plank",
				[fx + nx * (th / 2 + 0.003), apex + ny * (th / 2 + 0.003), 0],
				quatZ(ang),
				{ kind: "plank" },
			);
			break;
		}
	}
	return out;
}
