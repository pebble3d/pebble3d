import { BUILD_TICKS, CELLS } from "./constants.ts";
import { TOWER, TOWERS } from "./defs.ts";
import { CMD, type TickInput } from "./input.ts";
import { cellCenter } from "./path.ts";
import { emptyPick, PHASE, PICK, type SiegeSim } from "./sim.ts";

const S = TOWER.SPARK;
const M = TOWER.MORTAR;
const F = TOWER.FROST;
const L = TOWER.LANCE;
/** Build order; after it runs out the bot upgrades and keeps adding lances and mortars. */
const ORDER = [
	S,
	S,
	F,
	S,
	M,
	S,
	L,
	M,
	F,
	L,
	S,
	M,
	L,
	F,
	M,
	L,
	S,
	M,
	L,
	F,
	L,
	M,
	L,
	M,
];
/** The bot's "camera" for its picking rays, like the player's default view. */
const EYE = [0, 62, 58] as const;

/**
 * `?demo=1` autoplayer. Chooses cells by path coverage, confirms them with the same raycast
 * pick a mouse click uses, and emits the TickInput commands a player would. Deterministic:
 * reads only sim state.
 */
export class DemoBot {
	current = "title";
	private wait = 0;
	private phase = -1;
	private next = 0;
	private readonly score: Float32Array[];
	/** Untouched copy: occluded cells are zeroed during a run and restored for the next. */
	private readonly pristine: Float32Array[];
	private readonly pick = emptyPick();
	private readonly sim: SiegeSim;

	constructor(sim: SiegeSim) {
		this.sim = sim;
		// Coverage per tower type and cell: path samples (both routes) within level-1 range.
		this.score = TOWERS.map((def) => {
			const out = new Float32Array(CELLS * CELLS);
			const r2 = (def.range[0] as number) ** 2;
			for (let c = 0; c < out.length; c++) {
				if (sim.mask[c] !== 1) continue;
				const [x, z] = cellCenter(c);
				let n = 0;
				for (const p of sim.paths)
					for (let i = 0; i < p.n; i += 2) {
						const d =
							((p.x[i] as number) - x) ** 2 + ((p.z[i] as number) - z) ** 2;
						if (d <= r2) n++;
					}
				out[c] = n;
			}
			return out;
		});
		this.pristine = this.score.map((a) => a.slice());
	}

	nextInput(out: TickInput): void {
		const sim = this.sim;
		out.cmd = CMD.NONE;
		out.a = 0;
		out.b = 0;
		const ph = sim.phase;
		if (ph !== this.phase) {
			// Count from when each phase began (the result screen holds for 7 s).
			this.phase = ph;
			if (ph === PHASE.WON || ph === PHASE.LOST || ph === PHASE.TITLE)
				this.wait = 0;
		}
		this.wait++;
		if (ph === PHASE.TITLE) {
			this.current = "title";
			if (this.wait > 90) {
				out.cmd = CMD.START;
				this.restoreScores();
				this.wait = 0;
				this.next = 0;
			}
			return;
		}
		if (ph === PHASE.WON || ph === PHASE.LOST) {
			this.current = "result";
			if (this.wait > 420) {
				out.cmd = CMD.RESTART;
				this.restoreScores();
				this.wait = 0;
				this.next = 0;
			}
			return;
		}
		if (this.wait % 12 !== 0) return;
		// Build in order while affordable.
		if (this.next < ORDER.length) {
			const type = ORDER[this.next] as number;
			if (sim.gold >= (TOWERS[type]?.cost ?? 1e9)) {
				const cell = this.bestCell(type);
				if (cell >= 0 && this.confirm(cell)) {
					out.cmd = CMD.PLACE;
					out.a = type;
					out.b = cell;
					this.next++;
					this.current = `place ${TOWERS[type]?.name}`;
					return;
				}
				if (cell < 0) this.next++;
				else (this.score[type] as Float32Array)[cell] = 0; // occluded from the eye: skip it
			}
		} else {
			// Upgrades: the cheapest available, keeping a small reserve.
			let best = -1;
			let bestCost = 1e9;
			for (let t = 0; t < sim.ttype.length; t++) {
				const c = sim.upgradeCost(t);
				if (c > 0 && c < bestCost) {
					best = t;
					bestCost = c;
				}
			}
			if (best >= 0 && sim.gold >= bestCost + 20) {
				out.cmd = CMD.UPGRADE;
				out.a = best;
				this.current = "upgrade";
				return;
			}
		}
		// Mid-game: upgrades between new towers once a few are standing.
		if (this.next >= 6 && sim.gold > 260) {
			for (let t = 0; t < sim.ttype.length; t++) {
				const c = sim.upgradeCost(t);
				if (c > 0 && sim.gold >= c + 150) {
					out.cmd = CMD.UPGRADE;
					out.a = t;
					this.current = "upgrade";
					return;
				}
			}
		}
		// Call the next wave early once the build window has shown the board.
		if (ph === PHASE.BUILD && sim.timer < BUILD_TICKS - 300 && this.next >= 3) {
			out.cmd = CMD.CALL_WAVE;
			this.current = "call wave";
		}
	}

	private restoreScores(): void {
		for (let t = 0; t < this.score.length; t++)
			(this.score[t] as Float32Array).set(this.pristine[t] as Float32Array);
	}

	/** Best-covering free cell for `type`, at least 4 m from other towers. */
	private bestCell(type: number): number {
		const sim = this.sim;
		const sc = this.score[type] as Float32Array;
		let best = -1;
		let bestV = 0;
		for (let c = 0; c < sc.length; c++) {
			const v = sc[c] as number;
			if (v <= bestV || (sim.occupied[c] as number) >= 0) continue;
			const [x, z] = cellCenter(c);
			let near = false;
			for (let t = 0; t < sim.ttype.length; t++)
				if (
					(sim.ttype[t] as number) >= 0 &&
					Math.abs((sim.tx[t] as number) - x) < 3.9 &&
					Math.abs((sim.tz[t] as number) - z) < 3.9
				)
					near = true;
			if (near) continue;
			best = c;
			bestV = v;
		}
		return best;
	}

	/** Casts the same camera ray a click would and checks it lands on a buildable `cell`. */
	private confirm(cell: number): boolean {
		const [x, z] = cellCenter(cell);
		const p = this.sim.pick(
			EYE[0],
			EYE[1],
			EYE[2],
			x - EYE[0],
			-EYE[1],
			z - EYE[2],
			this.pick,
		);
		return p.kind === PICK.CELL && p.cell === cell && p.buildable;
	}
}
