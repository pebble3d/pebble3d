import {
	COUNTDOWN_TICKS,
	DRONE_MASS,
	DRONE_RADIUS,
	DT,
	type FlightMode,
	MAX_RACE_TICKS,
	TUNE,
} from "./constants.ts";
import { Fnv32 } from "./hash.ts";
import { emptyInput, InputLog, type TickInput } from "./input.ts";
import type { PhysicsHost } from "./physics.ts";
import { DroneSim } from "./sim.ts";
import type { SiteDef, TrackFile } from "./track.ts";

/** Bump when the record shape or anything the sim depends on changes incompatibly. */
export const GHOST_FORMAT = 1;

/**
 * Your best lap, as everything needed to re-simulate it and nothing recorded about the motion:
 * the race's inputs from the countdown up to the end of that lap. A lap of a race starts in
 * flight, so the ghost world replays the race up to the lap's start line (fast, headless) and
 * then flies the lap in lockstep with yours. `hash` is the sim hash at `lapEnd`; replaying must
 * reproduce it and `lapTime` exactly.
 */
export interface GhostRecord {
	v: typeof GHOST_FORMAT;
	track: string;
	mode: FlightMode;
	/** trackFingerprint() at record time. */
	fp: string;
	/** Run-length encoded input log of ticks [0, lapEnd). */
	inputs: string;
	/** Tick (sim.tick) on which the lap's start line and end line were crossed. */
	lapStart: number;
	lapEnd: number;
	lap: number;
	lapTime: number;
	hash: string;
	/** Who flew it ("you", "demo"). */
	by: string;
}

/** Hash of the track, the site's colliders, the flight tunables and constants. */
export function trackFingerprint(track: TrackFile, site: SiteDef): string {
	const h = new Fnv32();
	h.str(JSON.stringify([track.pad, track.gate, track.gates, track.laps]));
	h.str(JSON.stringify([site.bounds, site.proxies]));
	h.str(JSON.stringify(TUNE));
	h.str(
		JSON.stringify([
			GHOST_FORMAT,
			DT,
			DRONE_MASS,
			DRONE_RADIUS,
			COUNTDOWN_TICKS,
			MAX_RACE_TICKS,
		]),
	);
	return h.hex();
}

/** The record of lap `lap` of a race (completed laps only). */
export function recordLap(
	sim: DroneSim,
	site: SiteDef,
	log: InputLog,
	lap: number,
	by: string,
	hash: string,
): GhostRecord {
	const ticks = sim.lapTicks[lap];
	const time = sim.lapTimes[lap];
	if (!ticks || time === undefined)
		throw new Error(`ghost: lap ${lap} not completed`);
	return {
		v: GHOST_FORMAT,
		track: sim.track.id,
		mode: sim.mode,
		fp: trackFingerprint(sim.track, site),
		inputs: log.slice(ticks[1]).encode(),
		lapStart: ticks[0],
		lapEnd: ticks[1],
		lap,
		lapTime: time,
		hash,
		by,
	};
}

const HASH_RE = /^[0-9a-f]{16}:[0-9a-f]{8}$/;

/** Strict shape check: every field present, finite and in range. */
export function isGhostRecord(x: unknown): x is GhostRecord {
	if (typeof x !== "object" || x === null) return false;
	const g = x as Record<string, unknown>;
	const int = (v: unknown): v is number => Number.isInteger(v);
	return (
		g.v === GHOST_FORMAT &&
		typeof g.track === "string" &&
		(g.mode === "assisted" || g.mode === "acro") &&
		typeof g.fp === "string" &&
		typeof g.inputs === "string" &&
		(g.by === "you" || g.by === "demo") &&
		int(g.lapStart) &&
		int(g.lapEnd) &&
		int(g.lap) &&
		g.lapStart >= COUNTDOWN_TICKS &&
		g.lapEnd > g.lapStart &&
		g.lapEnd <= MAX_RACE_TICKS &&
		typeof g.lapTime === "number" &&
		Number.isFinite(g.lapTime) &&
		g.lapTime > 0 &&
		typeof g.hash === "string" &&
		HASH_RE.test(g.hash)
	);
}

