import { z } from "zod";

/**
 * A Chain Reaction level: puzzle metadata (grid, inventory, ball, goal, reference
 * solution) wrapped around a declarative engine scene. `scene` is a partial
 * `@pebble3d/sdk` scene; `composeScene` merges it over `levels/base.json` and adds the
 * placed parts as prefab entities, and the result is validated by the sdk's zod
 * `SceneSchema` like any other scene.
 */

export const PART_KINDS = [
	"ramp",
	"domino",
	"spring",
	"fan",
	"seesaw",
] as const;
export type PartKind = (typeof PART_KINDS)[number];

export const DIRS = ["left", "right", "up"] as const;
export type Dir = (typeof DIRS)[number];

const Cell = z
	.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
	.describe("[column, row]; row 0 is the bottom row.");

export const PlacementSchema = z.strictObject({
	part: z.enum(PART_KINDS),
	cell: Cell,
	dir: z
		.enum(DIRS)
		.describe(
			"ramp: the side it descends towards. spring: launch direction. fan: blow direction. seesaw: the end that starts down.",
		),
});
export type Placement = z.output<typeof PlacementSchema>;

export const LevelSchema = z.strictObject({
	$schema: z.string().optional(),
	id: z.string().min(1),
	name: z.string().min(1),
	hint: z.string().default(""),
	grid: z.strictObject({
		cols: z.number().int().min(4).max(24),
		rows: z.number().int().min(3).max(14),
		origin: z
			.tuple([z.number(), z.number()])
			.describe("World [x, y] of the grid's bottom-left corner (metres)."),
	}),
	ball: z.strictObject({
		cell: Cell,
		velocity: z
			.tuple([z.number(), z.number()])
			.default([0, 0])
			.describe("Initial [vx, vy], m/s."),
	}),
	marbles: z
		.array(
			z.strictObject({
				cell: Cell,
				velocity: z.tuple([z.number(), z.number()]).default([0, 0]),
			}),
		)
		.default([])
		.describe(
			"Heavy starter marbles: they trigger the machine but do not score.",
		),
	goal: z.strictObject({ cell: Cell }),
	inventory: z.partialRecord(z.enum(PART_KINDS), z.number().int().min(1)),
	par: z
		.number()
		.int()
		.min(1)
		.describe("Parts used for three stars (the reference solution's count)."),
	timeLimit: z
		.number()
		.int()
		.positive()
		.default(900)
		.describe("Ticks (60 Hz) before the run fails."),
	fixed: z
		.array(PlacementSchema)
		.default([])
		.describe("Parts that are part of the level and cannot be moved."),
	solution: z
		.array(PlacementSchema)
		.min(1)
		.describe("The reference solution `verify` checks."),
	expect: z
		.strictObject({
			tick: z.number().int().positive(),
			hash: z.string().regex(/^[0-9a-f]{16}$/),
		})
		.optional()
		.describe(
			"The reference run's solve tick and engine state hash (written by `verify --update`).",
		),
	scene: z
		.record(z.string(), z.unknown())
		.default({})
		.describe(
			"Partial scene merged over levels/base.json (entities are appended).",
		),
});
export type LevelInput = z.input<typeof LevelSchema>;
export type Level = z.output<typeof LevelSchema>;

export function parseLevel(input: unknown): Level {
	const r = LevelSchema.safeParse(input);
	if (r.success) return r.data;
	const i = r.error.issues[0];
	throw new Error(
		`level ${(i?.path ?? []).join(".") || "(root)"}: ${i?.message ?? "invalid"}`,
	);
}

/** Star rating by parts used: 3 at or under par, 2 at par + 1, else 1. */
export function starsFor(partsUsed: number, par: number): 1 | 2 | 3 {
	if (partsUsed <= par) return 3;
	if (partsUsed <= par + 1) return 2;
	return 1;
}

/** The level JSON Schema (input view) as written to level.schema.json. */
export function levelJsonSchema(): string {
	const schema = z.toJSONSchema(LevelSchema, { io: "input" });
	return `${JSON.stringify({ title: "Chain Reaction level", ...schema }, null, "\t")}\n`;
}
