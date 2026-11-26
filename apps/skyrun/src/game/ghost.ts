import type { Course } from "./course.ts";
import { courseFingerprint } from "./course.ts";
import { emptyInput, InputLog, type TickInput } from "./input.ts";
import { PHASE, RUN, type SimWorldHost, SkyrunSim } from "./sim.ts";

/** A finished run: enough to re-simulate it as a ghost. */
export interface GhostRecord {
	v: 1;
	course: string;
	/** `courseFingerprint` of the layout it was run on; a mismatch discards it. */
	fp: string;
	/** Clock ticks at the finish (`runTicks`). */
	ticks: number;
	/** Run-length base64 `InputLog`. */
	inputs: string;
	runner: "human" | "robot";
	label: "best" | "par";
	/** Falls in the recorded run; a replay that falls more has drifted off its record. */
	falls?: number;
}

/** The course layout plus the runner's controller settings and the rules version. */
export function recordFingerprint(course: Course): string {
	return courseFingerprint(course, JSON.stringify(RUN));
}

const KEY = "skyrun.best.v1.";
/** Ghost logs longer than this (10 minutes) are refused. */
const MAX_TICKS = 60 * 600;

export function makeRecord(
	course: Course,
	ticks: number,
	log: InputLog,
	runner: GhostRecord["runner"],
	label: GhostRecord["label"],
	falls = 0,
): GhostRecord {
	return {
		v: 1,
		course: course.id,
		fp: recordFingerprint(course),
		ticks,
		inputs: log.encode(),
		runner,
		label,
		falls,
	};
}

/** Validates an untrusted record (localStorage or a shipped file) for this course. */
export function checkRecord(raw: unknown, course: Course): GhostRecord | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Partial<GhostRecord>;
	if (r.v !== 1 || r.course !== course.id || r.fp !== recordFingerprint(course))
		return null;
	if (typeof r.ticks !== "number" || typeof r.inputs !== "string") return null;
	try {
		InputLog.decode(r.inputs, MAX_TICKS);
	} catch {
		return null;
	}
	return {
		v: 1,
		course: r.course,
		fp: r.fp,
		ticks: r.ticks,
		inputs: r.inputs,
		runner: r.runner === "robot" ? "robot" : "human",
		label: r.label === "par" ? "par" : "best",
		falls: typeof r.falls === "number" ? r.falls : 0,
	};
}

export function loadBest(course: Course): GhostRecord | null {
	try {
		const s = localStorage.getItem(KEY + course.id);
		return s ? checkRecord(JSON.parse(s), course) : null;
	} catch {
		return null;
	}
}

export function saveBest(rec: GhostRecord): void {
	try {
		localStorage.setItem(KEY + rec.course, JSON.stringify(rec));
	} catch {
		// Private mode or blocked storage: the best simply is not kept.
	}
}

/**
 * A ghost: a second `SkyrunSim` on its own world, fed the recorded inputs in lockstep with
 * the live run. It is the same deterministic sim, so it retraces the recorded run exactly.
 */
export class Ghost {
	readonly sim: SkyrunSim;
	readonly record: GhostRecord;
	private readonly log: InputLog;
	private readonly inp: TickInput = emptyInput();
	/** False if the replay did not finish on the recorded tick (stale rules). */
	ok = true;

	constructor(host: SimWorldHost, course: Course, record: GhostRecord) {
		this.record = record;
		this.log = InputLog.decode(record.inputs, MAX_TICKS);
		this.sim = new SkyrunSim(host, course);
	}

	step(): void {
		const s = this.sim;
		const was = s.phase;
		s.step(this.log.read(s.tick, this.inp));
		if (
			was !== PHASE.DONE &&
			s.phase === PHASE.DONE &&
			s.runTicks !== this.record.ticks
		)
			this.ok = false;
		if (s.tick > this.log.length + 600 && s.phase !== PHASE.DONE)
			this.ok = false;
		// Drifted (for example a record from another JS engine's trig): hide it at once.
		if (s.falls > (this.record.falls ?? 0)) this.ok = false;
	}

	free(): void {
		this.sim.free();
	}
}
