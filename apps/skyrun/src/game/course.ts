import { z } from "zod";

/**
 * A Skyrun course: floating islands, blocks (steps, ramps, walls), kinematic movers,
 * ordered checkpoints, a goal, optional shards and the demo bot's route. Courses are
 * plain JSON in `apps/skyrun/courses/`, validated here; `buildCourse` turns one into
 * engine entity descriptions (`world.spawn` JSON) plus the mover table the sim drives.
 */

const V3 = z.tuple([z.number(), z.number(), z.number()]);
export type V3 = z.infer<typeof V3>;

const Island = z.strictObject({
	/** Centre of the flat top face. */
	pos: V3,
	radius: z.number().positive(),
	/** Depth of the rocky underside below the top, metres (visual; the collider is 1.2 m). */
	depth: z.number().positive().default(6),
	/** Seed for the underside's jagged shape. */
	seed: z.number().int().default(1),
	/** "grass" (default) or "stone" top. */
	top: z.enum(["grass", "stone", "sand"]).default("grass"),
});

const Block = z.strictObject({
	/** Centre. */
	pos: V3,
	size: V3,
	/** Yaw, degrees (about +Y). */
	yaw: z.number().default(0),
	/** Pitch after yaw, degrees (about the block's local +X): ramps. Positive raises -Z. */
	tilt: z.number().default(0),
	kind: z.enum(["stone", "wood", "brass", "crystal"]).default("stone"),
});

const Stairs = z.strictObject({
	/** Centre of the first step's footprint at the ground it starts from. */
	from: V3,
	/** Yaw of the climb direction, degrees: 0 climbs toward -Z. */
	yaw: z.number().default(0),
	steps: z.number().int().positive(),
	rise: z.number().positive(),
	run: z.number().positive(),
	width: z.number().positive(),
	kind: z.enum(["stone", "wood", "brass", "crystal"]).default("stone"),
});

const Mover = z.strictObject({
	id: z.string(),
	/**
	 * slide: ping-pong between `pos` and `to` (eased); spin: turns about +Y at `rate`;
	 * orbit: circles `pos` at `radius`, staying level (a gondola).
	 */
	kind: z.enum(["slide", "spin", "orbit"]),
	shape: z.enum(["box", "disc"]).default("box"),
	/** Box: full size. Disc: [diameter, thickness, diameter]. */
	size: V3,
	pos: V3,
	to: V3.optional(),
	/** slide/orbit: seconds per full cycle. */
	period: z.number().positive().default(6),
	/** Cycle offset in [0, 1). */
	phase: z.number().default(0),
	/** spin: degrees per second (positive is counter-clockwise seen from above). */
	rate: z.number().default(30),
	/** orbit: radius. */
	radius: z.number().default(3),
	/** Fraction of each slide half-cycle spent resting at an end. */
	hold: z.number().min(0).max(0.8).default(0.2),
});

const BotStep = z.strictObject({
	/** Target (x, y, z); y only matters for `waitMover`. */
	to: V3,
	/** Arrival radius. */
	within: z.number().positive().default(0.6),
	/** Jump once on reaching `jumpAt` metres from `to` (or immediately at 0). */
	jump: z.boolean().default(false),
	jumpAt: z.number().default(0),
	sprint: z.boolean().default(true),
	/** Before heading to `to`, wait until this mover is within `near` metres of `at`. */
	waitMover: z
		.strictObject({ id: z.string(), at: V3, near: z.number().positive() })
		.optional(),
	/** Stand still this many ticks first. */
	pause: z.number().int().default(0),
	/** Before heading to `to`, wait until this spinning mover's yaw is `deg` (mod `mod`). */
	waitAngle: z
		.strictObject({
			id: z.string(),
			deg: z.number(),
			within: z.number().positive().default(6),
			mod: z.number().positive().default(360),
		})
		.optional(),
	/** Before heading to `to`, stand still until the runner rides to within `near` of `at` (XZ). */
	waitSelf: z.strictObject({ at: V3, near: z.number().positive() }).optional(),
	/** `to` is an offset from this mover's current position (walking onto a platform). */
	rel: z.string().optional(),
});

