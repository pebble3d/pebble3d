import { EV, type Events } from "../sim.ts";

/**
 * Synthesised WebAudio cues (no files): the AudioContext is created on the first user
 * gesture, never at load, and the whole thing is off in fixed mode (captures). Cues are
 * played from the sim's event queue; nothing here feeds back into the sim.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private out: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private wind: GainNode | null = null;
	private windFilter: BiquadFilterNode | null = null;

	constructor(enabled: boolean) {
		if (!enabled) return;
		const unlock = (): void => {
			if (!this.ctx) this.init();
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
		};
		window.addEventListener("pointerdown", unlock);
		window.addEventListener("keydown", unlock);
	}

	private init(): void {
		const ctx = new AudioContext();
		this.ctx = ctx;
		const out = ctx.createGain();
		out.gain.value = 0.6;
		out.connect(ctx.destination);
		this.out = out;
		// White noise from an LCG (no Math.random anywhere near the game).
		const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let s = 12345;
		for (let i = 0; i < d.length; i++) {
			s = (s * 1664525 + 1013904223) >>> 0;
			d[i] = s / 2147483648 - 1;
		}
		this.noise = buf;
		// Looping high-altitude wind, louder with speed and while falling.
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.frequency.value = 500;
		f.Q.value = 0.6;
		const g = ctx.createGain();
		g.gain.value = 0;
		src.connect(f).connect(g).connect(out);
		src.start();
		this.wind = g;
		this.windFilter = f;
	}

	private tone(
		freq: number,
		dur: number,
		gain: number,
		type: OscillatorType = "sine",
		slide = 0,
		delay = 0,
	): void {
		const ctx = this.ctx;
		const out = this.out;
		if (!ctx || !out) return;
		const t = ctx.currentTime + delay;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		if (slide !== 0)
			o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(out);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	private hiss(dur: number, gain: number, freq: number, q = 1): void {
		const ctx = this.ctx;
		const out = this.out;
		if (!ctx || !out || !this.noise) return;
		const t = ctx.currentTime;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(gain, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f).connect(g).connect(out);
		src.start(t, (t * 0.37) % 1.5);
		src.stop(t + dur + 0.02);
	}

	handle(ev: Events): void {
		for (let e = 0; e < ev.n; e++) {
			const t = ev.type[e];
			if (t === EV.BEEP) this.tone(660, 0.14, 0.25, "triangle");
			else if (t === EV.GO) {
				this.tone(990, 0.35, 0.3, "triangle");
				this.tone(1320, 0.4, 0.15, "sine", 1, 0.02);
			} else if (t === EV.JUMP) {
				this.tone(300, 0.14, 0.12, "sine", 1.9);
				this.hiss(0.12, 0.06, 2400, 0.8);
			} else if (t === EV.LAND) {
				const air = ev.a[e] as number;
				this.hiss(0.1, Math.min(0.25, 0.05 + air * 0.004), 700, 0.7);
				this.tone(110, 0.08, Math.min(0.2, air * 0.004), "sine", 0.6);
			} else if (t === EV.SHARD) {
				const k = (ev.a[e] as number) % 4;
				const base = 880 * 2 ** (k / 12);
				this.tone(base, 0.25, 0.16, "triangle");
				this.tone(base * 1.5, 0.35, 0.1, "sine", 1, 0.06);
				this.tone(base * 2, 0.45, 0.06, "sine", 1, 0.12);
			} else if (t === EV.CHECKPOINT) {
				for (const [i, f] of [523, 659, 784, 1047].entries())
					this.tone(f, 0.4, 0.13, "triangle", 1, i * 0.07);
			} else if (t === EV.FALL) this.tone(520, 0.9, 0.14, "sine", 0.25);
			else if (t === EV.RESPAWN) {
				this.hiss(0.4, 0.12, 3000, 2);
				this.tone(440, 0.3, 0.1, "sine", 2);
			} else if (t === EV.FINISH) {
				for (const [i, f] of [523, 659, 784, 1047, 1319].entries())
					this.tone(f, 0.7, 0.13, "triangle", 1, i * 0.09);
				this.tone(262, 1.2, 0.12, "sine", 1, 0.45);
			}
		}
	}

	/** Per frame: wind follows the runner's speed (and the fall). */
	frame(speed: number, falling: boolean): void {
		if (!this.ctx || !this.wind || !this.windFilter) return;
		const t = this.ctx.currentTime;
		const target = Math.min(0.12, 0.012 + speed * 0.008 + (falling ? 0.08 : 0));
		this.wind.gain.setTargetAtTime(target, t, 0.3);
		this.windFilter.frequency.setTargetAtTime(380 + speed * 70, t, 0.3);
	}
}
