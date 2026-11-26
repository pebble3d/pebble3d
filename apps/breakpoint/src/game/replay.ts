import type { LevelDef } from "./levels.ts";
import type { ShotResult } from "./session.ts";
import { type Shot, Site, type WorldSource } from "./site.ts";

/**
 * Keeps a re-simulated copy of the run ready for an instant replay of the best shot.
 *
 * Replays are re-simulation, not recordings: a second Site is rebuilt from the level seed and
 * fed the same shots at the same world ticks, so it reproduces the original bit for bit.
 *
 * - `shadow` follows the current level's shot log in the background (`pump`, spending idle
 *   frame time), parking at the fire tick of the latest shot.
 * - When a shot ends as the new best, the shadow parked at that shot's fire tick becomes the
 *   `parked` replay world and a fresh shadow starts over for the rest of the level.
 * - `startReplay` hands out the parked Site (catching it up first if the player outpaced the
 *   background work) and the replay plays forward from there to the recorded end hash.
 */
export class ReplayKeeper {
	private readonly src: WorldSource;
	private level: LevelDef | null = null;
	private levelSeed = 0;
	private levelIndex = -1;
	/** The current level's shots, in order. */
	private shots: Shot[] = [];
	/** Shots of this level whose outcome is known. */
	private decided = 0;
	private shadow: Site | null = null;
	/** Next shot index the shadow will fire. */
	private shadowNext = 0;
	/** Replay world for `best`, parked at (or still catching up to) its fire tick. */
	private parked: Site | null = null;
	private parkedShots: Shot[] = [];
	private parkedNext = 0;
	best: ShotResult | null = null;

	constructor(src: WorldSource) {
		this.src = src;
	}

	beginLevel(level: LevelDef, seed: number, index: number): void {
		this.shadow?.free();
		this.level = level;
		this.levelSeed = seed;
		this.levelIndex = index;
		this.shots = [];
		this.decided = 0;
		this.shadow = null; // built lazily in pump (spawning costs a few ms)
		this.shadowNext = 0;
	}

	noteShot(shot: Shot): void {
		this.shots.push(shot);
	}

	/** A shot ended. If it is the new best, the shadow parked at its fire tick is kept. */
	onShotDone(r: ShotResult, isBest: boolean): void {
		this.decided = r.index + 1;
		if (!isBest || !this.level) return;
		this.best = r;
		this.parked?.free();
		this.parked = this.shadow ?? new Site(this.src, this.level, this.levelSeed);
		this.parkedShots = this.shots.slice(0, r.index + 1);
		this.parkedNext = this.shadow ? this.shadowNext : 0;
		this.shadow = null;
		this.shadowNext = 0;
	}

	/** Whether the parked replay is at its fire tick and can start this frame. */
	get ready(): boolean {
		const b = this.best;
		const p = this.parked;
		return !!b && !!p && p.tick === b.shot.tick && this.parkedNext === b.index;
	}

	/** Fraction of the catch-up done for the parked replay (1 when ready). */
	get progress(): number {
		const b = this.best;
		const p = this.parked;
		if (!b || !p) return 0;
		return Math.min(1, p.tick / Math.max(1, b.shot.tick));
	}

	/**
	 * Spends up to `budgetMs` advancing the parked replay (first) and the shadow. The shadow
	 * runs up to `mainTick` while every fired shot is decided, and parks at the fire tick of a
	 * shot still in flight. `now` is a clock in ms (performance.now in the browser).
	 */
	pump(budgetMs: number, now: () => number, mainTick: number): void {
		const t0 = now();
		const deadline = t0 + budgetMs;
		if (this.parked && this.best && !this.ready) {
			const b = this.best;
			this.parkedNext = advance(
				this.parked,
				this.parkedShots,
				this.parkedNext,
				b.index,
				b.shot.tick,
				deadline,
				now,
			);
		}
		if (!this.level || now() >= deadline) return;
		if (!this.shadow) {
			if (this.decided >= this.level.shots) return; // nothing left to park for
			this.shadow = new Site(this.src, this.level, this.levelSeed);
			this.shadowNext = 0;
		}
		const pending = this.shots.length > this.decided;
		const stop = pending ? (this.shots[this.decided] as Shot).tick : mainTick;
		const limit = pending ? this.decided : this.shots.length;
		this.shadowNext = advance(
			this.shadow,
			this.shots,
			this.shadowNext,
			limit,
			stop,
			deadline,
			now,
		);
	}

	/** Blocks until the parked replay is ready (tests, captures). */
	finish(): void {
		const b = this.best;
		if (!this.parked || !b || this.ready) return;
		this.parkedNext = advance(
			this.parked,
			this.parkedShots,
			this.parkedNext,
			b.index,
			b.shot.tick,
			Infinity,
			() => 0,
		);
	}

	/** Hands out the parked replay world (the caller frees it) and forgets it. */
	take(): {
		site: Site;
		shot: Shot;
		result: ShotResult;
		levelIndex: number;
	} | null {
		if (!this.ready || !this.parked || !this.best) return null;
		const out = {
			site: this.parked,
			shot: this.parkedShots[this.best.index] as Shot,
			result: this.best,
			levelIndex: this.best.level,
		};
		this.parked = null;
		return out;
	}

	/** Rebuilds the replay world for `best` from scratch (after a replay consumed it). */
	rearm(level: LevelDef, seed: number, shots: Shot[]): void {
		if (!this.best) return;
		this.parked?.free();
		this.parked = new Site(this.src, level, seed);
		this.parkedShots = shots.slice(0, this.best.index + 1);
		this.parkedNext = 0;
	}

	get currentLevelIndex(): number {
		return this.levelIndex;
	}

	get bestShots(): Shot[] {
		return this.parkedShots;
	}

	dispose(): void {
		this.shadow?.free();
		this.parked?.free();
		this.shadow = null;
		this.parked = null;
	}
}

/**
 * Steps `site` to world tick `stop`, firing `shots[i]` (i < `limit`) at their ticks, or until
 * the deadline passes. Returns the next shot index to fire.
 */
function advance(
	site: Site,
	shots: Shot[],
	next: number,
	limit: number,
	stop: number,
	deadline: number,
	now: () => number,
): number {
	let i = next;
	let n = 0;
	while (site.tick < stop) {
		const s = shots[i];
		if (s && i < limit && s.tick === site.tick) {
			site.fire(s);
			i++;
		}
		site.step();
		if (++n % 4 === 0 && now() >= deadline) break;
	}
	return i;
}
