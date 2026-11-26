import { FOCUS_MAX } from "./constants.ts";
import { BTN, type TickInput } from "./input.ts";
import { PHASE } from "./phase.ts";
import type { GameSim } from "./sim.ts";

type Step = [t: number, btn: number, hold: number];
interface Act {
	name: string;
	steps: Step[];
	length: number;
	/** Fill Focus first (Spin Storm). */
	focus?: boolean;
}

/** Every move in the kit, performed in place one after another. */
export const LAB_ACTS: Act[] = [
	{
		name: "Light x3",
		steps: [
			[0, BTN.LIGHT, 2],
			[10, BTN.LIGHT, 2],
			[20, BTN.LIGHT, 2],
		],
		length: 80,
	},
	{
		name: "Launcher (L, L, H)",
		steps: [
			[0, BTN.LIGHT, 2],
			[10, BTN.LIGHT, 2],
			[20, BTN.HEAVY, 2],
		],
		length: 80,
	},
	{ name: "Heavy", steps: [[0, BTN.HEAVY, 2]], length: 60 },
	{ name: "Charged heavy", steps: [[0, BTN.HEAVY, 42]], length: 100 },
	{
		name: "Dodge, dash-slash",
		steps: [
			[0, BTN.DODGE, 2],
			[7, BTN.LIGHT, 2],
		],
		length: 60,
	},
	{
		name: "Jump, plunge",
		steps: [
			[0, BTN.JUMP, 2],
			[14, BTN.HEAVY, 2],
		],
		length: 70,
	},
	{ name: "Spin Storm", steps: [[0, BTN.FOCUS, 16]], length: 150, focus: true },
];

/**
 * `?lab=1`: a move showcase / tuning harness. The run idles in an endless pre-wave (no
 * enemies) while the player performs every move in place facing +X. It writes Focus
 * directly before Spin Storm (a debug cheat; never used in play or the demo).
 */
export class MoveLab {
	private act = 0;
	private t = -30;
	current = "";

	constructor(private readonly sim: GameSim) {}

	next(out: TickInput): void {
		const s = this.sim;
		out.mx = 0;
		out.mz = 0;
		out.buttons = 0;
		if (s.phase === PHASE.TITLE) {
			if ((s.tick & 1) === 0) out.buttons = BTN.START;
			return;
		}
		// hold position facing +X
		s.player.facing = Math.PI / 2;
		const a = LAB_ACTS[this.act] as (typeof LAB_ACTS)[number];
		this.current = a.name;
		if (this.t === -1 && a.focus) s.player.focus = FOCUS_MAX;
		if (this.t === -20 && s.combo.move < 0 && s.player.grounded) {
			// back to the mark between moves (dashes travel)
			s.player.x = s.player.px = s.arena.playerStart[0];
			s.player.z = s.player.pz = s.arena.playerStart[1];
		}
		for (const [at, btn, hold] of a.steps)
			if (this.t >= at && this.t < at + hold) out.buttons |= btn;
		// dodges need a stick direction: forward
		if (out.buttons & BTN.DODGE) out.mx = 1;
		this.t++;
		if (this.t >= a.length) {
			this.t = -20;
			this.act = (this.act + 1) % LAB_ACTS.length;
		}
	}
}
