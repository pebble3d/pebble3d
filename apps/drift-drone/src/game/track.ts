/**
 * Tracks and sites as data. A site is one splat capture's flight volume plus the proxy boxes
 * that stand in for its solid parts (the splat itself has no physics). A track is a JSON file
 * of gates on a site: the race flies them in order, gate 0 being the start/finish line.
 */

export type Vec3 = [number, number, number];

export interface ProxyBox {
	id: string;
	/** Centre and half extents (m). */
	c: Vec3;
	h: Vec3;
}

export interface SiteDef {
	id: string;
	name: string;
	credit: string;
	/** Flight volume: [x, y, z] min/max. Outside it is drone blur (or the ceiling). */
	bounds: { min: Vec3; max: Vec3 };
	proxies: ProxyBox[];
}

export interface GateDef {
	/** Centre of the opening (m). */
	p: Vec3;
	/** Horizontal direction you fly through it, [dx, dz] (normalised on load). */
	dir: [number, number];
	/** Inner opening width and height (m); defaults from the track. */
	w?: number;
	h?: number;
	/** Short callout shown on the HUD ("Garden hop"). */
	name?: string;
}

export interface TrackFile {
	id: string;
	name: string;
	tagline: string;
	difficulty: string;
	site: string;
	laps: number;
	/** Launch pad on the floor and the direction the drone faces on it. */
	pad: { p: Vec3; dir: [number, number] };
	gate: { w: number; h: number };
	gates: GateDef[];
	/** Lap medal times (s). */
	medals: { gold: number; silver: number; bronze: number };
	/** Title / results orbit centre and radius. */
	view: { center: Vec3; radius: number; height: number; angle: number };
	/** Accent colours for the gate lights: [next gate, others]. */
	colors: [string, string];
}

/** A gate with its derived frame: n = through direction, r = its right-hand lateral axis. */
export interface Gate {
	index: number;
	name: string;
	cx: number;
	cy: number;
	cz: number;
	nx: number;
	nz: number;
	/** Lateral axis (right when flying through): (-nz, 0, nx). */
	rx: number;
	rz: number;
	w: number;
	h: number;
	/** Yaw quaternion (y, w components; x = z = 0) turning -Z onto the gate direction. */
	qy: number;
	qw: number;
}

/** Gate frame bar thickness (m). */
export const BAR = 0.09;

function fail(msg: string): never {
	throw new Error(`track: ${msg}`);
}

function isVec3(v: unknown): v is Vec3 {
	return (
		Array.isArray(v) &&
		v.length === 3 &&
		v.every((x) => typeof x === "number" && Number.isFinite(x))
	);
}
function isVec2(v: unknown): v is [number, number] {
	return (
		Array.isArray(v) &&
		v.length === 2 &&
		v.every((x) => typeof x === "number" && Number.isFinite(x))
	);
}

/** Yaw quaternion [qy, qw] that turns -Z onto (dx, 0, dz) (unit). Square roots only. */
export function yawQuat(dx: number, dz: number): [number, number] {
	// half-vector: q = normalize(cross(a, d), 1 + dot(a, d)) with a = (0, 0, -1)
	const y = -dx;
	const w = 1 - dz;
	const l = Math.sqrt(y * y + w * w);
	if (l < 1e-9) return [1, 0]; // d = +Z: half turn about Y
	return [y / l, w / l];
}

