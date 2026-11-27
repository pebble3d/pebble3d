/**
 * The guided first roll: grip, advance, defend, breathe, then pass, mount and finish an
 * armbar. The partner never counters your attacks; in the defend step it attacks once with a
 * scissor sweep (retried until you read it). Steps advance on sim state, so the same
 * tutorial runs headless in tests with a scripted player.
 */

import { POS_INDEX } from "./graph.ts";
import { IN } from "./input.ts";
import { ACT, EV, type MatchSim, PHASE, TUNE } from "./sim.ts";
import { keycap } from "./ui/keycap.ts";

export interface TutStep {
	title: string;
	text: string;
	done(s: MatchSim, t: Tutorial): boolean;
	enter?(s: MatchSim): void;
}

export const TUT_STEPS: TutStep[] = [
	{
		title: "Grip up",
		text: `Hold ${keycap("J")} to build grips on the collar and sleeve. Every move needs grip; the white tick on the meter is what the move asks for.`,
		done: (s) => (s.grip[0] as number) >= 0.6,
	},
	{
		title: "Advance",
		text: `Press ${keycap("W")} for a double-leg. Then press ${keycap("J")} the moment the white ring closes on the gold circle.`,
		done: (s) => s.pos === POS_INDEX.closedGuard && s.top === 0,
	},
	{
		title: "Defend",
		text: `They will try a scissor sweep. Watch their knee slide across your belly, then press ${keycap("A")}: base out. Reading it before the name appears is strongest.`,
		done: (_s, t) => t.defended,
	},
	{
		title: "Breathe",
		text: `You are out of gas: grips build slowly and your moves telegraph longer. Hold ${keycap("K")} to breathe (it drops your grips).`,
		enter: (s) => {
			s.gas[0] = 0.12;
		},
		done: (s) => (s.gas[0] as number) >= 0.7,
	},
	{
		title: "Pass the guard",
		text: `Grip up with ${keycap("J")}, then ${keycap("D")}: stack pass, and ${keycap("J")} on the beat. A pass scores 3.`,
		done: (s) => s.pos === POS_INDEX.sideControl && s.top === 0,
	},
	{
		title: "Take the mount",
		text: `From side control, ${keycap("W")}: step to mount (4 points).`,
		done: (s) => s.pos === POS_INDEX.mount && s.top === 0,
	},
	{
		title: "Finish",
		text: `${keycap("W")}: armbar. Once it is locked, hold ${keycap("J")} to squeeze until they tap. Squeezing burns gas.`,
		done: (s) => s.phase === PHASE.OVER && s.winner === 0,
	},
];

export class Tutorial {
	step = 0;
	defended = false;
	complete = false;
	/** Seconds the current step has been complete (a short beat before the next card). */
	private hold = 0;
	private wantAttack = false;
	retries = 0;

	begin(s: MatchSim): void {
		this.step = 0;
		this.defended = false;
		this.complete = false;
		TUT_STEPS[0]?.enter?.(s);
	}

	/** Partner input for this tick (the tutorial's own script, never a counter). */
	partner(s: MatchSim): number {
		if (s.phase !== PHASE.LIVE) return 0;
		if (this.step !== 2 || this.defended) return s.isSub() ? 0 : 0;
		// defend step: grip, then launch the scissor sweep from the bottom
		if (s.act !== ACT.IDLE) return 0;
		if ((s.grip[1] as number) < 0.62) return IN.GRIP;
		if (!s.canLaunch(1)) return IN.GRIP;
		this.wantAttack = !this.wantAttack;
		return this.wantAttack ? IN.LEFT : 0;
	}

	/** Call after each sim step with that step's events. */
	afterStep(s: MatchSim): void {
		if (this.complete) return;
		for (let k = 0; k < s.evN; k++) {
			const ty = s.evType[k];
			if (this.step === 2 && ty === EV.STUFFED && s.evA[k] === 1)
				this.defended = true;
			if (this.step === 2 && ty === EV.SUCCESS && s.evA[k] === 1) {
				// the sweep landed: put them back in your guard and try again
				s.pos = POS_INDEX.closedGuard;
				s.top = 0;
				s.transTick = s.tick;
				s.settle = 50;
				this.retries++;
			}
		}
		// the tutorial never times out and never lets the partner's own grip matter later
		if (this.step !== 2) s.grip[1] = Math.min(s.grip[1] as number, 0.2);
	}

	/** The direction key each card teaches (others are masked off so a stray key cannot derail it). */
	private static readonly KEYS = [0, IN.UP, IN.LEFT, 0, IN.RIGHT, IN.UP, IN.UP];

	/** Filters the player's input byte for the current card. */
	mask(s: MatchSim, input: number): number {
		const dirs = IN.UP | IN.LEFT | IN.DOWN | IN.RIGHT;
		const st = TUT_STEPS[this.step];
		const allowed =
			st && !st.done(s, this) ? (Tutorial.KEYS[this.step] ?? 0) : 0;
		return (input & ~dirs) | (input & allowed);
	}

	/** Demo/test driver: follows each card the way a player would. */
	bot(s: MatchSim): number {
		if (s.phase !== PHASE.LIVE) return 0;
		const press = (bit: number): number => ((s.tick & 7) === 0 ? bit : 0);
		if (s.isSub()) return IN.GRIP;
		if (s.act !== ACT.IDLE) {
			if (s.actor === 0)
				return s.act === ACT.WINDOW && s.actT + 1 === TUNE.beat ? IN.GRIP : 0;
			if (s.act === ACT.TELEGRAPH && s.actT === 12) return IN.LEFT; // base out
			return 0;
		}
		const g = s.grip[0] as number;
		switch (this.step) {
			case 0:
			case 2:
				return IN.GRIP;
			case 1:
				return g > 0.5 ? press(IN.UP) : IN.GRIP;
			case 3:
				return IN.BREATHE;
			case 4:
				return g > 0.7 ? press(IN.RIGHT) : IN.GRIP;
			default:
				return g > 0.65 ? press(IN.UP) : IN.GRIP;
		}
	}

	/** Advances the card; returns true when the tutorial is over. */
	update(s: MatchSim, dt: number): boolean {
		const st = TUT_STEPS[this.step];
		if (!st) return true;
		if (st.done(s, this)) {
			this.hold += dt;
			if (this.hold > 0.9) {
				this.hold = 0;
				this.step++;
				const next = TUT_STEPS[this.step];
				if (!next) {
					this.complete = true;
					return true;
				}
				next.enter?.(s);
			}
		}
		return false;
	}
}
