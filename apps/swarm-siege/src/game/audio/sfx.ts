import { KIND } from "../defs.ts";
import { EV } from "../events.ts";
import { E_STRIDE, H, OFF_EVENTS } from "../snapshot.ts";

/** Voices started per snapshot, per family (a wave is thousands of hits). */
const LIMIT = { zap: 2, boom: 2, kill: 2, other: 3 };

/**
 * WebAudio-synthesised sound, no files. The context starts on the first user gesture, so
 * there are no autoplay warnings; it stays off in fixed mode (captures).
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private out: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private hum: GainNode | null = null;
	private seed = 1;

	constructor(enabled: boolean) {
		if (!enabled) return;
		const start = (): void => {
			this.init();
			window.removeEventListener("pointerdown", start);
			window.removeEventListener("keydown", start);
		};
		window.addEventListener("pointerdown", start);
		window.addEventListener("keydown", start);
	}

	private init(): void {
		if (this.ctx) return;
		const ctx = new AudioContext();
		this.ctx = ctx;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -18;
		comp.ratio.value = 6;
		const out = ctx.createGain();
		out.gain.value = 0.6;
		out.connect(comp).connect(ctx.destination);
		this.out = out;
		const len = ctx.sampleRate;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let s = 99991;
		for (let i = 0; i < len; i++) {
			s = (s * 16807) % 2147483647;
			d[i] = (s / 2147483647) * 2 - 1;
		}
		this.noise = buf;
		// Swarm hum: band-passed noise whose level follows the agent count.
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 180;
		bp.Q.value = 1.4;
		const g = ctx.createGain();
		g.gain.value = 0;
		src.connect(bp).connect(g).connect(out);
		src.start();
		this.hum = g;
	}

	private rnd(): number {
		this.seed = (this.seed * 16807) % 2147483647;
		return this.seed / 2147483647;
	}

	private tone(
		type: OscillatorType,
		f0: number,
		f1: number,
		dur: number,
		vol: number,
		delay = 0,
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.out) return;
		const t = ctx.currentTime + delay;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(this.out);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	private burst(
		freq: number,
		dur: number,
		vol: number,
		type: BiquadFilterType = "lowpass",
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.out || !this.noise) return;
		const t = ctx.currentTime;
		const s = ctx.createBufferSource();
		s.buffer = this.noise;
		s.playbackRate.value = 0.7 + this.rnd() * 0.6;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.setValueAtTime(freq, t);
		f.frequency.exponentialRampToValueAtTime(
			Math.max(40, freq * 0.25),
			t + dur,
		);
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		s.connect(f).connect(g).connect(this.out);
		s.start(t, this.rnd() * 0.5);
		s.stop(t + dur + 0.02);
	}

	handle(snap: Float32Array): void {
		if (!this.ctx) return;
		let zaps = 0;
		let booms = 0;
		let kills = 0;
		let other = 0;
		const n = snap[H.EVENTS] as number;
		for (let e = 0; e < n; e++) {
			const o = OFF_EVENTS + e * E_STRIDE;
			const t = snap[o] as number;
			const a = snap[o + 1] as number;
			switch (t) {
				case EV.ZAP:
					if (zaps++ < LIMIT.zap)
						this.tone("square", 1800 + this.rnd() * 900, 600, 0.05, 0.035);
					break;
				case EV.SHELL:
					if (other++ >= LIMIT.other) break;
					this.tone("sine", 160, 60, 0.18, 0.15);
					break;
				case EV.BOOM:
					if (booms++ < LIMIT.boom) this.burst(900, 0.45, 0.45);
					break;
				case EV.PULSE:
					if (other++ >= LIMIT.other) break;
					this.tone("triangle", 1400, 500, 0.3, 0.05);
					break;
				case EV.LANCE:
					if (other++ >= LIMIT.other) break;
					this.tone("sawtooth", 220, 1100, 0.32, 0.09);
					this.burst(4000, 0.25, 0.12, "highpass");
					break;
				case EV.KILL:
					if (a === KIND.BRUTE) {
						this.burst(400, 0.7, 0.6);
						this.tone("sine", 90, 35, 0.6, 0.4);
					} else if (kills++ < LIMIT.kill)
						this.tone(
							"triangle",
							a === KIND.GLIDER ? 700 : 1200 + this.rnd() * 500,
							300,
							0.06,
							0.04,
						);
					break;
				case EV.LEAK:
					if (other++ >= LIMIT.other) break;
					this.tone("sawtooth", 140, 90, 0.25, 0.12);
					break;
				case EV.PLACE:
					this.tone("sine", 660, 660, 0.12, 0.12);
					this.tone("sine", 990, 990, 0.16, 0.1, 0.07);
					break;
				case EV.UPGRADE:
					for (let k = 0; k < 3; k++)
						this.tone(
							"triangle",
							520 * (1 + k * 0.26),
							520 * (1 + k * 0.26),
							0.14,
							0.1,
							k * 0.06,
						);
					break;
				case EV.SELL:
					this.tone("sine", 700, 350, 0.18, 0.1);
					break;
				case EV.DENY:
					this.tone("square", 180, 150, 0.12, 0.06);
					break;
				case EV.WAVE_START:
					this.tone("sawtooth", 110, 110, 1.1, 0.12);
					this.tone("sawtooth", 165, 160, 1.1, 0.08);
					break;
				case EV.WAVE_CLEAR:
					for (const [k, f] of [523, 659, 784].entries())
						this.tone("triangle", f, f, 0.6, 0.08, k * 0.08);
					break;
				case EV.WON:
					for (const [k, f] of [523, 659, 784, 1046].entries())
						this.tone("triangle", f, f, 1.4, 0.1, k * 0.12);
					break;
				case EV.LOST:
					this.burst(600, 2, 0.8);
					this.tone("sawtooth", 220, 40, 2, 0.2);
					break;
			}
		}
	}

	/** Swarm hum level from the live agent count (call a few times a second). */
	frame(alive: number): void {
		if (!this.ctx || !this.hum) return;
		const v = Math.min(0.22, Math.sqrt(alive) * 0.004);
		this.hum.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
	}
}