export const CourseSchema = z.strictObject({
	id: z.string(),
	name: z.string(),
	tagline: z.string(),
	/** Medal times in seconds. */
	medals: z.strictObject({
		gold: z.number().positive(),
		silver: z.number().positive(),
		bronze: z.number().positive(),
	}),
	/** Falling below this height respawns at the last checkpoint. */
	killY: z.number(),
	start: z.strictObject({ pos: V3, yaw: z.number().default(0) }),
	islands: z.array(Island).default([]),
	blocks: z.array(Block).default([]),
	stairs: z.array(Stairs).default([]),
	movers: z.array(Mover).default([]),
	/** Ordered; each stores its respawn yaw. */
	checkpoints: z
		.array(z.strictObject({ pos: V3, yaw: z.number().default(0) }))
		.default([]),
	goal: z.strictObject({ pos: V3 }),
	shards: z.array(V3).default([]),
	bot: z.array(BotStep).default([]),
	/** Hero camera framing for the title screen. */
	view: z.strictObject({ eye: V3, target: V3 }),
});

export type Course = z.infer<typeof CourseSchema>;
export type CourseInput = z.input<typeof CourseSchema>;
export type MoverDef = z.infer<typeof Mover>;
export type BlockDef = z.infer<typeof Block>;
export type IslandDef = z.infer<typeof Island>;
export type BotStepDef = z.infer<typeof BotStep>;

export function parseCourse(json: unknown): Course {
	const r = CourseSchema.safeParse(json);
	if (!r.success) {
		const msg = r.error.issues
			.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("; ");
		throw new Error(`invalid course: ${msg}`);
	}
	const c = r.data;
	const ids = new Set<string>();
	for (const m of c.movers) {
		if (ids.has(m.id))
			throw new Error(`invalid course: duplicate mover "${m.id}"`);
		ids.add(m.id);
		if (m.kind === "slide" && !m.to)
			throw new Error(`invalid course: slide mover "${m.id}" needs "to"`);
	}
	for (const b of c.bot) {
		if (b.waitMover && !ids.has(b.waitMover.id))
			throw new Error(
				`invalid course: bot waits for unknown mover "${b.waitMover.id}"`,
			);
		if (b.waitAngle && !ids.has(b.waitAngle.id))
			throw new Error(
				`invalid course: bot waits for unknown mover "${b.waitAngle.id}"`,
			);
		if (b.rel !== undefined && !ids.has(b.rel))
			throw new Error(
				`invalid course: bot step relative to unknown mover "${b.rel}"`,
			);
	}
	return c;
}

const DEG = Math.PI / 180;

/** Quaternion [x, y, z, w] for yaw (about Y) then pitch (about the yawed X), degrees. */
export function yawTilt(
	yawDeg: number,
	tiltDeg: number,
): [number, number, number, number] {
	const hy = yawDeg * DEG * 0.5;
	const hp = tiltDeg * DEG * 0.5;
	const cy = Math.cos(hy);
	const sy = Math.sin(hy);
	const cp = Math.cos(hp);
	const sp = Math.sin(hp);
	// q = qYaw * qPitch
	return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** Stairs expanded into solid blocks (each step reaches down to the start height). */
export function stairBlocks(s: z.infer<typeof Stairs>): BlockDef[] {
	const out: BlockDef[] = [];
	const fx = -Math.sin(s.yaw * DEG);
	const fz = -Math.cos(s.yaw * DEG);
	for (let i = 0; i < s.steps; i++) {
		const h = s.rise * (i + 1);
		const d = s.run * i;
		out.push({
			pos: [s.from[0] + fx * d, s.from[1] + h / 2, s.from[2] + fz * d],
			size: [s.width, h, s.run],
			yaw: s.yaw,
			tilt: 0,
			kind: s.kind,
		});
	}
	return out;
}

/** Every block of the course, stairs included. */
export function allBlocks(c: Course): BlockDef[] {
	return [...c.blocks, ...c.stairs.flatMap(stairBlocks)];
}

/** Collider height of an island's solid top slab. */
export const ISLAND_SLAB = 1.2;
const RING = 20;

/** Convex prism (n-gon) points, flat [x,y,z,...], top at y = 0, bottom at -h (tapered). */
export function prismPoints(
	radius: number,
	h: number,
	taper = 0.85,
	n = RING,
): number[] {
	const pts: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		const c = Math.cos(a);
		const s = Math.sin(a);
		pts.push(c * radius, 0, s * radius);
		pts.push(c * radius * taper, -h, s * radius * taper);
	}
	return pts;
}

