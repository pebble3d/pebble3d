/** Headless match runner shared by tests, the demo timeline scout and balance exploration. */
import { type Belt, Cpu } from "./cpu.ts";
import { InputLog } from "./input.ts";
import { MatchSim, PHASE, type SimConfig } from "./sim.ts";

export interface PlayResult {
	sim: MatchSim;
	log: InputLog;
}

export function playCpuMatch(
	cfg: SimConfig,
	belts: [Belt, Belt],
	maxTicks = 20 * 60 * 60,
): PlayResult {
	const sim = new MatchSim(cfg);
	const a = new Cpu(0, belts[0], cfg.seed);
	const b = new Cpu(1, belts[1], cfg.seed);
	const log = new InputLog();
	while (sim.phase !== PHASE.OVER && sim.tick < maxTicks) {
		const i0 = a.next(sim);
		const i1 = b.next(sim);
		log.push(i0, i1);
		sim.step(i0, i1);
	}
	return { sim, log };
}

export function replay(cfg: SimConfig, log: InputLog): MatchSim {
	const sim = new MatchSim(cfg);
	for (let t = 0; t < log.length; t++) sim.step(log.get(t, 0), log.get(t, 1));
	return sim;
}
