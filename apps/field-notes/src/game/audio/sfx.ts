/**
 * WebAudio-synthesised sound, no audio files. The AudioContext is created on the first user
 * gesture (no autoplay warnings). Ambience: a soft filtered-noise breeze plus a tonal shimmer
 * whose level follows the anomaly signal. Cues: shutter, film advance, autofocus beep,
 * exposure click, reveal chord, documented chime, results flourish.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private shimmerGain: GainNode | null = null;
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
		comp.threshold.value = -16;
		comp.ratio.value = 3;
		const master = ctx.createGain();
		master.gain.value = 0.65;
		master.connect(comp).connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let seed = 9001;
		for (let i = 0; i < len; i++) {
			seed = (seed * 16807) % 2147483647;
			d[i] = (seed / 2147483647) * 2 - 1;
		}
		this.noise = buf;
		this.ambience();
	}

	private now(): number {
		return this.ctx?.currentTime ?? 0;
	}

	private noiseSrc(): AudioBufferSourceNode | null {
		if (!this.ctx || !this.noise) return null;
		const s = this.ctx.createBufferSource();
		s.buffer = this.noise;
		return s;
	}

	private ambience(): void {
		const ctx = this.ctx;
		const master = this.master;
		if (!ctx || !master) return;
		// Breeze: looping noise through a low band-pass whose centre drifts.
		const n = this.noiseSrc();
		if (n) {
			n.loop = true;
			const bp = ctx.createBiquadFilter();
			bp.type = "bandpass";
			bp.frequency.value = 420;
			bp.Q.value = 0.6;
			const g = ctx.createGain();
			g.gain.value = 0.05;
			const lfo = ctx.createOscillator();
			lfo.frequency.value = 0.07;
			const lfoAmt = ctx.createGain();
			lfoAmt.gain.value = 180;
			lfo.connect(lfoAmt).connect(bp.frequency);
			n.connect(bp).connect(g).connect(master);
			n.start();
			lfo.start();
		}
		// Shimmer: two detuned sines and a fifth, beating slowly; gain follows the signal.
		const sg = ctx.createGain();
		sg.gain.value = 0;
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = 1800;
		sg.connect(lp).connect(master);
		for (const [f, a] of [
			[392, 0.4],
			[393.7, 0.4],
			[587.3, 0.22],
		] as const) {
			const o = ctx.createOscillator();
			o.type = "sine";
			o.frequency.value = f;
			const og = ctx.createGain();
			og.gain.value = a;
			o.connect(og).connect(sg);
			o.start();
		}
		this.shimmerGain = sg;
	}

	/** 0..1 nearness of a hidden anomaly. Call every frame; cheap. */
	signal(level: number): void {
		const g = this.shimmerGain;
		if (!g || !this.ctx) return;
		g.gain.setTargetAtTime(level * level * 0.09, this.now(), 0.3);
	}

	private tone(
		freq: number,
		at: number,
		dur: number,
		gain: number,
		type: OscillatorType = "sine",
	): void {
		const ctx = this.ctx;
		const master = this.master;
		if (!ctx || !master) return;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.value = freq;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, at);
		g.gain.linearRampToValueAtTime(gain, at + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
		o.connect(g).connect(master);
		o.start(at);
		o.stop(at + dur + 0.02);
	}

	private burst(
		at: number,
		dur: number,
		freq: number,
		gain: number,
		q = 1,
	): void {
		const ctx = this.ctx;
		const master = this.master;
		const n = this.noiseSrc();
		if (!ctx || !master || !n) return;
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(gain, at);
		g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
		n.connect(f).connect(g).connect(master);
		n.start(at, Math.random() * 1.5);
		n.stop(at + dur + 0.02);
	}

	/** Mechanical shutter: two clicks (curtains) and a short film-advance whirr. */
	shutter(): void {
		const t = this.now();
		this.burst(t, 0.03, 3200, 0.9, 2);
		this.tone(140, t, 0.05, 0.25, "square");
		this.burst(t + 0.07, 0.035, 2400, 0.7, 2);
		for (let i = 0; i < 5; i++)
			this.burst(t + 0.16 + i * 0.028, 0.02, 1500, 0.18, 4);
	}

	/** Autofocus confirm: two quick high beeps. */
	focus(locked: boolean): void {
		const t = this.now();
		this.tone(locked ? 2350 : 1500, t, 0.05, 0.08);
		if (locked) this.tone(2350, t + 0.075, 0.05, 0.08);
	}

	/** Exposure dial detent. */
	click(): void {
		this.burst(this.now(), 0.015, 4200, 0.25, 3);
	}

	/** Photo mode raise / lower: a soft cloth-and-strap rustle. */
	raise(up: boolean): void {
		const t = this.now();
		this.burst(t, 0.12, up ? 900 : 700, 0.12, 0.8);
	}

	/** An anomaly materialises: a rising, slightly detuned chord. */
	reveal(): void {
		const t = this.now();
		const notes = [293.7, 370, 440, 587.3];
		notes.forEach((f, i) => {
			this.tone(f, t + i * 0.09, 1.6, 0.07, "triangle");
			this.tone(f * 1.004, t + i * 0.09 + 0.01, 1.4, 0.04);
		});
		this.burst(t, 0.9, 6000, 0.05, 0.5);
	}

	/** First starred photo of an anomaly: a bright two-note chime. */
	documented(): void {
		const t = this.now() + 0.25;
		this.tone(880, t, 0.9, 0.09);
		this.tone(1318.5, t + 0.12, 1.2, 0.08);
	}

	/** Survey over. */
	results(): void {
		const t = this.now();
		[392, 493.9, 587.3, 784].forEach((f, i) => {
			this.tone(f, t + i * 0.14, 1.4, 0.07, "triangle");
		});
	}
}
