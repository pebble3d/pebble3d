import { arenaRadius, ringDropTick } from "./arena.ts";
import { COLLAPSE, MAX_PLAYERS } from "./constants.ts";
import { BTN, type PlayerInput, setStick } from "./input.ts";
import { Rng } from "./rng.ts";
import { PHASE, type RoundSim } from "./sim.ts";

export interface BotTune {
	/** Dash when an opponent is within this many metres and lined up. */
	dashRange: number;
	/** How far inside the edge the bot feels safe (m). */
	margin: number;
	/** Ticks between decisions (reaction time). */
	think: number;
	/** Stick wobble (0..1). */
	wobble: number;
}

export const BOT_TUNES: BotTune[] = [
	{ dashRange: 3.2, margin: 1.5, think: 6, wobble: 0.15 },
	{ dashRange: 3.8, margin: 1.2, think: 4, wobble: 0.1 },
	{ dashRange: 2.8, margin: 1.8, think: 8, wobble: 0.22 },
	{ dashRange: 3.5, margin: 1.4, think: 5, wobble: 0.12 },
];

/**
 * A sumo bot: hunts the nearest rival, circles to the centre side of it (so a shove sends
 * the rival outward), dashes when lined up, and backs off the edge. It reads only the sim,
 * so it is deterministic; its output is logged like a human's, so replays never re-run it.
 */
export class Bot {
	private readonly rng: Rng;
	private readonly tune: BotTune;
	private sx = 0;
	private sz = 0;
	private dash = false;
	private wait = 0;

	constructor(
		readonly slot: number,
		seed: number,
		tune: BotTune = BOT_TUNES[(slot + seed) % BOT_TUNES.length] as BotTune,
	) {
		this.rng = new Rng((seed ^ (0x9e37 * (slot + 1))) >>> 0);
		this.tune = tune;
	}

	next(sim: RoundSim, out: PlayerInput): void {
		out.buttons = 0;
		if (!sim.alive[this.slot] || sim.phase !== PHASE.FIGHT) {
			out.x = 0;
			out.z = 0;
			return;
		}
		if (this.wait > 0) {
			this.wait--;
		} else {
			this.wait = this.tune.think;
			this.decide(sim);
		}
		setStick(out, this.sx, this.sz);
		if (this.dash) {
			out.buttons |= BTN.DASH;
			this.dash = false;
		}
	}

	private decide(sim: RoundSim): void {
		const s = this.slot;
		const px = sim.pos[s * 3] as number;
		const pz = sim.pos[s * 3 + 2] as number;
		const vx = sim.vel[s * 3] as number;
		const vz = sim.vel[s * 3 + 2] as number;
		// the ring about to drop no longer counts as floor
		let rings = sim.standingRings();
		const nextDrop = ringDropTick(rings - 1);
		if (sim.fightTick >= nextDrop - COLLAPSE.warn) rings--;
		const safe = Math.max(0.6, arenaRadius(rings) * 0.9 - this.tune.margin);
		// nearest rival
		let best = -1;
		let bd = 1e9;
		for (let o = 0; o < MAX_PLAYERS; o++) {
			if (o === s || !sim.alive[o]) continue;
			const d = Math.hypot(
				(sim.pos[o * 3] as number) - px,
				(sim.pos[o * 3 + 2] as number) - pz,
			);
			if (d < bd) {
				bd = d;
				best = o;
			}
		}
		let tx = -px;
		let tz = -pz;
		if (best >= 0) {
			const ox = sim.pos[best * 3] as number;
			const oz = sim.pos[best * 3 + 2] as number;
			const ol = Math.hypot(ox, oz) || 1;
			// a point on the centre side of the rival
			const bx = ox - (ox / ol) * 1.6;
			const bz = oz - (oz / ol) * 1.6;
			const behind =
				ol >= Math.hypot(px, pz) - 0.4 ||
				(px - ox) * (ox / ol) + (pz - oz) * (oz / ol) < -0.5;
			if (behind || ol < 1.2) {
				tx = ox - px;
				tz = oz - pz;
				const aimed =
					(tx * vx + tz * vz) /
					((Math.hypot(tx, tz) || 1) * (Math.hypot(vx, vz) || 1));
				// commit to a dash only from the centre side, once the opening jostle settles
				const inside = ol > Math.hypot(px, pz) + 0.3;
				if (
					sim.fightTick > 100 &&
					(inside || bd < 1.9) &&
					bd < this.tune.dashRange &&
					(aimed > 0.6 || Math.hypot(vx, vz) < 1)
				)
					this.dash = true;
			} else {
				tx = bx - px;
				tz = bz - pz;
			}
		}
		const tl = Math.hypot(tx, tz) || 1;
		tx /= tl;
		tz /= tl;
		// edge fear: look ahead along the velocity, pull back toward the centre
		const lx = px + vx * 0.45;
		const lz = pz + vz * 0.45;
		const r = Math.hypot(lx, lz);
		if (r > safe) {
			const k = Math.min(1, (r - safe) / 1.2);
			tx = tx * (1 - k) - (lx / r) * k * 1.4;
			tz = tz * (1 - k) - (lz / r) * k * 1.4;
			if (k > 0.5) this.dash = false;
		}
		const wob = this.tune.wobble;
		tx += (this.rng.next() - 0.5) * wob;
		tz += (this.rng.next() - 0.5) * wob;
		this.sx = tx;
		this.sz = tz;
	}
}