/** Validates a track file against its site (gates inside the bounds, sane sizes). */
export function parseTrack(raw: unknown, site: SiteDef): TrackFile {
	const t = raw as TrackFile;
	if (typeof t !== "object" || t === null) fail("not an object");
	for (const k of ["id", "name", "tagline", "difficulty", "site"] as const)
		if (typeof t[k] !== "string" || t[k].length === 0)
			fail(`${k} must be a string`);
	if (t.site !== site.id) fail(`${t.id}: site "${t.site}" is not "${site.id}"`);
	if (!Number.isInteger(t.laps) || t.laps < 1 || t.laps > 9)
		fail(`${t.id}: laps 1-9`);
	if (!t.pad || !isVec3(t.pad.p) || !isVec2(t.pad.dir))
		fail(`${t.id}: bad pad`);
	if (!t.gate || !(t.gate.w > 0.6) || !(t.gate.h > 0.6))
		fail(`${t.id}: bad default gate size`);
	if (!Array.isArray(t.gates) || t.gates.length < 3 || t.gates.length > 24)
		fail(`${t.id}: 3-24 gates`);
	const { min, max } = site.bounds;
	t.gates.forEach((g, i) => {
		if (!isVec3(g.p) || !isVec2(g.dir))
			fail(`${t.id}: gate ${i} needs p and dir`);
		if (Math.hypot(g.dir[0], g.dir[1]) < 1e-6)
			fail(`${t.id}: gate ${i} dir is zero`);
		const w = g.w ?? t.gate.w;
		const h = g.h ?? t.gate.h;
		if (!(w > 0.6 && h > 0.6)) fail(`${t.id}: gate ${i} too small`);
		for (let a = 0; a < 3; a++) {
			const v = g.p[a] as number;
			if (v < (min[a] as number) || v > (max[a] as number))
				fail(`${t.id}: gate ${i} is outside the site bounds`);
		}
		if (g.p[1] + h / 2 + BAR > max[1])
			fail(`${t.id}: gate ${i} pokes through the ceiling`);
	});
	if (
		!(
			t.medals &&
			t.medals.gold < t.medals.silver &&
			t.medals.silver < t.medals.bronze
		)
	)
		fail(`${t.id}: medals must be gold < silver < bronze`);
	if (
		!t.view ||
		!isVec3(t.view.center) ||
		![t.view.radius, t.view.height, t.view.angle].every(Number.isFinite)
	)
		fail(`${t.id}: bad view`);
	if (!Array.isArray(t.colors) || t.colors.length !== 2)
		fail(`${t.id}: colors [next, other]`);
	return t;
}

/** The track's gates with derived frames. */
export function gatesOf(t: TrackFile): Gate[] {
	return t.gates.map((g, index) => {
		const l = Math.sqrt(g.dir[0] * g.dir[0] + g.dir[1] * g.dir[1]);
		const nx = g.dir[0] / l;
		const nz = g.dir[1] / l;
		const [qy, qw] = yawQuat(nx, nz);
		return {
			index,
			name: g.name ?? `Gate ${index}`,
			cx: g.p[0],
			cy: g.p[1],
			cz: g.p[2],
			nx,
			nz,
			rx: -nz,
			rz: nx,
			w: g.w ?? t.gate.w,
			h: g.h ?? t.gate.h,
			qy,
			qw,
		};
	});
}

/**
 * The static boxes one gate adds to the world, in the gate's local frame (x lateral, y up,
 * z along -dir): two side posts that run down to the floor as legs, a top bar and, when the
 * opening is off the floor, a bottom bar.
 */
export function gateBars(
	g: Gate,
): { lx: number; ly: number; hx: number; hy: number; hz: number }[] {
	const hw = g.w / 2 + BAR / 2;
	const top = g.cy + g.h / 2 + BAR;
	const bottom = g.cy - g.h / 2 - BAR / 2;
	const bars = [
		{ lx: -hw, ly: top / 2, hx: BAR / 2, hy: top / 2, hz: BAR / 2 },
		{ lx: hw, ly: top / 2, hx: BAR / 2, hy: top / 2, hz: BAR / 2 },
		{
			lx: 0,
			ly: g.cy + g.h / 2 + BAR / 2,
			hx: g.w / 2,
			hy: BAR / 2,
			hz: BAR / 2,
		},
	];
	if (bottom > BAR)
		bars.push({ lx: 0, ly: bottom, hx: g.w / 2, hy: BAR / 2, hz: BAR / 2 });
	return bars;
}
