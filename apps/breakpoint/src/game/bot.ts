import { aimVelocity } from "./aim.ts";
import { SPEED_MAX, SPEED_MIN } from "./constants.ts";
import { PHASE, type Session, type TickInput } from "./session.ts";

/** Ticks the bot spends sweeping its reticle onto the target, then charging. */
export const BOT_AIM_TICKS = 70;
export const BOT_CHARGE_TICKS = 50;
/** Ticks the bot reads a level card before continuing. */
export const BOT_CARD_TICKS = 200;

/**
 * Demo autoplayer: per level it takes the level's scripted targets and speeds, sweeps the
 * reticle onto each, charges and fires. Deterministic (no randomness, tick-driven).
 */
export class DemoBot {
	private readonly s: Session;
	/** Presentation: where the reticle is and how charged the shot is (0..1). */
	readonly reticle: [number, number, number] = [0, 0, 0];
	charge = 0;
	aiming = false;
	private readonly v: [number, number, number] = [0, 0, 0];

	constructor(s: Session) {
		this.s = s;
	}

	next(out: TickInput): void {
		out.fire = false;
		out.advance = false;
		const s = this.s;
		this.aiming = false;
		if (s.phase === PHASE.AIM) {
			const lv = s.level;
			const target = lv.botTargets[s.shotIndex] ??
				lv.botTargets[0] ?? [0, 2, 0];
			const speed = lv.botSpeeds[s.shotIndex] ?? 46;
			const t = s.phaseTicks;
			// Sweep from the structure's centre line onto the target.
			const k = Math.min(1, t / BOT_AIM_TICKS);
			const e = k * k * (3 - 2 * k);
			this.reticle[0] = target[0] * e;
			this.reticle[1] = 3 + (target[1] - 3) * e;
			this.reticle[2] = target[2];
			this.charge = Math.min(
				1,
				Math.max(0, (t - BOT_AIM_TICKS) / BOT_CHARGE_TICKS) *
					((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)),
			);
			this.aiming = true;
			if (t >= BOT_AIM_TICKS + BOT_CHARGE_TICKS) {
				aimVelocity(lv.launcher, target, speed, this.v);
				out.fire = true;
				out.vx = this.v[0];
				out.vy = this.v[1];
				out.vz = this.v[2];
				this.charge = 0;
			}
		} else if (s.phase === PHASE.LEVEL_DONE && s.phaseTicks >= BOT_CARD_TICKS) {
			out.advance = true;
		}
	}
}
