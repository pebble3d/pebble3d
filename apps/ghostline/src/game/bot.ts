import { COUNTDOWN_TICKS, DT, TRACK_DS } from "./constants.ts";
import { BTN, quantize, type TickInput } from "./input.ts";
import { type MarbleSim, PHASE } from "./sim.ts";

/** Per-course bot tuning (from the course JSON's optional `bot` block). */
export interface BotTune {
	/** Lateral grip estimate (m/s^2) used for the corner speed limit. */
	grip: number;
	/** Cap on target speed (m/s). */
	vmax: number;
	/** Look-ahead: base samples + samples per m/s. */
	look: number;
	lookPerSpeed: number;
}

export const DEFAULT_BOT: BotTune = {
	grip: 14,
	vmax: 40,
	look: 10,
	lookPerSpeed: 0.7,
};

/**
 * The demo autoplayer (`?demo=1`) and the par-ghost driver. A pure function of the sim state,
 * so a bot run is as reproducible as a human one: it only ever produces a TickInput, which is
 * logged like any other.
 */
export class Bot {
	private readonly sim: MarbleSim;
	private readonly tune: BotTune;
	/** Which side of a sweeper post to pass (+1 right, -1 left, 0 none). */
	private side = 0;
	constructor(sim: MarbleSim, tune: BotTune = DEFAULT_BOT) {
		this.sim = sim;
		this.tune = tune;
	}

	next(out: TickInput): TickInput {
		const s = this.sim;
		out.x = 0;
		out.z = 0;
		out.buttons = 0;
		if (s.phase !== PHASE.RUN || s.freeze > 0) return out;
		const t = s.track;
		const i = s.progress;
		const v = s.vel;
		const vx = v[0] as number;
		const vz = v[2] as number;
		const speed = Math.sqrt(vx * vx + vz * vz);
		const look = Math.min(
			t.n - 1,
			i + Math.round(this.tune.look + speed * this.tune.lookPerSpeed),
		);
		// corner speed limit from the heading change over the next ~25 m
		const far = Math.min(t.n - 1, i + 50);
		let maxTurn = 0;
		const h0 = Math.atan2(t.tx[i] as number, t.tz[i] as number);
		for (let k = i + 5; k <= far; k += 5) {
			let d = Math.atan2(t.tx[k] as number, t.tz[k] as number) - h0;
			while (d > Math.PI) d -= 2 * Math.PI;
			while (d < -Math.PI) d += 2 * Math.PI;
			const curv = Math.abs(d) / Math.max(1, (k - i) * 0.5);
			if (curv > maxTurn) maxTurn = curv;
		}
		const vSafe =
			maxTurn > 1e-4 ? Math.sqrt(this.tune.grip / maxTurn) : this.tune.vmax;
		let vTarget = Math.min(this.tune.vmax, vSafe);
		// sweepers: pass beside the post, and time the gap between the arms
		let lane = 0;
		const now = (s.tick - COUNTDOWN_TICKS) * DT;
		for (const sw of s.sweepers) {
			const ahead = (sw.sample - i) * TRACK_DS;
			if (ahead < -3 || ahead > 26) continue;
			if (this.side === 0) this.side = s.lateral >= 0 ? 1 : -1;
			lane = this.side * 1.95;
			if (ahead > 1.5) {
				const eta = ahead / Math.max(speed, 4);
				for (let k = -2; k <= 2; k++) {
					const a = sw.phase + sw.speed * (now + eta + k * 0.08);
					if (Math.abs(Math.sin(a)) < 0.45) vTarget = Math.min(vTarget, 3);
				}
			}
		}
		if (lane === 0) this.side = 0;
		// aim at the line ahead (the centreline, or a lane beside a sweeper post)
		let dx =
			(t.px[look] as number) +
			(t.rx[look] as number) * lane -
			(s.pos[0] as number);
		let dz =
			(t.pz[look] as number) +
			(t.rz[look] as number) * lane -
			(s.pos[2] as number);
		const dl = Math.sqrt(dx * dx + dz * dz) || 1;
		dx /= dl;
		dz /= dl;
		// velocity controller: desired horizontal velocity minus actual
		let cx = dx * vTarget - vx;
		let cz = dz * vTarget - vz;
		// do not brake hard on the ground through the tilt alone; lateral matters most
		const cl = Math.sqrt(cx * cx + cz * cz);
		const gain = 0.35;
		if (cl > 1e-6) {
			const m = Math.min(1, cl * gain);
			cx = (cx / cl) * m;
			cz = (cz / cl) * m;
		}
		out.x = quantize(cx);
		out.z = quantize(cz);
		if (speed > vTarget + 4 && s.grounded) out.buttons |= BTN.BRAKE;
		return out;
	}
}
