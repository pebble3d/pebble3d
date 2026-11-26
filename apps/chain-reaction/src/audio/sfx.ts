/**
 * WebAudio-synthesised sound, no files. The AudioContext is created on the first user
 * gesture (never earlier, so no autoplay warnings). Cues: hard clacks for impacts (pitched
 * by material), a hollow wooden tock for placing parts, a springy boing, a fan whoosh bed
 * while the machine runs, and a bright chime arpeggio for the goal.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private fanGain: GainNode | null = null;
	private lastClack = 0;
	readonly enabled: boolean;

	constructor(enabled: boolean) {
		this.enabled = enabled;
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
		comp.threshold.value = -12;
		comp.ratio.value = 5;
		const master = ctx.createGain();
		master.gain.value = 0.75;
		// A short feedback delay gives the studio a little room.
		const delay = ctx.createDelay(0.5);
		delay.delayTime.value = 0.11;
		const fb = ctx.createGain();
		fb.gain.value = 0.22;
		const wet = ctx.createGain();
		wet.gain.value = 0.18;
		master.connect(comp);
		master.connect(delay);
		delay.connect(fb).connect(delay);
		delay.connect(wet).connect(comp);
		comp.connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let seed = 1234567;
		for (let i = 0; i < len; i++) {
			seed = (seed * 16807) % 2147483647;
			d[i] = (seed / 2147483647) * 2 - 1;
		}
		this.noise = buf;
		// Fan bed: band-passed noise, silent until the machine runs with fans.
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 700;
		bp.Q.value = 0.6;
		const g = ctx.createGain();
		g.gain.value = 0;
		src.connect(bp).connect(g).connect(master);
		src.start();
		this.fanGain = g;
	}

	private get t(): number {
		return this.ctx?.currentTime ?? 0;
	}

	private env(
		peak: number,
		attack: number,
		decay: number,
		at = this.t,
	): GainNode | null {
		if (!this.ctx || !this.master) return null;
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(0.0001, at);
		g.gain.exponentialRampToValueAtTime(peak, at + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
		g.connect(this.master);
		return g;
	}

	private tone(
		type: OscillatorType,
		f0: number,
		f1: number,
		peak: number,
		decay: number,
		at = this.t,
	): void {
		const ctx = this.ctx;
		const g = this.env(peak, 0.004, decay, at);
		if (!ctx || !g) return;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, at);
		o.frequency.exponentialRampToValueAtTime(f1, at + decay);
		o.connect(g);
		o.start(at);
		o.stop(at + decay + 0.05);
	}

	private burst(
		freq: number,
		q: number,
		peak: number,
		decay: number,
		at = this.t,
	): void {
		const ctx = this.ctx;
		const g = this.env(peak, 0.002, decay, at);
		if (!ctx || !g || !this.noise) return;
		const s = ctx.createBufferSource();
		s.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.frequency.value = freq;
		f.Q.value = q;
		s.connect(f).connect(g);
		s.start(at, (freq * 0.37) % 0.8);
		s.stop(at + decay + 0.05);
	}

	/** A hard, satisfying clack. `strength` in m/s of velocity change. */
	clack(strength: number, kind: "ball" | "domino" = "ball"): void {
		if (!this.ctx) return;
		const now = this.t;
		if (now - this.lastClack < 0.03) return;
		this.lastClack = now;
		const v = Math.min(1, strength / 6);
		if (kind === "domino") {
			this.burst(2600, 5, 0.25 + 0.4 * v, 0.05);
			this.tone("triangle", 1400, 900, 0.12 + 0.2 * v, 0.05);
		} else {
			this.burst(3800, 3, 0.2 + 0.5 * v, 0.04);
			this.tone("sine", 2100 + 600 * v, 1500, 0.08 + 0.2 * v, 0.06);
		}
	}

	/** Placing a part: a hollow wooden tock. Removing: a lighter tick. */
	place(remove = false): void {
		if (!this.ctx) return;
		this.tone("sine", remove ? 520 : 340, remove ? 380 : 190, 0.5, 0.09);
		this.burst(remove ? 2400 : 1500, 4, 0.25, 0.03);
	}

	ui(): void {
		if (!this.ctx) return;
		this.tone("triangle", 1800, 1600, 0.08, 0.03);
	}

	boing(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const at = this.t;
		const g = this.env(0.45, 0.005, 0.38, at);
		if (!g) return;
		const o = ctx.createOscillator();
		o.type = "sine";
		o.frequency.setValueAtTime(160, at);
		o.frequency.exponentialRampToValueAtTime(620, at + 0.12);
		o.frequency.exponentialRampToValueAtTime(420, at + 0.38);
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 28;
		const lg = ctx.createGain();
		lg.gain.value = 40;
		lfo.connect(lg).connect(o.frequency);
		o.connect(g);
		o.start(at);
		lfo.start(at);
		o.stop(at + 0.45);
		lfo.stop(at + 0.45);
		this.burst(900, 2, 0.2, 0.05, at);
	}

	/** Fan bed level 0..1 (smoothed by the audio param). */
	fan(level: number): void {
		if (!this.fanGain) return;
		this.fanGain.gain.setTargetAtTime(level * 0.12, this.t, 0.15);
	}

	whoosh(): void {
		if (!this.ctx) return;
		this.burst(600, 0.8, 0.25, 0.35);
	}

	chime(): void {
		if (!this.ctx) return;
		const at = this.t;
		const notes = [784, 988, 1175, 1568];
		notes.forEach((f, i) => {
			this.tone("triangle", f, f * 0.998, 0.28, 0.9, at + i * 0.09);
			this.tone("sine", f * 2, f * 2, 0.08, 0.6, at + i * 0.09);
		});
	}

	fail(): void {
		if (!this.ctx) return;
		this.tone("sine", 220, 110, 0.35, 0.4);
		this.tone("triangle", 330, 160, 0.12, 0.3);
	}

	run(): void {
		if (!this.ctx) return;
		this.tone("triangle", 660, 990, 0.18, 0.12);
	}
}
