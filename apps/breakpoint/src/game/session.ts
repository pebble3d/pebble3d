import {
	SETTLE_MAX_TICKS,
	SHOT_MAX_TICKS,
	SHOT_MIN_TICKS,
	SHOT_SETTLED_AWAKE,
} from "./constants.ts";
import { LEVELS, type LevelDef } from "./levels.ts";
import { type Shot, Site, type WorldSource } from "./site.ts";

export const PHASE = {
	SETTLING: 0,
	AIM: 1,
	SHOT: 2,
	SHOT_DONE: 3,
	LEVEL_DONE: 4,
	RUN_DONE: 5,
} as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];
export const PHASE_NAMES = [
	"settling",
	"aim",
	"shot",
	"shotDone",
	"levelDone",
	"runDone",
] as const;

/** One tick of player intent. `fire` launches a ball with velocity v (AIM phase only). */
export interface TickInput {
	fire: boolean;
	vx: number;
	vy: number;
	vz: number;
	/** Continue past a level or run card. */
	advance: boolean;
}

export function emptyInput(): TickInput {
	return { fire: false, vx: 0, vy: 0, vz: 0, advance: false };
}

export interface ShotResult {
	level: number;
	/** 0-based shot index within the level. */
	index: number;
	shot: Shot;
	/** Mass this shot knocked below the line, kg. */
	kg: number;
	endTick: number;
	/** World state hash at endTick: the replay must reproduce it. */
	endHash: string;
}

/** Ticks the shot result card holds before the next shot. */
export const SHOT_DONE_TICKS = 100;
/** Ticks before a level/run card accepts `advance` (and before the demo bot presses it). */
export const CARD_MIN_TICKS = 60;

export interface SessionEvents {
	/** A new level's Site exists (before settling). */
	onLevel?(site: Site, levelIndex: number, seed: number): void;
	onFire?(shot: Shot, ballSlot: number): void;
	onShotDone?(r: ShotResult, isBest: boolean): void;
}

/**
 * A run: every level in order, each with its shot budget. Deterministic for a given seed and
 * input sequence. The presentation reads it; only `step` changes it.
 */
export class Session {
	readonly seed: number;
	readonly levels: readonly LevelDef[];
	phase: Phase = PHASE.SETTLING;
	levelIndex = 0;
	site: Site;
	/** Ticks spent in the current phase. */
	phaseTicks = 0;
	shotIndex = 0;
	/** Knocked mass at the start of the current shot. */
	private shotStartKg = 0;
	private currentShot: Shot | null = null;
	readonly results: ShotResult[] = [];
	/** Per level: total knocked kg and the 100% mark. */
	readonly levelKg: number[] = [];
	readonly levelMax: number[] = [];
	best: ShotResult | null = null;
	/** Shots of the current level so far (the replay log). */
	readonly levelShots: Shot[] = [];
	readonly events: SessionEvents;
	private readonly src: WorldSource;
	/** Total ticks stepped (all levels). */
	ticks = 0;

	constructor(
		src: WorldSource,
		seed: number,
		events: SessionEvents = {},
		levels: readonly LevelDef[] = LEVELS,
		startLevel = 0,
	) {
		this.src = src;
		this.seed = seed;
		this.events = events;
		this.levels = levels;
		this.levelIndex = startLevel;
		this.site = this.makeSite();
	}

	get level(): LevelDef {
		return this.levels[this.levelIndex] as LevelDef;
	}

	levelSeed(i = this.levelIndex): number {
		return (this.seed * 7919 + i * 104729) >>> 0;
	}

	private makeSite(): Site {
		const s = new Site(this.src, this.level, this.levelSeed());
		this.levelShots.length = 0;
		this.events.onLevel?.(s, this.levelIndex, this.levelSeed());
		return s;
	}

	get shotsLeft(): number {
		return (
			this.level.shots - this.shotIndex - (this.phase === PHASE.SHOT ? 1 : 0)
		);
	}

