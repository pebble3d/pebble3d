import { FOCUS_MAX } from "./constants.ts";
import { BTN, type TickInput } from "./input.ts";
import { PHASE } from "./phase.ts";
import { type GameSim, type Zombie, ZS } from "./sim.ts";

/** One scripted button press inside a routine: at `t` frames, hold `btn` for `hold` frames. */
type Press = [t: number, btn: number, hold: number];
interface Routine {
	name: string;
	/** Engage distance to the target. */
	range: number;
	presses: Press[];
	length: number;
	/** Dodge toward the target (dash-slash) instead of facing it. */
	lunge?: boolean;
}

/** Every move in the kit, cycled in order so a demo run shows all of them. */
const ROUTINES: Routine[] = [
	{
		name: "light x3",
		range: 1.9,
		presses: [
			[0, BTN.LIGHT, 2],
			[9, BTN.LIGHT, 2],
			[19, BTN.LIGHT, 2],
		],
		length: 58,
	},
	{
		name: "launcher",
		range: 1.9,
		presses: [
			[0, BTN.LIGHT, 2],
			[9, BTN.LIGHT, 2],
			[19, BTN.HEAVY, 2],
		],
		length: 64,
	},
	{ name: "heavy", range: 2.2, presses: [[0, BTN.HEAVY, 2]], length: 46 },
	{
		name: "dash-slash",
		range: 4.2,
		lunge: true,
		presses: [
			[0, BTN.DODGE, 2],
			[7, BTN.LIGHT, 2],
		],
		length: 44,
	},
	{
		name: "charged heavy",
		range: 2.6,
		presses: [[0, BTN.HEAVY, 40]],
		length: 96,
	},
	{
		name: "plunge",
		range: 2.0,
		presses: [
			[0, BTN.JUMP, 2],
			[12, BTN.HEAVY, 2],
		],
		length: 58,
	},
	{
		name: "light x2",
		range: 1.9,
		presses: [
			[0, BTN.LIGHT, 2],
			[9, BTN.LIGHT, 2],
		],
		length: 38,
	},
];

/**
 * The `?demo=1` autoplayer: reads the sim and writes a TickInput each tick. It starts the
 * run, skips most of each countdown, picks upgrades, hunts the zombie that matters most
 * (near the gate, near the player), dodges telegraphed strikes and cycles through every
 * move in the kit, firing Spin Storm whenever Focus is full. Deterministic: it only reads
 * the sim. Allocation-free per tick.
 */
export class DemoBot {
	private readonly sim: GameSim;
	private routine = 0;
	private routineT = -1;
	private focusHold = 0;
	private evadeT = 0;
	private evadeX = 0;
	private evadeZ = 0;
	/** Waves after which the bot stops fighting (it just stands guard). 0 = never. */
	readonly stopAfterWave: number;
	/** Name of the routine running now (HUD debug, captures). */
	current = "";

	constructor(sim: GameSim, stopAfterWave = 0) {
		this.sim = sim;
		this.stopAfterWave = stopAfterWave;
	}

	next(out: TickInput): void {
		const s = this.sim;
		out.mx = 0;
		out.mz = 0;
		out.buttons = 0;
		const t = s.tick;
		const pulse = (t & 1) === 0;
		switch (s.phase) {
			case PHASE.TITLE:
				if (t > 30 && pulse) out.buttons = BTN.START;
				return;
			case PHASE.UPGRADE:
				if (pulse && t % 40 < 2)
					out.buttons = [BTN.PICK1, BTN.PICK2, BTN.PICK3][s.wave % 3] as number;
				return;
			case PHASE.VICTORY:
			case PHASE.GAME_OVER:
				return;
			case PHASE.PRE_WAVE:
				if (s.phaseT < s.waves.preWaveFrames - 150 && s.phaseT > 0 && pulse)
					out.buttons = BTN.START;
				break;
		}
		if (this.stopAfterWave > 0 && s.wave > this.stopAfterWave) return;
		this.fight(out);
	}

