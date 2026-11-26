import { describe, expect, it } from "vitest";
import { COURSES, type Course } from "../src/game/courses.ts";
import {
	acceptGhost,
	courseFingerprint,
	Ghost,
	type GhostRecord,
	isGhostRecord,
	MAX_GHOST_TICKS,
} from "../src/game/ghost.ts";
import { InputLog } from "../src/game/input.ts";
import { parGhost } from "../src/game/par.ts";
import { Track } from "../src/game/track.ts";
import { physicsHost } from "./helpers.ts";

const course = COURSES[0] as Course;
const par = (): GhostRecord => {
	const r = parGhost(course.id);
	if (!r) throw new Error("no par ghost");
	return structuredClone(r);
};

describe("stored ghost validation", () => {
	it("accepts the shipped par ghost for its own course only", () => {
		expect(acceptGhost(par(), course)).not.toBeNull();
		expect(acceptGhost(par(), COURSES[1] as Course)).toBeNull();
	});

	it("rejects corrupt data instead of throwing", () => {
		const bad: unknown[] = [
			null,
			"text",
			{ ...par(), inputs: "%%% not base64 %%%" },
			{ ...par(), inputs: btoa("abc") }, // not whole 5-byte runs
			{ ...par(), ticks: par().ticks + 1 }, // log length disagrees
			{ ...par(), finishTime: -1 },
			{ ...par(), finishTime: Number.NaN },
			{ ...par(), splits: [1, Number.NaN] },
			{ ...par(), ticks: MAX_GHOST_TICKS + 1 },
			{ ...par(), seed: 1.5 },
			{ ...par(), hash: "nothex" },
			{ ...par(), v: 1 },
		];
		for (const b of bad) expect(() => acceptGhost(b, course)).not.toThrow();
		for (const b of bad) expect(acceptGhost(b, course)).toBeNull();
	});

	it("discards a stale best recorded before a course or tuning change", () => {
		const changed = structuredClone(course);
		(changed.track.segments[1] as { pitch?: number }).pitch = -10;
		expect(courseFingerprint(changed)).not.toBe(courseFingerprint(course));
		expect(acceptGhost(par(), changed)).toBeNull();
		const g = par();
		expect(isGhostRecord(g)).toBe(true);
		expect(acceptGhost({ ...g, fp: "00000000" }, course)).toBeNull();
	});

	it("caps run-length decoding (no runaway expansion)", () => {
		// one run of 65535 ticks, repeated: far over the cap
		const run = String.fromCharCode(0xff, 0xff, 0, 0, 0);
		const b64 = btoa(run.repeat(40));
		expect(() => InputLog.decode(b64, MAX_GHOST_TICKS)).toThrow(
			/longer than allowed/,
		);
	});

	it("reports at runtime when a ghost does not reproduce its recorded hash", async () => {
		const host = await physicsHost();
		const track = new Track(course.track);
		const ok = new Ghost(host, course, track, par());
		// same shape, one input flipped mid-run: it validates but cannot reproduce the hash
		const bytes = InputLog.decode(par().inputs).bytes();
		bytes[600 * 3] = (bytes[600 * 3] as number) === 127 ? -127 : 127;
		const wrong = new Ghost(host, course, track, {
			...par(),
			inputs: InputLog.from(bytes).encode(),
		});
		expect(ok.verdict()).toBeNull();
		while (!ok.ended) ok.step();
		while (!wrong.ended) wrong.step();
		expect(ok.verdict()).toBe(true);
		expect(wrong.verdict()).toBe(false);
		ok.free();
		wrong.free();
	});
});
