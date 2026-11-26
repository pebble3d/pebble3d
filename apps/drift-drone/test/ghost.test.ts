import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BOT, DroneBot } from "../src/game/bot.ts";
import { EV } from "../src/game/events.ts";
import {
	acceptGhost,
	GHOST_STATE,
	Ghost,
	type GhostRecord,
	recordLap,
	trackFingerprint,
	verifyRecord,
} from "../src/game/ghost.ts";
import { emptyInput, InputLog } from "../src/game/input.ts";
import type { PhysicsHost } from "../src/game/physics.ts";
import { DroneSim, PHASE } from "../src/game/sim.ts";
import { SITE, TRACKS, trackById } from "../src/game/tracks.ts";
import { nodeHost } from "./helpers.ts";

let host: PhysicsHost;
beforeAll(async () => {
	host = await nodeHost();
});

/** A bot race that records its best lap the way the app does (at the LAP event). */
function raceAndRecord(
	trackId: string,
	vmax = DEFAULT_BOT.vmax,
): { best: GhostRecord; sim: DroneSim; log: InputLog } {
	const sim = new DroneSim(host, trackById(trackId), SITE, "assisted");
	const bot = new DroneBot(sim, { ...DEFAULT_BOT, vmax });
	const log = new InputLog();
	const inp = emptyInput();
	let best: GhostRecord | null = null;
	while (sim.phase !== PHASE.FINISHED) {
		bot.next(inp);
		log.push(inp);
		sim.step(inp);
		const e = sim.events;
		for (let k = 0; k < e.length; k++)
			if (e.type[k] === EV.LAP) {
				const lap = e.a[k] as number;
				if (!best || (e.b[k] as number) < best.lapTime)
					best = recordLap(sim, SITE, log, lap, "demo", sim.hash());
			}
	}
	if (!best) throw new Error("no lap");
	return { best, sim, log };
}

describe("ghost of the best lap", () => {
	it.each(TRACKS.map((t) => t.id))(
		"re-simulated from its input log, it matches the record on %s",
		(id) => {
			const { best, sim } = raceAndRecord(id);
			const track = trackById(id);
			const v = verifyRecord(host, track, SITE, best);
			expect(v.ok).toBe(true);
			expect(v.hash).toBe(best.hash);
			expect(v.lapTime).toBe(best.lapTime);
			sim.free();
		},
	);

	it("flies the same path as the lap it recorded, tick for tick", () => {
		const { best, sim: original } = raceAndRecord("hall-circuit");
		original.free();
		// re-fly the same race and sample the live drone during the best lap
		const track = trackById("hall-circuit");
		const live = new DroneSim(host, track, SITE, "assisted");
		const bot = new DroneBot(live);
		const inp = emptyInput();
		const path: number[] = [];
		while (live.tick < best.lapEnd) {
			bot.next(inp);
			live.step(inp);
			if (live.tick > best.lapStart)
				path.push(
					live.pos[0] as number,
					live.pos[1] as number,
					live.pos[2] as number,
				);
		}
		const g = new Ghost(host, track, SITE, best);
		// armed a little at a time, as the app does across frames
		let calls = 0;
		while (!g.arm(64)) calls++;
		expect(calls).toBeGreaterThan(2);
		expect(g.state).toBe(GHOST_STATE.PARKED);
		expect(g.sim.tick).toBe(best.lapStart);
		expect(g.launch()).toBe(true);
		let i = 0;
		while (g.state === GHOST_STATE.FLYING) {
			g.step();
			expect(g.sim.pos[0]).toBe(path[i]);
			expect(g.sim.pos[1]).toBe(path[i + 1]);
			expect(g.sim.pos[2]).toBe(path[i + 2]);
			i += 3;
		}
		expect(i).toBe(path.length);
		expect(g.verdict()).toBe(true);
		g.free();
		live.free();
	});

	it("a tampered input log no longer reproduces the record", () => {
		const { best, sim } = raceAndRecord("hall-circuit");
		sim.free();
		const log = InputLog.decode(best.inputs);
		const tampered = new InputLog();
		const inp = emptyInput();
		for (let t = 0; t < log.length; t++) {
			log.read(t, inp);
			if (t === best.lapStart + 30) inp.roll = 127;
			tampered.push(inp);
		}
		const v = verifyRecord(host, trackById("hall-circuit"), SITE, {
			...best,
			inputs: tampered.encode(),
		});
		expect(v.ok).toBe(false);
	});

	it("rejects malformed, foreign and stale records", () => {
		const { best, sim } = raceAndRecord("needle-and-eaves");
		sim.free();
		const track = trackById("needle-and-eaves");
		expect(acceptGhost(best, track, SITE)).toEqual(best);
		expect(acceptGhost(JSON.parse(JSON.stringify(best)), track, SITE)).toEqual(
			best,
		);
		expect(acceptGhost(best, trackById("hall-circuit"), SITE)).toBeNull();
		expect(acceptGhost({ ...best, fp: "deadbeef" }, track, SITE)).toBeNull();
		expect(
			acceptGhost({ ...best, lapEnd: best.lapEnd + 1 }, track, SITE),
		).toBeNull();
		expect(acceptGhost({ ...best, inputs: "%%%" }, track, SITE)).toBeNull();
		expect(
			acceptGhost({ ...best, lapTime: Number.NaN }, track, SITE),
		).toBeNull();
		expect(acceptGhost(null, track, SITE)).toBeNull();
		// `by` is shown in the HUD: only the two values the game writes are accepted
		expect(
			acceptGhost({ ...best, by: "<img src=x onerror=alert(1)>" }, track, SITE),
		).toBeNull();
		// moving one gate changes the fingerprint, so an old best expires
		const moved = structuredClone(track);
		const gp = (moved.gates[2] as { p: [number, number, number] }).p;
		gp[1] += 0.1;
		expect(trackFingerprint(moved, SITE)).not.toBe(best.fp);
	});
});
