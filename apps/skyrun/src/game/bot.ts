import type { BotStepDef } from "./course.ts";
import { BTN, quantize, type TickInput } from "./input.ts";
import { EV, PHASE, type SkyrunSim } from "./sim.ts";

/** "fast" runs the route tightly; "steady" hesitates before each jump (a beatable rival). */
export type BotStyle = "fast" | "steady";

/**
 * `?demo=1` autoplayer: walks the course's `bot` route (targets, jumps, waits for movers,
 * targets relative to a moving platform) and writes the same `TickInput` a player would.
 * It reads only sim state, so a demo run is as deterministic as any other.
 */
export class DemoBot {
	private i = 0;
	private jumped = false;
	/** The current step's waits are met (latched until the step changes). */
	private go = false;
	private paused = 0;
	private resume = 0;
	private lastCp = 0;
	private release = 0;
	private readonly mp = new Float64Array(3);
	private readonly steps: BotStepDef[];

	private readonly sim: SkyrunSim;
	private readonly style: BotStyle;

	constructor(sim: SkyrunSim, style: BotStyle = "fast") {
		this.sim = sim;
		this.style = style;
		this.steps = sim.course.bot;
	}

	/** Route step the bot is on (tests, probes). */
	get stepIndex(): number {
		return this.i;
	}

	next(out: TickInput): void {
		out.x = 0;
		out.z = 0;
		out.buttons = 0;
		const sim = this.sim;
		const ev = sim.events;
		for (let e = 0; e < ev.n; e++) {
			if (ev.type[e] === EV.RESPAWN) {
				this.i = this.resume;
				this.jumped = false;
				this.paused = 0;
				this.go = false;
			}
		}
		if (sim.nextCheckpoint !== this.lastCp) {
			this.lastCp = sim.nextCheckpoint;
			this.resume = this.i;
		}
		if (sim.phase !== PHASE.RUN || sim.respawnIn > 0) return;
		if (this.release > 0) {
			this.release--;
			return;
		}

		for (let guard = 0; guard < 4; guard++) {
			const st = this.steps[this.i];
			if (!st) return;
			const pause = st.pause + (this.style === "steady" && st.jump ? 14 : 0);
			if (this.paused < pause) {
				this.paused++;
				return;
			}
			if (st.waitMover) {
				const k = sim.moverIndex.get(st.waitMover.id);
				if (k !== undefined) {
					sim.moverPos(k, this.mp);
					const a = st.waitMover.at;
					const dx = (this.mp[0] as number) - a[0];
					const dy = (this.mp[1] as number) - a[1];
					const dz = (this.mp[2] as number) - a[2];
					if (dx * dx + dy * dy + dz * dz > st.waitMover.near ** 2 && !this.go)
						return;
				}
			}
			if (st.waitSelf && !this.go) {
				const a = st.waitSelf.at;
				if (Math.hypot(sim.px - a[0], sim.pz - a[2]) > st.waitSelf.near) return;
			}
			if (st.waitAngle && !this.go) {
				const k = sim.moverIndex.get(st.waitAngle.id);
				if (k !== undefined) {
					const m = st.waitAngle.mod;
					let d = (sim.moverYaw(k) - st.waitAngle.deg) % m;
					if (d < 0) d += m;
					if (Math.min(d, m - d) > st.waitAngle.within) return;
				}
			}
			this.go = true;
			let tx = st.to[0];
			let tz = st.to[2];
			if (st.rel !== undefined) {
				const k = sim.moverIndex.get(st.rel);
				if (k !== undefined) {
					sim.moverPos(k, this.mp);
					tx += this.mp[0] as number;
					tz += this.mp[2] as number;
				}
			}
			const dx = tx - sim.px;
			const dz = tz - sim.pz;
			const d = Math.hypot(dx, dz);
			const arrived = d < st.within && (sim.grounded || !st.jump);
			if (arrived && (!st.jump || this.jumped)) {
				this.i++;
				this.jumped = false;
				this.paused = 0;
				this.go = false;
				continue;
			}
			if (d > 0.05) {
				out.x = quantize(dx / d);
				out.z = quantize(dz / d);
			}
			if (st.sprint) out.buttons |= BTN.SPRINT;
			if (
				st.jump &&
				!this.jumped &&
				sim.grounded &&
				d <= Math.max(st.jumpAt, 0) + 1e-6
			) {
				out.buttons |= BTN.JUMP;
				this.jumped = true;
			} else if (st.jump && !this.jumped && st.jumpAt === 0 && sim.grounded) {
				out.buttons |= BTN.JUMP;
				this.jumped = true;
			}
			return;
		}
	}
}
