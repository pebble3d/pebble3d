/** Parsed, index-based move list (from `src/data/moves.json`). */

export type HitShape = "arc" | "circle" | "line";

export interface HitDef {
	at: number;
	len: number;
	/** Re-hit interval within the active window (0 = once per swing). */
	every: number;
	shape: HitShape;
	radius: number;
	/** Arc full angle, radians (arc shape). */
	arc: number;
	/** Line shape: length forward and half-width. */
	length: number;
	width: number;
	damage: number;
	stagger: number;
	knockback: number;
	launch: number;
	hitstop: number;
	shake: number;
	focus: number;
	poise: number;
	/** Pulls targets toward the player, m/s. */
	pull: number;
}

export interface MoveDef {
	id: string;
	index: number;
	name: string;
	total: number;
	/** Cancel window [from, to] (inclusive), or null when the move cannot be cancelled. */
	cancel: [number, number] | null;
	dodgeCancel: number;
	iframes: [number, number] | null;
	root: [number, number, number][];
	dash: [number, number, number][];
	vy: [number, number, number][];
	hold: { at: number; untilGrounded: boolean } | null;
	charge: { at: number; min: number; max: number; into: number } | null;
	air: boolean;
	finisher: boolean;
	shockwave: boolean;
	steer: number;
	focusCost: number;
	cooldown: number;
	/** Visual spin rate, rad/s (Spin Storm). */
	spin: number;
	hits: HitDef[];
	pose: number[][];
	nextLight: number;
	nextHeavy: number;
}

export interface MoveSet {
	moves: MoveDef[];
	byId: Map<string, number>;
	/** Guard pose `[armYaw, armPitch, bladeYaw, bladePitch, reach?, grip?]` (no frame). */
	rest: number[];
	/** The carry while running (blended in with speed). */
	restRun: number[];
	/** Indices of the moves the machine starts by itself. */
	light1: number;
	heavy: number;
	plunge: number;
	dodge: number;
	spinStorm: number;
}

interface RawHit {
	at: number;
	len: number;
	every?: number;
	shape: HitShape;
	radius?: number;
	arc?: number;
	length?: number;
	width?: number;
	damage: number;
	stagger?: number;
	knockback?: number;
	launch?: number;
	hitstop?: number;
	shake?: number;
	focus?: number;
	poise?: number;
	pull?: number;
}

interface RawMove {
	name: string;
	total: number;
	cancel?: [number, number];
	dodgeCancel?: number;
	iframes?: [number, number];
	root?: [number, number, number][];
	dash?: [number, number, number][];
	vy?: [number, number, number][];
	hold?: { at: number; untilGrounded?: boolean };
	charge?: { at: number; min: number; max: number; into: string };
	air?: boolean;
	finisher?: boolean;
	shockwave?: boolean;
	steer?: number;
	focusCost?: number;
	cooldown?: number;
	spin?: number;
	hits: RawHit[];
	pose: number[][];
	next?: { light?: string; heavy?: string };
}

export interface RawMoveFile {
	rest: number[];
	restRun?: number[];
	moves: Record<string, RawMove>;
}

const REQUIRED = ["light1", "heavy", "plunge", "dodge", "spinStorm"] as const;
const DEG = Math.PI / 180;

/** Validates and indexes the JSON move list. Throws on unknown references or bad frames. */
export function parseMoves(raw: RawMoveFile): MoveSet {
	const ids = Object.keys(raw.moves);
	const byId = new Map<string, number>();
	ids.forEach((id, i) => {
		byId.set(id, i);
	});
	const ref = (from: string, to: string | undefined): number => {
		if (to === undefined) return -1;
		const i = byId.get(to);
		if (i === undefined)
			throw new Error(`moves: ${from} references unknown move "${to}"`);
		return i;
	};
	const moves = ids.map((id, index): MoveDef => {
		const m = raw.moves[id] as RawMove;
		if (!(m.total > 0)) throw new Error(`moves: ${id}.total must be > 0`);
		if (m.cancel && (m.cancel[0] > m.cancel[1] || m.cancel[1] > m.total))
			throw new Error(`moves: ${id}.cancel out of range`);
		for (const h of m.hits)
			if (h.at < 0 || h.at + h.len > m.total + 1)
				throw new Error(`moves: ${id} hit window outside the move`);
		if (m.pose.length === 0) throw new Error(`moves: ${id}.pose is empty`);
		return {
			id,
			index,
			name: m.name,
			total: m.total,
			cancel: m.cancel ?? null,
			dodgeCancel: m.dodgeCancel ?? m.total,
			iframes: m.iframes ?? null,
			root: m.root ?? [],
			dash: m.dash ?? [],
			vy: m.vy ?? [],
			hold: m.hold
				? { at: m.hold.at, untilGrounded: m.hold.untilGrounded === true }
				: null,
			charge: m.charge
				? { ...m.charge, into: ref(`${id}.charge`, m.charge.into) }
				: null,
			air: m.air === true,
			finisher: m.finisher === true,
			shockwave: m.shockwave === true,
			steer: m.steer ?? 0,
			focusCost: m.focusCost ?? 0,
			cooldown: m.cooldown ?? 0,
			spin: m.spin ?? 0,
			hits: m.hits.map((h) => ({
				at: h.at,
				len: h.len,
				every: h.every ?? 0,
				shape: h.shape,
				radius: h.radius ?? 0,
				arc: (h.arc ?? 360) * DEG,
				length: h.length ?? 0,
				width: h.width ?? 0,
				damage: h.damage,
				stagger: h.stagger ?? 0,
				knockback: h.knockback ?? 0,
				launch: h.launch ?? 0,
				hitstop: h.hitstop ?? 0,
				shake: h.shake ?? 0,
				focus: h.focus ?? 0,
				poise: h.poise ?? 1,
				pull: h.pull ?? 0,
			})),
			pose: m.pose,
			nextLight: -1,
			nextHeavy: -1,
		};
	});
	ids.forEach((id, i) => {
		const m = raw.moves[id] as RawMove;
		const d = moves[i] as MoveDef;
		d.nextLight = ref(`${id}.next.light`, m.next?.light);
		d.nextHeavy = ref(`${id}.next.heavy`, m.next?.heavy);
	});
	for (const r of REQUIRED)
		if (!byId.has(r)) throw new Error(`moves: missing required move "${r}"`);
	return {
		moves,
		byId,
		rest: raw.rest,
		restRun: raw.restRun ?? raw.rest,
		light1: byId.get("light1") as number,
		heavy: byId.get("heavy") as number,
		plunge: byId.get("plunge") as number,
		dodge: byId.get("dodge") as number,
		spinStorm: byId.get("spinStorm") as number,
	};
}

/** Piecewise-constant lookup in `[from, to, value]` ranges (to exclusive); `fallback` outside. */
export function rangeValue(
	ranges: [number, number, number][],
	frame: number,
	fallback: number,
): number {
	for (let i = 0; i < ranges.length; i++) {
		const r = ranges[i] as [number, number, number];
		if (frame >= r[0] && frame < r[1]) return r[2];
	}
	return fallback;
}
