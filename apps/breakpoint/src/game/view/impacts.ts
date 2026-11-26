import type { SiteView } from "../host.ts";

const STRIDE = 8;
const SLEEPING = 2;
/** m/s of sudden speed loss that counts as a hit. */
const HIT_DV = 2.6;
const MAX_PER_TICK = 10;

export interface ImpactSink {
	/** A block (or ball, `ball` true) lost `dv` m/s at (x, y, z). `kg` is its mass. */
	impact(
		x: number,
		y: number,
		z: number,
		dv: number,
		kg: number,
		ball: boolean,
	): void;
}

/**
 * Finds collisions from the state buffers alone: a body whose speed drops sharply between two
 * ticks just hit something. Runs once per sim tick over the awake bodies; no allocation.
 */
export class ImpactWatch {
	private speed = new Float32Array(0);
	private ballSpeed = new Float32Array(8);
	private site: SiteView | null = null;

	bind(site: SiteView): void {
		this.site = site;
		this.speed = new Float32Array(site.n);
		this.ballSpeed.fill(0);
	}

	/** Call after each sim tick. Returns the number of block hits found. */
	scan(sink: ImpactSink): number {
		const s = this.site;
		if (!s) return 0;
		s.refresh();
		const prev = s.prev;
		const curr = s.curr;
		let found = 0;
		for (let b = 0; b < s.ballSlots.length; b++) {
			const o = (s.ballSlots[b] as number) * STRIDE;
			const v = speedAt(prev, curr, o);
			const dv = (this.ballSpeed[b] as number) - v;
			if (dv > 4)
				sink.impact(
					curr[o] as number,
					curr[o + 1] as number,
					curr[o + 2] as number,
					dv,
					2600,
					true,
				);
			this.ballSpeed[b] = v;
		}
		for (let i = 0; i < s.n; i++) {
			const o = (s.slots[i] as number) * STRIDE;
			if (((curr[o + 7] as number) & SLEEPING) !== 0) {
				this.speed[i] = 0;
				continue;
			}
			const v = speedAt(prev, curr, o);
			const dv = (this.speed[i] as number) - v;
			this.speed[i] = v;
			if (dv > HIT_DV && found < MAX_PER_TICK) {
				found++;
				sink.impact(
					curr[o] as number,
					curr[o + 1] as number,
					curr[o + 2] as number,
					dv,
					s.mass[i] as number,
					false,
				);
			}
		}
		return found;
	}

	/** Sum of block speeds (m/s): a cheap "how much is moving" for audio and camera. */
	motion(): number {
		let m = 0;
		const sp = this.speed;
		for (let i = 0; i < sp.length; i++) m += sp[i] as number;
		return m;
	}
}

function speedAt(prev: Float32Array, curr: Float32Array, o: number): number {
	const dx = (curr[o] as number) - (prev[o] as number);
	const dy = (curr[o + 1] as number) - (prev[o + 1] as number);
	const dz = (curr[o + 2] as number) - (prev[o + 2] as number);
	return Math.sqrt(dx * dx + dy * dy + dz * dz) * 60;
}
