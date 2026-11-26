/**
 * WebAudio-synthesised sound: no audio files. One AudioContext, created on the first user
 * gesture (never before, so no autoplay warnings), a master compressor, a shared noise
 * buffer, and one function per cue. Ambience is a looping filtered-noise wind with a slow
 * gust LFO plus a low drone that darkens with dusk.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private windGain: GainNode | null = null;
	private droneGain: GainNode | null = null;
	private spinGain: GainNode | null = null;
	private lastGroan = 0;
	private lastHit = 0;
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
		comp.threshold.value = -14;
		comp.ratio.value = 4;
		const master = ctx.createGain();
		master.gain.value = 0.7;
		master.connect(comp).connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let seed = 12345;
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
		s.loop = true;
		s.loopStart = Math.random();
		return s;
	}

	private env(
		peak: number,
		attack: number,
		decay: number,
		t0 = this.now(),
	): GainNode | null {
		if (!this.ctx) return null;
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(0.0001, t0);
		g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
		return g;
	}

	private ambience(): void {
		const ctx = this.ctx;
		const master = this.master;
		const src = this.noiseSrc();
		if (!ctx || !master || !src) return;
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 420;
		bp.Q.value = 0.6;
		const g = ctx.createGain();
		g.gain.value = 0.05;
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 0.11;
		const lfoGain = ctx.createGain();
		lfoGain.gain.value = 260;
		lfo.connect(lfoGain).connect(bp.frequency);
		src.connect(bp).connect(g).connect(master);
		src.start();
		lfo.start();
		this.windGain = g;
		// low drone (two detuned sines) that swells at dusk
		const dg = ctx.createGain();
		dg.gain.value = 0;
		for (const f of [55, 55.7]) {
			const o = ctx.createOscillator();
			o.type = "sine";
			o.frequency.value = f;
			o.connect(dg);
			o.start();
		}
		dg.connect(master);
		this.droneGain = dg;
	}

	/** 0..1 time of day: wind rises, the drone swells. */
	setDusk(d: number): void {
		if (!this.ctx) return;
		const t = this.now();
		this.windGain?.gain.setTargetAtTime(0.05 + 0.05 * d, t, 2);
		this.droneGain?.gain.setTargetAtTime(0.015 + 0.05 * d, t, 2);
	}

	/** Blade swish; `weight` 0 light .. 1 heavy. */
	swish(weight: number): void {
		const ctx = this.ctx;
		const src = this.noiseSrc();
		if (!ctx || !src || !this.master) return;
		const t = this.now();
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.Q.value = 1.4;
		bp.frequency.setValueAtTime(900 + 600 * weight, t);
		bp.frequency.exponentialRampToValueAtTime(
			3800 - 1200 * weight,
			t + 0.09 + 0.06 * weight,
		);
		const g = this.env(0.32 + 0.2 * weight, 0.02, 0.16 + 0.12 * weight, t);
		if (!g) return;
		src.connect(bp).connect(g).connect(this.master);
		src.start(t);
		src.stop(t + 0.4);
	}

	/** Blade into flesh: a wet thump, a gritty crunch and a short metallic ring. */
	hit(heavy: boolean): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		if (t - this.lastHit < 0.025) return;
		this.lastHit = t;
		const o = ctx.createOscillator();
		o.type = "sine";
		o.frequency.setValueAtTime(heavy ? 120 : 170, t);
		o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
		const g = this.env(heavy ? 0.9 : 0.55, 0.004, heavy ? 0.24 : 0.14, t);
		if (!g) return;
		o.connect(g).connect(this.master);
		o.start(t);
		o.stop(t + 0.35);
		const n = this.noiseSrc();
		if (n) {
			const lp = ctx.createBiquadFilter();
			lp.type = "lowpass";
			lp.frequency.value = heavy ? 1600 : 2400;
			const ng = this.env(heavy ? 0.5 : 0.35, 0.002, 0.09, t);
			if (ng) {
				n.connect(lp).connect(ng).connect(this.master);
				n.start(t);
				n.stop(t + 0.2);
			}
		}
		const ring = ctx.createOscillator();
		ring.type = "triangle";
		ring.frequency.value = heavy ? 1320 : 1980 + Math.random() * 300;
		const rg = this.env(0.06, 0.002, 0.22, t);
		if (rg) {
			ring.connect(rg).connect(this.master);
			ring.start(t);
			ring.stop(t + 0.3);
		}
	}

	dash(): void {
		const ctx = this.ctx;
		const src = this.noiseSrc();
		if (!ctx || !src || !this.master) return;
		const t = this.now();
		const hp = ctx.createBiquadFilter();
		hp.type = "highpass";
		hp.frequency.setValueAtTime(300, t);
		hp.frequency.exponentialRampToValueAtTime(2200, t + 0.18);
		const g = this.env(0.28, 0.03, 0.2, t);
		if (!g) return;
		src.connect(hp).connect(g).connect(this.master);
		src.start(t);
		src.stop(t + 0.3);
	}

	/** Zombie groan: a formant-filtered sawtooth with a sagging pitch. Rate-limited. */
	groan(pitch: number, loud = 0.12): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		if (t - this.lastGroan < 0.35) return;
		this.lastGroan = t;
		const o = ctx.createOscillator();
		o.type = "sawtooth";
		const f0 = 70 * pitch + Math.random() * 20;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.linearRampToValueAtTime(f0 * 0.7, t + 0.9);
		const vib = ctx.createOscillator();
		vib.frequency.value = 5 + Math.random() * 3;
		const vg = ctx.createGain();
		vg.gain.value = 4;
		vib.connect(vg).connect(o.frequency);
		const f1 = ctx.createBiquadFilter();
		f1.type = "bandpass";
		f1.frequency.value = 520 + Math.random() * 120;
		f1.Q.value = 5;
		const f2 = ctx.createBiquadFilter();
		f2.type = "bandpass";
		f2.frequency.value = 1100 + Math.random() * 200;
		f2.Q.value = 6;
		const g = this.env(loud, 0.18, 0.8, t);
		if (!g) return;
		o.connect(f1).connect(g);
		o.connect(f2).connect(g);
		g.connect(this.master);
		o.start(t);
		vib.start(t);
		o.stop(t + 1.1);
		vib.stop(t + 1.1);
	}

	/** Heavy ground impact (brute slam, plunge, shockwave). */
	boom(size: number): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		const o = ctx.createOscillator();
		o.type = "sine";
		o.frequency.setValueAtTime(90, t);
		o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
		const g = this.env(0.9 * size, 0.005, 0.6, t);
		if (!g) return;
		o.connect(g).connect(this.master);
		o.start(t);
		o.stop(t + 0.7);
		const n = this.noiseSrc();
		if (n) {
			const lp = ctx.createBiquadFilter();
			lp.type = "lowpass";
			lp.frequency.setValueAtTime(900, t);
			lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
			const ng = this.env(0.6 * size, 0.005, 0.5, t);
			if (ng) {
				n.connect(lp).connect(ng).connect(this.master);
				n.start(t);
				n.stop(t + 0.6);
			}
		}
	}

	/** Timber thud (the gate takes a hit). */
	thud(): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		const o = ctx.createOscillator();
		o.type = "triangle";
		o.frequency.setValueAtTime(140, t);
		o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
		const g = this.env(0.35, 0.003, 0.16, t);
		if (!g) return;
		o.connect(g).connect(this.master);
		o.start(t);
		o.stop(t + 0.25);
	}

	hurt(): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		const o = ctx.createOscillator();
		o.type = "square";
		o.frequency.setValueAtTime(220, t);
		o.frequency.exponentialRampToValueAtTime(110, t + 0.18);
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = 900;
		const g = this.env(0.25, 0.005, 0.2, t);
		if (!g) return;
		o.connect(lp).connect(g).connect(this.master);
		o.start(t);
		o.stop(t + 0.3);
		this.boom(0.25);
	}

	/** War horn: detuned low saws through a slowly opening filter. */
	horn(): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.setValueAtTime(200, t);
		lp.frequency.linearRampToValueAtTime(1100, t + 0.8);
		lp.frequency.linearRampToValueAtTime(400, t + 2.2);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(0.32, t + 0.4);
		g.gain.setValueAtTime(0.32, t + 1.4);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
		for (const f of [87.3, 87.9, 130.8]) {
			const o = ctx.createOscillator();
			o.type = "sawtooth";
			o.frequency.setValueAtTime(f * 0.94, t);
			o.frequency.linearRampToValueAtTime(f, t + 0.35);
			o.connect(lp);
			o.start(t);
			o.stop(t + 2.5);
		}
		lp.connect(g).connect(this.master);
	}

	/** Bright two-note chime: wave clear, Focus full, upgrades. */
	chime(high = false): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		const notes = high ? [880, 1318.5] : [659.3, 987.8];
		notes.forEach((f, i) => {
			const o = ctx.createOscillator();
			o.type = "sine";
			o.frequency.value = f;
			const g = this.env(0.14, 0.005, 0.7, t + i * 0.09);
			if (!g || !this.master) return;
			o.connect(g).connect(this.master);
			o.start(t + i * 0.09);
			o.stop(t + i * 0.09 + 0.8);
		});
	}

	/** Spin Storm wind loop on/off. */
	spin(on: boolean): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = this.now();
		if (on && !this.spinGain) {
			const src = this.noiseSrc();
			if (!src) return;
			const bp = ctx.createBiquadFilter();
			bp.type = "bandpass";
			bp.Q.value = 2;
			bp.frequency.value = 1400;
			const lfo = ctx.createOscillator();
			lfo.frequency.value = 4.2;
			const lg = ctx.createGain();
			lg.gain.value = 700;
			lfo.connect(lg).connect(bp.frequency);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(0.4, t + 0.15);
			src.connect(bp).connect(g).connect(this.master);
			src.start(t);
			lfo.start(t);
			this.spinGain = g;
			window.setTimeout(() => {
				src.stop();
				lfo.stop();
			}, 2600);
		} else if (!on && this.spinGain) {
			this.spinGain.gain.setTargetAtTime(0.0001, t, 0.08);
			this.spinGain = null;
		}
	}
}
