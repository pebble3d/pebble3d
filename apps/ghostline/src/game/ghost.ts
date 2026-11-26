import {
	COUNTDOWN_TICKS,
	DT,
	FINISH_COAST_TICKS,
	MARBLE_MASS,
	MARBLE_RADIUS,
	MAX_RUN_TICKS,
	RESPAWN_FREEZE,
	TRACK_DS,
} from "./constants.ts";
import type { Course } from "./courses.ts";
import { Fnv32 } from "./hash.ts";
import { emptyInput, InputLog, type TickInput } from "./input.ts";
import type { PhysicsHost } from "./physics.ts";
import { MarbleSim, PHASE, TUNE } from "./sim.ts";
import type { Track } from "./track.ts";

/** Bump when the record shape or anything the sim depends on changes incompatibly. */
export const GHOST_FORMAT = 2;
/** Longest run a record can hold: countdown + the run cap + the coast-down. */
export const MAX_GHOST_TICKS =
	COUNTDOWN_TICKS + MAX_RUN_TICKS + FINISH_COAST_TICKS;

/**
 * A saved run: everything needed to re-simulate it, nothing recorded about the motion.
 * `hash` and `finishTime` are what the run produced; replaying must reproduce them exactly.
 * `fp` fingerprints the course and the sim rules it was driven under, so a best recorded
 * before a course or tuning change is discarded instead of silently diverging.
 */
export interface GhostRecord {
	v: typeof GHOST_FORMAT;
	course: string;
	/** courseFingerprint() at record time. */
	fp: string;
	seed: number;
	/** Run-length encoded input log (see InputLog.encode). */
	inputs: string;
	ticks: number;
	finishTime: number;
	splits: number[];
	/** MarbleSim.hash() after the last logged tick. */
	hash: string;
	/** Who drove it ("you", "par"). */
	by: string;
}

/** Hash of the course track + physics, the sim tunables, the constants and the format. */
export function courseFingerprint(course: Course): string {
	const h = new Fnv32();
	h.str(JSON.stringify(course.track));
	h.str(JSON.stringify(course.physics ?? null));
	h.str(JSON.stringify(TUNE));
	h.str(
		JSON.stringify([
			GHOST_FORMAT,
			DT,
			MARBLE_RADIUS,
			MARBLE_MASS,
			COUNTDOWN_TICKS,
			TRACK_DS,
			RESPAWN_FREEZE,
			FINISH_COAST_TICKS,
			MAX_RUN_TICKS,
		]),
	);
	return h.hex();
}

export function recordOf(
	sim: MarbleSim,
	log: InputLog,
	by: string,
): GhostRecord {
	return {
		v: GHOST_FORMAT,
		course: sim.course.id,
		fp: courseFingerprint(sim.course as Course),
		seed: sim.seed,
		inputs: log.encode(),
		ticks: log.length,
		finishTime: sim.finishTime,
		splits: sim.splits.slice(),
		hash: sim.hash(),
		by,
	};
}

const HASH_RE = /^[0-9a-f]{16}:[0-9a-f]{8}$/;

/** Strict shape check: every field present, finite and in range. */
export function isGhostRecord(x: unknown): x is GhostRecord {
	if (typeof x !== "object" || x === null) return false;
	const g = x as Record<string, unknown>;
	const finite = (v: unknown): v is number =>
		typeof v === "number" && Number.isFinite(v);
	return (
		g.v === GHOST_FORMAT &&
		typeof g.course === "string" &&
		typeof g.fp === "string" &&
		typeof g.by === "string" &&
		typeof g.inputs === "string" &&
		Number.isInteger(g.seed) &&
		(g.seed as number) >= 0 &&
		(g.seed as number) <= 0xffffffff &&
		Number.isInteger(g.ticks) &&
		(g.ticks as number) > 0 &&
		(g.ticks as number) <= MAX_GHOST_TICKS &&
		finite(g.finishTime) &&
		g.finishTime > 0 &&
		Array.isArray(g.splits) &&
		g.splits.length <= 64 &&
		g.splits.every((s) => finite(s) && s > 0) &&
		typeof g.hash === "string" &&
		HASH_RE.test(g.hash)
	);
}

/**
 * Accepts stored data as a ghost for `course` only if it is well-formed, recorded on this
 * course under the same rules (fingerprint) and its input log decodes to `ticks` inputs.
 * Anything else (corrupt, stale, foreign) is null: callers fall back to the par ghost.
 */
export function acceptGhost(raw: unknown, course: Course): GhostRecord | null {
	if (!isGhostRecord(raw)) return null;
	if (raw.course !== course.id || raw.fp !== courseFingerprint(course))
		return null;
	try {
		if (InputLog.decode(raw.inputs, MAX_GHOST_TICKS).length !== raw.ticks)
			return null;
	} catch {
		return null;
	}
	return raw;
}

/**
 * A ghost: a second MarbleSim on its own Rapier world, re-fed the record's inputs one tick at
 * a time in lockstep with the live run. It is re-simulation, not playback of positions.
 */
export class Ghost {
	readonly sim: MarbleSim;
	readonly record: GhostRecord;
	private readonly log: InputLog;
	private readonly inp: TickInput = emptyInput();

	constructor(
		host: PhysicsHost,
		course: Course,
		track: Track,
		record: GhostRecord,
	) {
		this.record = record;
		this.log = InputLog.decode(record.inputs, MAX_GHOST_TICKS);
		if (this.log.length !== record.ticks)
			throw new Error(
				`ghost: ${this.log.length} inputs, record says ${record.ticks}`,
			);
		this.sim = new MarbleSim(host, course, track, record.seed);
	}

	/** Advances one tick (no-op once the logged run is over). */
	step(): void {
		if (this.sim.tick >= this.log.length) return;
		this.sim.step(this.log.read(this.sim.tick, this.inp));
	}

	/** True once every logged tick has been re-simulated. */
	get ended(): boolean {
		return this.sim.tick >= this.log.length;
	}

	/**
	 * Once ended: whether the re-simulation reproduced the record's hash (null before).
	 * A false here means the ghost diverged (e.g. a different JS engine's libm), and the
	 * app says so instead of passing it off as your run.
	 */
	verdict(): boolean | null {
		if (!this.ended) return null;
		if (this.matched === null)
			this.matched = this.sim.hash() === this.record.hash;
		return this.matched;
	}
	private matched: boolean | null = null;

	free(): void {
		this.sim.free();
	}
}

/**
 * Re-simulates a whole record headless and checks it reproduces its own hash and finish
 * time. This is the integrity check shown on the results screen.
 */
export function verifyRecord(
	host: PhysicsHost,
	course: Course,
	track: Track,
	record: GhostRecord,
): { ok: boolean; hash: string; finishTime: number } {
	const g = new Ghost(host, course, track, record);
	try {
		while (!g.ended) g.step();
		const hash = g.sim.hash();
		return {
			ok: hash === record.hash && g.sim.finishTime === record.finishTime,
			hash,
			finishTime: g.sim.finishTime,
		};
	} finally {
		g.free();
	}
}

/** Runs a sim to completion with an input source, logging every tick. */
export function runToEnd(
	sim: MarbleSim,
	source: (out: TickInput) => TickInput,
	log: InputLog,
	maxTicks = 60 * 300,
	onTick?: (sim: MarbleSim) => void,
): void {
	const inp = emptyInput();
	while (sim.phase !== PHASE.DONE && sim.tick < maxTicks) {
		source(inp);
		log.push(inp);
		sim.step(inp);
		onTick?.(sim);
	}
}