	/** Knocked fraction of the current level's above-line mass. */
	get fraction(): number {
		return this.site.knockedMass() / this.site.aboveMass;
	}

	get totalKg(): number {
		let s = 0;
		for (const v of this.levelKg) s += v ?? 0;
		if (this.phase !== PHASE.LEVEL_DONE && this.phase !== PHASE.RUN_DONE)
			s += this.site.knockedMass();
		return s;
	}

	private enter(p: Phase): void {
		this.phase = p;
		this.phaseTicks = 0;
	}

	step(input: TickInput): void {
		this.ticks++;
		this.phaseTicks++;
		const site = this.site;
		switch (this.phase) {
			case PHASE.SETTLING: {
				site.step();
				if (
					(this.phaseTicks % 10 === 0 && site.awakeBlocks() === 0) ||
					this.phaseTicks >= SETTLE_MAX_TICKS
				)
					this.enter(PHASE.AIM);
				return;
			}
			case PHASE.AIM: {
				if (input.fire) {
					const shot: Shot = {
						tick: site.tick,
						vx: Math.fround(input.vx),
						vy: Math.fround(input.vy),
						vz: Math.fround(input.vz),
					};
					this.shotStartKg = site.knockedMass();
					this.currentShot = shot;
					this.levelShots.push(shot);
					const slot = site.fire(shot);
					this.enter(PHASE.SHOT);
					this.events.onFire?.(shot, slot);
				}
				site.step();
				return;
			}
			case PHASE.SHOT: {
				site.step();
				const t = this.phaseTicks;
				const done =
					t >= SHOT_MAX_TICKS ||
					(t >= SHOT_MIN_TICKS &&
						t % 10 === 0 &&
						site.awakeBlocks() <= SHOT_SETTLED_AWAKE);
				if (done) this.finishShot();
				return;
			}
			case PHASE.SHOT_DONE: {
				site.step();
				if (this.phaseTicks >= SHOT_DONE_TICKS) {
					const cleared = this.fraction >= 0.999;
					if (this.shotIndex >= this.level.shots || cleared) this.finishLevel();
					else this.enter(PHASE.AIM);
				}
				return;
			}
			case PHASE.LEVEL_DONE: {
				site.step();
				if (input.advance && this.phaseTicks >= CARD_MIN_TICKS) {
					this.levelIndex++;
					this.site.free();
					this.site = this.makeSite();
					this.shotIndex = 0;
					this.enter(PHASE.SETTLING);
				}
				return;
			}
			case PHASE.RUN_DONE:
				site.step();
				return;
		}
	}

	private finishShot(): void {
		const site = this.site;
		const shot = this.currentShot as Shot;
		const r: ShotResult = {
			level: this.levelIndex,
			index: this.shotIndex,
			shot,
			kg: site.knockedMass() - this.shotStartKg,
			endTick: site.tick,
			endHash: site.hash(),
		};
		this.results.push(r);
		const isBest = this.best === null || r.kg > this.best.kg;
		if (isBest) this.best = r;
		this.shotIndex++;
		this.currentShot = null;
		this.enter(PHASE.SHOT_DONE);
		this.events.onShotDone?.(r, isBest);
	}

	private finishLevel(): void {
		this.levelKg[this.levelIndex] = this.site.knockedMass();
		this.levelMax[this.levelIndex] = this.site.aboveMass;
		this.enter(
			this.levelIndex + 1 >= this.levels.length
				? PHASE.RUN_DONE
				: PHASE.LEVEL_DONE,
		);
	}

	/** Stars for a level fraction: par, 0.6, 0.85. */
	static stars(level: LevelDef, fraction: number): number {
		if (fraction >= 0.85) return 3;
		if (fraction >= 0.6) return 2;
		if (fraction >= level.par) return 1;
		return 0;
	}

	hash(): string {
		return this.site.hash();
	}
}
