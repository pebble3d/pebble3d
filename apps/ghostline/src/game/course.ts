import type { SceneInput } from "@pebble3d/sdk/schema";

/**
 * A Ghostline course: a declarative JSON file. `scene` is a plain Pebble3D scene (lighting,
 * environment, post, camera presets); `track` is a turtle-style list of segments that the
 * game expands into trimesh colliders and meshes.
 */
export interface CourseFile {
	id: string;
	name: string;
	tagline: string;
	scene: SceneInput;
	look: CourseLook;
	physics?: { gravity?: number };
	/** Medal times in seconds (gold < silver < bronze). */
	medals: { gold: number; silver: number; bronze: number };
	track: TrackDef;
}

export interface CourseLook {
	/** Deck base colour, stripe colour, roughness, clearcoat. */
	deck: { color: string; stripe: string; roughness: number; clearcoat: number };
	wall: {
		color: string;
		roughness: number;
		metalness: number;
		/** 0 = opaque; > 0 = glass panels with this transmission. */
		glass?: number;
	};
	hull: { color: string; roughness: number; metalness: number };
	/** Rail trim along the wall tops. */
	rail: { color: string; emissive?: string; emissiveIntensity?: number };
	accent: string;
	pillars: { color: string; every: number } | null;
	ground: {
		y: number;
		color: string;
		roughness: number;
		size: number;
		/** Grid line colour (studio floors). */
		grid?: string;
	};
	/** Exposure-ish multiplier on scene.environmentIntensity. */
	envIntensity?: number;
	/** Fog colour (studio courses fade to the backdrop). */
	fogColor?: string;
}

export interface TrackDef {
	start: { pos: [number, number, number]; heading: number };
	/** Default deck width and wall height (m); segments may override. */
	width: number;
	wall: number;
	segments: SegmentDef[];
}

export interface SegmentDef {
	/** Straight length (m). Mutually exclusive with `turn`/`gap`. */
	len?: number;
	/** Turn angle (deg, + = left) over `radius` (m). */
	turn?: number;
	radius?: number;
	/** An open gap (no deck) of this length (m): a jump. */
	gap?: number;
	/** Target pitch (deg, + = up) reached by the end of the blend. */
	pitch?: number;
	/** Bank (deg, leans into the turn). */
	bank?: number;
	width?: number;
	wall?: number;
	/** A boost pad in the middle of this segment. */
	boost?: boolean;
	/** A checkpoint gate at the start of this segment. */
	checkpoint?: boolean;
	/** The finish gate at the start of this segment. */
	finish?: boolean;
	/** Rotating sweeper arms in the middle of this segment. */
	sweeper?: { arm: number; speed: number; count?: number };
}

/** Validates the shape of a course file; throws with the JSON path of the first problem. */
export function parseCourse(raw: unknown): CourseFile {
	const fail = (path: string, msg: string): never => {
		throw new Error(`course${path}: ${msg}`);
	};
	if (typeof raw !== "object" || raw === null) fail("", "not an object");
	const c = raw as CourseFile;
	for (const k of ["id", "name", "tagline"] as const)
		if (typeof c[k] !== "string" || c[k].length === 0)
			fail(`.${k}`, "must be a non-empty string");
	if (typeof c.scene !== "object" || c.scene === null)
		fail(".scene", "must be a Pebble3D scene object");
	const m = c.medals;
	if (!m || !(m.gold > 0 && m.gold < m.silver && m.silver < m.bronze))
		fail(".medals", "need 0 < gold < silver < bronze");
	const t = c.track;
	if (!t || !Array.isArray(t.segments) || t.segments.length < 2)
		fail(".track.segments", "need at least two segments");
	if (!(t.width > 1) || !(t.wall >= 0)) fail(".track", "bad width/wall");
	let finishes = 0;
	t.segments.forEach((s, i) => {
		const at = `.track.segments[${i}]`;
		const kinds =
			Number(s.len !== undefined) +
			Number(s.turn !== undefined) +
			Number(s.gap !== undefined);
		if (kinds !== 1) fail(at, "needs exactly one of len, turn or gap");
		if (s.len !== undefined && !(s.len > 0)) fail(`${at}.len`, "must be > 0");
		if (s.gap !== undefined && !(s.gap > 0)) fail(`${at}.gap`, "must be > 0");
		if (s.turn !== undefined && !(s.radius !== undefined && s.radius > 2))
			fail(`${at}.radius`, "a turn needs radius > 2");
		if (s.finish) finishes++;
		if (
			s.gap !== undefined &&
			(s.boost || s.sweeper || s.checkpoint || s.finish)
		)
			fail(at, "a gap cannot hold a boost, sweeper, checkpoint or finish");
	});
	if (finishes !== 1) fail(".track.segments", "need exactly one finish");
	return c;
}
