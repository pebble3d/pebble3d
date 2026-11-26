import { COUNTDOWN_TICKS, TUNE } from "./constants.ts";
import { quantize, type TickInput } from "./input.ts";
import { type DroneSim, PHASE } from "./sim.ts";
import type { Gate } from "./track.ts";

export interface BotTune {
	/** Cruise speed (m/s) and the speed it carries through a gate. */
	vmax: number;
	vgate: number;
	/** Velocity loop gain (1/s). */
	gain: number;
	/** How far behind the gate (as a fraction of the distance to it) it aims, to line up. */
	lineUp: number;
	/** Optional per-lap speed multipliers (the demo improves lap by lap, so it races its ghost). */
	pace?: number[];
}

export const DEFAULT_BOT: BotTune = {
	vmax: 7.2,
	vgate: 5.2,
	gain: 2.4,
	lineUp: 0.42,
};
/** The `?demo=1` pilot: a cautious first lap, then faster ones that beat it. */
export const DEMO_BOT: BotTune = { ...DEFAULT_BOT, pace: [0.8, 0.92, 1.0] };

function clamp1(v: number): number {
	return v > 1 ? 1 : Math.max(v, -1);
}

/**
 * The `?demo=1` pilot. Flies assisted mode through the same TickInput a player produces: it
 * aims at a point on the next gate's axis (behind the gate in proportion to its distance, so it
 * lines up), asks for a velocity toward it, and turns the velocity error into stick tilt.
 * Reads only sim state; no randomness, so its laps replay exactly.
 */
export class DroneBot {
	current = "idle";
	private readonly sim: DroneSim;
	private readonly tune: BotTune;
	constructor(sim: DroneSim, tune: BotTune = DEFAULT_BOT) {
		this.sim = sim;
		this.tune = tune;
	}

	next(out: TickInput): TickInput {
		const s = this.sim;
		out.throttle = 0;
		out.yaw = 0;
		out.pitch = 0;
		out.roll = 0;
		if (s.phase === PHASE.COUNTDOWN && s.tick < COUNTDOWN_TICKS - 1) {
			this.current = "countdown";
			return out;
		}
		if (s.phase === PHASE.FINISHED || s.freeze > 0) {
			this.current = s.freeze > 0 ? "crashed" : "done";
			return out;
		}
		const g = s.gates[s.nextGate] as Gate;
		const after = s.gates[(s.nextGate + 1) % s.gates.length] as Gate;
		const p = s.pos;
		const px = p[0] as number;
		const py = p[1] as number;
		const pz = p[2] as number;
		const before = -((px - g.cx) * g.nx + (pz - g.cz) * g.nz); // distance before the plane
		const back = Math.max(0, Math.min(3, before * this.tune.lineUp));
		let tx = g.cx - g.nx * back;
		let ty = g.cy;
		let tz = g.cz - g.nz * back;
		// close to the gate: start bending toward the one after it
		if (before < 1.2) {
			const k = Math.max(0, 1.2 - before) * 0.25;
			tx += (after.cx - g.cx) * k * 0.3;
			tz += (after.cz - g.cz) * k * 0.3;
			ty += (after.cy - g.cy) * k * 0.15;
		}
		let dx = tx - px;
		let dz = tz - pz;
		const dist = Math.sqrt(dx * dx + dz * dz);
		if (dist > 1e-3) {
			dx /= dist;
			dz /= dist;
		}
		// slow for the turn after the gate: carry vgate through it, cruise between gates
		const turn = g.nx * after.nx + g.nz * after.nz; // 1 = straight on
		const pace = this.tune.pace?.[Math.max(0, s.lap)] ?? 1;
		const vg = this.tune.vgate * pace * (0.75 + 0.25 * Math.max(0, turn));
		const vWant = Math.min(
			this.tune.vmax * pace,
			Math.sqrt(vg * vg + 2 * 4.5 * Math.max(0, before - 0.5)),
		);
		const v = s.vel;
		const ax = (dx * vWant - (v[0] as number)) * this.tune.gain;
		const az = (dz * vWant - (v[2] as number)) * this.tune.gain;
		// acceleration to stick: tilt = a / g, in the heading frame
		const hfx = s.hfx;
		const hfz = s.hfz;
		const k = 1 / (9.81 * TUNE.assistTilt);
		out.pitch = quantize(clamp1((ax * hfx + az * hfz) * k));
		out.roll = quantize(clamp1((ax * -hfz + az * hfx) * k));
		// height: climb-rate command toward the aim height, leading a little with speed
		const vy = v[1] as number;
		out.throttle = quantize(
			clamp1(((ty - py) * 1.8 - vy * 0.15) / TUNE.climbRate),
		);
		// yaw toward the travel direction (the camera looks where it flies)
		const side = dx * -hfz + dz * hfx;
		const ahead = dx * hfx + dz * hfz;
		out.yaw = quantize(ahead < 0 ? (side >= 0 ? 1 : -1) : clamp1(side * 2.2));
		this.current = `gate ${g.index}`;
		return out;
	}
}