	private fight(out: TickInput): void {
		const s = this.sim;
		const p = s.player;
		if (!p.alive) return;

		// Spin Storm whenever Focus is full and enemies are close
		if (p.focus >= FOCUS_MAX && this.nearby(3.5) >= 3) this.focusHold = 16;
		if (this.focusHold > 0) {
			this.focusHold--;
			out.buttons |= BTN.FOCUS;
		}

		// evade a telegraphed strike aimed at us
		if (this.evadeT > 0) {
			this.evadeT--;
			out.mx = this.evadeX;
			out.mz = this.evadeZ;
			if (this.evadeT >= 8) out.buttons |= BTN.DODGE;
			return;
		}
		const threat = this.threat();
		if (threat && p.dodgeCd === 0 && s.combo.move < 0) {
			let dx = p.x - threat.x;
			let dz = p.z - threat.z;
			const l = Math.hypot(dx, dz) || 1;
			dx /= l;
			dz /= l;
			// sidestep: away and a bit to the side
			this.evadeX = dx * 0.8 - dz * 0.6;
			this.evadeZ = dz * 0.8 + dx * 0.6;
			this.evadeT = 10;
			this.routineT = -1;
			out.mx = this.evadeX;
			out.mz = this.evadeZ;
			out.buttons |= BTN.DODGE;
			return;
		}

		const target = this.pickTarget();
		if (!target) {
			// idle: drift back toward a guard post in front of the gate
			const o = s.objective;
			const gx = o.x - 3;
			const gz = o.z + 3;
			const dx = gx - p.x;
			const dz = gz - p.z;
			const d = Math.hypot(dx, dz);
			if (d > 0.6) {
				out.mx = dx / d;
				out.mz = dz / d;
			}
			this.current = "";
			return;
		}
		const dx = target.x - p.x;
		const dz = target.z - p.z;
		const d = Math.hypot(dx, dz) || 1;
		const r = ROUTINES[this.routine] as Routine;
		if (this.routineT < 0) {
			if (d > r.range) {
				out.mx = dx / d;
				out.mz = dz / d;
				if (d > 6) out.buttons |= BTN.SPRINT;
				this.current = "";
				return;
			}
			this.routineT = 0;
		}
		this.current = r.name;
		out.mx = dx / d;
		out.mz = dz / d;
		for (const [at, btn, hold] of r.presses)
			if (this.routineT >= at && this.routineT < at + hold) out.buttons |= btn;
		this.routineT++;
		if (this.routineT >= r.length) {
			this.routineT = -1;
			this.routine = (this.routine + 1) % ROUTINES.length;
		}
	}

	private nearby(range: number): number {
		const p = this.sim.player;
		let n = 0;
		for (const z of this.sim.zombies)
			if (z.alive && Math.hypot(z.x - p.x, z.z - p.z) < range) n++;
		return n;
	}

	/** A zombie about to strike the player, or null. */
	private threat(): Zombie | null {
		const s = this.sim;
		const p = s.player;
		for (const z of s.zombies) {
			if (!z.alive || z.state !== ZS.WINDUP || z.target !== 1) continue;
			const a = s.archetypes[z.type];
			if (!a) continue;
			const reach = a.reach + a.radius + 0.8;
			if (z.stateT <= 12 && Math.hypot(z.x - p.x, z.z - p.z) < reach) return z;
		}
		return null;
	}

	/** The zombie to fight: weighs distance to the player and threat to the gate. */
	private pickTarget(): Zombie | null {
		const s = this.sim;
		const p = s.player;
		const o = s.objective;
		let best: Zombie | null = null;
		let bestScore = Number.POSITIVE_INFINITY;
		for (const z of s.zombies) {
			if (!z.alive || z.state === ZS.SPAWNING) continue;
			const dp = Math.hypot(z.x - p.x, z.z - p.z);
			const dg = Math.hypot(z.x - o.x, z.z - o.z);
			const score = dp + 0.6 * dg;
			if (score < bestScore) {
				bestScore = score;
				best = z;
			}
		}
		return best;
	}
}
