import { MAX_PLAYERS } from "./constants.ts";
import { Fnv32 } from "./hash.ts";
import { emptyFrame, type InputLog } from "./input.ts";
import type { PhysicsHost } from "./physics.ts";
import { DRAW, PHASE, RoundSim } from "./sim.ts";

/** Who drives a slot. */
export type SlotKind = "p1" | "p2" | "bot" | "off";

export interface MatchConfig {
	slots: SlotKind[];
	/** Round wins needed (best of 2n-1). */
	toWin: number;
	seed: number;
}

/** What a finished round keeps: enough to re-simulate it exactly, and its live verdict. */
export interface RoundRecord {
	index: number;
	seed: number;
	active: boolean[];
	log: InputLog;
	/** RoundSim.hash() when the live round ended. */
	hash: string;
	ticks: number;
	winner: number;
	/** Ticks of each ring-out (for replay slow motion). */
	outTicks: number[];
	kos: number[];
	dashes: number[];
	bestHit: number[];
}

/** Seed of round `k` of a match: derived, so a match is fully reproducible from its seed. */
export function roundSeed(matchSeed: number, k: number): number {
	return (
		new Fnv32()
			.word(matchSeed >>> 0)
			.word(k)
			.word(0x52494e47).h >>> 0
	);
}

export function activeSlots(slots: readonly SlotKind[]): boolean[] {
	const a: boolean[] = [];
	for (let i = 0; i < MAX_PLAYERS; i++) a.push((slots[i] ?? "off") !== "off");
	return a;
}

export function recordOf(
	index: number,
	sim: RoundSim,
	log: InputLog,
): RoundRecord {
	return {
		index,
		seed: sim.seed,
		active: sim.active.slice(),
		log: log.clone(),
		hash: sim.hash(),
		ticks: sim.tick,
		winner: sim.winner,
		outTicks: sim.outOrder.map((s) => sim.outTick[s] as number),
		kos: Array.from(sim.kos),
		dashes: Array.from(sim.dashes),
		bestHit: Array.from(sim.bestHit),
	};
}

/** The best-of-N scoreboard. Pure bookkeeping, no physics. */
export class Match {
	readonly config: MatchConfig;
	readonly wins = new Int32Array(MAX_PLAYERS);
	readonly kos = new Int32Array(MAX_PLAYERS);
	readonly dashes = new Int32Array(MAX_PLAYERS);
	readonly bestHit = new Float32Array(MAX_PLAYERS);
	readonly records: RoundRecord[] = [];
	draws = 0;

	constructor(config: MatchConfig) {
		this.config = config;
	}

	get round(): number {
		return this.records.length;
	}

	nextSeed(): number {
		return roundSeed(this.config.seed, this.records.length);
	}

	add(rec: RoundRecord): void {
		this.records.push(rec);
		if (rec.winner === DRAW) this.draws++;
		else this.wins[rec.winner] = (this.wins[rec.winner] as number) + 1;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			this.kos[s] = (this.kos[s] as number) + (rec.kos[s] ?? 0);
			this.dashes[s] = (this.dashes[s] as number) + (rec.dashes[s] ?? 0);
			this.bestHit[s] = Math.max(
				this.bestHit[s] as number,
				rec.bestHit[s] ?? 0,
			);
		}
	}

	/** Match winner slot, or -1 while undecided. */
	champion(): number {
		for (let s = 0; s < MAX_PLAYERS; s++)
			if ((this.wins[s] as number) >= this.config.toWin) return s;
		return -1;
	}
}

/**
 * Re-simulates a round from its seed and input log on a fresh world and returns the final
 * hash: the instant replay's proof, and what an online lockstep peer would compare.
 */
export function resimulate(host: PhysicsHost, rec: RoundRecord): string {
	const sim = new RoundSim(host, rec.seed, rec.active);
	const f = emptyFrame();
	try {
		for (let t = 0; t < rec.log.length && sim.phase !== PHASE.OVER; t++)
			sim.step(rec.log.read(t, f));
		return sim.hash();
	} finally {
		sim.free();
	}
}