/** Engine entity description JSON (what `world.spawn` takes). */
export type EntityDesc = Record<string, unknown>;

export function islandDesc(i: IslandDef): EntityDesc {
	return {
		name: "island",
		position: i.pos,
		body: {
			type: "static",
			friction: 0.8,
			collider: {
				shape: "convexHull",
				points: prismPoints(i.radius, ISLAND_SLAB),
			},
		},
	};
}

export function blockDesc(b: BlockDef): EntityDesc {
	return {
		name: "block",
		position: b.pos,
		rotation: yawTilt(b.yaw, b.tilt),
		body: {
			type: "static",
			friction: 0.8,
			collider: {
				shape: "box",
				halfExtents: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2],
			},
		},
	};
}

export function moverDesc(m: MoverDef): EntityDesc {
	const collider =
		m.shape === "disc"
			? {
					shape: "convexHull",
					points: prismPoints(m.size[0] / 2, m.size[1], 1, 24).map((v, k) =>
						k % 3 === 1 ? v + m.size[1] / 2 : v,
					),
				}
			: {
					shape: "box",
					halfExtents: [m.size[0] / 2, m.size[1] / 2, m.size[2] / 2],
				};
	return {
		name: `mover:${m.id}`,
		position: m.pos,
		body: { type: "kinematic", friction: 0.8, collider },
	};
}

/** Smoothstep. */
function ease(t: number): number {
	return t * t * (3 - 2 * t);
}

/**
 * A mover's pose at sim time `s` seconds: writes [x, y, z] into `p` and [qx, qy, qz, qw]
 * into `q`. Pure function of the def and `s`, so it is identical in every replay.
 */
export function moverPose(
	m: MoverDef,
	s: number,
	p: Float64Array,
	q: Float64Array,
): void {
	let cyc = s / m.period + m.phase;
	cyc -= Math.floor(cyc);
	p[0] = m.pos[0];
	p[1] = m.pos[1];
	p[2] = m.pos[2];
	q[0] = 0;
	q[1] = 0;
	q[2] = 0;
	q[3] = 1;
	if (m.kind === "slide" && m.to) {
		// 0 -> 1 -> 0 over a cycle, resting `hold` of each half at the ends.
		const half = cyc < 0.5 ? cyc * 2 : (1 - cyc) * 2;
		const h = m.hold;
		const u = Math.min(1, Math.max(0, (half - h / 2) / (1 - h)));
		const k = ease(u);
		p[0] = m.pos[0] + (m.to[0] - m.pos[0]) * k;
		p[1] = m.pos[1] + (m.to[1] - m.pos[1]) * k;
		p[2] = m.pos[2] + (m.to[2] - m.pos[2]) * k;
	} else if (m.kind === "spin") {
		const a = (m.rate * s * DEG) / 2;
		q[1] = Math.sin(a);
		q[3] = Math.cos(a);
	} else if (m.kind === "orbit") {
		const a = cyc * Math.PI * 2;
		p[0] = m.pos[0] + Math.cos(a) * m.radius;
		p[2] = m.pos[2] + Math.sin(a) * m.radius;
	}
}

/**
 * Bump when the sim rules or the runner's controller change in a way that changes replays,
 * so stored bests and shipped ghosts recorded under the old rules are discarded.
 */
export const RULES_VERSION = "skyrun-rules-2";

/** FNV-1a over the rules version and the course JSON. */
export function courseFingerprint(c: Course, rules = ""): string {
	const s = RULES_VERSION + rules + JSON.stringify(c);
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}