/** Stored data as a ghost for this track, or null if malformed, stale or foreign. */
export function acceptGhost(
	raw: unknown,
	track: TrackFile,
	site: SiteDef,
): GhostRecord | null {
	if (!isGhostRecord(raw)) return null;
	if (raw.track !== track.id || raw.fp !== trackFingerprint(track, site))
		return null;
	try {
		if (InputLog.decode(raw.inputs, MAX_RACE_TICKS).length !== raw.lapEnd)
			return null;
	} catch {
		return null;
	}
	return raw;
}

export const GHOST_STATE = {
	ARMING: 0,
	PARKED: 1,
	FLYING: 2,
	ENDED: 3,
} as const;
export type GhostState = (typeof GHOST_STATE)[keyof typeof GHOST_STATE];

/**
 * A ghost: a second DroneSim on its own Rapier world, re-fed the record's inputs. It first
 * catches up to the lap's start (`arm`, a budget of ticks per call so the catch-up never
 * stalls a frame), waits there, and flies the lap one tick per live tick once `launch`ed.
 */
export class Ghost {
	readonly sim: DroneSim;
	readonly record: GhostRecord;
	state: GhostState = GHOST_STATE.ARMING;
	private readonly log: InputLog;
	private readonly inp: TickInput = emptyInput();
	private matched: boolean | null = null;

	constructor(
		host: PhysicsHost,
		track: TrackFile,
		site: SiteDef,
		record: GhostRecord,
	) {
		this.record = record;
		this.log = InputLog.decode(record.inputs, MAX_RACE_TICKS);
		if (this.log.length !== record.lapEnd)
			throw new Error(
				`ghost: ${this.log.length} inputs, record says ${record.lapEnd}`,
			);
		this.sim = new DroneSim(host, track, site, record.mode);
	}

	/** Re-simulates up to `budget` ticks toward the lap start. True once parked there. */
	arm(budget: number): boolean {
		if (this.state !== GHOST_STATE.ARMING)
			return this.state !== GHOST_STATE.ENDED;
		const end = this.record.lapStart;
		for (let n = 0; n < budget && this.sim.tick < end; n++)
			this.sim.step(this.log.read(this.sim.tick, this.inp));
		if (this.sim.tick >= end) this.state = GHOST_STATE.PARKED;
		return this.state === GHOST_STATE.PARKED;
	}

	/** Starts the lap (only from parked). */
	launch(): boolean {
		if (this.state !== GHOST_STATE.PARKED) return false;
		this.state = GHOST_STATE.FLYING;
		return true;
	}

	/** One lockstep tick while flying. */
	step(): void {
		if (this.state !== GHOST_STATE.FLYING) return;
		this.sim.step(this.log.read(this.sim.tick, this.inp));
		if (this.sim.tick >= this.record.lapEnd) this.state = GHOST_STATE.ENDED;
	}

	/** Seconds into its lap (sub-tick start). */
	lapClock(): number {
		return this.sim.raceTime - this.sim.lapStart;
	}

	/** Once ended: did the re-simulation reproduce the record's hash? (null before) */
	verdict(): boolean | null {
		if (this.state !== GHOST_STATE.ENDED) return null;
		if (this.matched === null)
			this.matched = this.sim.hash() === this.record.hash;
		return this.matched;
	}

	free(): void {
		this.sim.free();
	}
}

/** Re-simulates a whole record headless and checks its hash and lap time. */
export function verifyRecord(
	host: PhysicsHost,
	track: TrackFile,
	site: SiteDef,
	record: GhostRecord,
): { ok: boolean; hash: string; lapTime: number } {
	const g = new Ghost(host, track, site, record);
	try {
		g.arm(Number.POSITIVE_INFINITY);
		g.launch();
		while (g.state === GHOST_STATE.FLYING) g.step();
		const hash = g.sim.hash();
		const lapTime = g.sim.lapTimes[record.lap] ?? -1;
		return {
			ok: hash === record.hash && lapTime === record.lapTime,
			hash,
			lapTime,
		};
	} finally {
		g.free();
	}
}
