/**
 * WebAudio-synthesised sound, no files. The context starts on the first key or pointer
 * gesture, so there is never an autoplay warning. Every cue is a short one-shot.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
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
		comp.ratio.value = 5;
		const master = ctx.createGain();
		master.gain.value = 0.55;
		master.connect(comp).connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let s = 1234567;
		for (let i = 0; i < len; i++) {
			s = (s * 16807) % 2147483647;
			d[i] = (s / 2147483647) * 2 - 1;
		}
		this.noise = buf;
	}

	private tone(
		type: OscillatorType,
		f0: number,
		f1: number,
		dur: number,
		gain: number,
		delay = 0,
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = ctx.currentTime + delay;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(this.master);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	private hiss(
		filter: BiquadFilterType,
		f0: number,
		f1: number,
		dur: number,
		gain: number,
		q = 1,
		delay = 0,
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.master || !this.noise) return;
		const t = ctx.currentTime + delay;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = filter;
		f.Q.value = q;
		f.frequency.setValueAtTime(f0, t);
		f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f).connect(g).connect(this.master);
		src.start(t, (t * 7.31) % 0.5);
		src.stop(t + dur + 0.05);
	}

	count(): void {
		this.tone("triangle", 660, 660, 0.16, 0.25);
	}
	go(): void {
		this.tone("sawtooth", 330, 340, 0.5, 0.18);
		this.tone("triangle", 990, 1000, 0.45, 0.2);
	}
	dash(): void {
		this.hiss("bandpass", 600, 2600, 0.22, 0.35, 2);
		this.tone("sine", 140, 70, 0.18, 0.25);
	}
	/** `v`: closing speed (m/s). */
	impact(v: number): void {
		const k = Math.min(1, v / 14);
		this.hiss("lowpass", 3000 + 4000 * k, 400, 0.08 + 0.1 * k, 0.25 + 0.5 * k);
		this.tone("sine", 120 + 60 * k, 45, 0.2 + 0.2 * k, 0.3 + 0.5 * k);
		this.tone("square", 1800, 900, 0.04, 0.05 + 0.1 * k);
	}
	ringout(): void {
		this.tone("sawtooth", 520, 60, 1.1, 0.2);
		this.hiss("lowpass", 1200, 80, 1.2, 0.5, 0.7, 0.25);
		this.tone("sine", 70, 30, 1.0, 0.6, 0.25);
	}
	warn(): void {
		this.hiss("lowpass", 180, 120, 1.4, 0.35, 0.8);
		this.tone("sine", 55, 50, 1.2, 0.25);
	}
	drop(): void {
		this.hiss("lowpass", 900, 60, 1.6, 0.6, 0.6);
		this.tone("sine", 60, 28, 1.5, 0.5);
	}
	win(): void {
		const notes = [523, 659, 784, 1047];
		for (let i = 0; i < notes.length; i++)
			this.tone(
				"triangle",
				notes[i] as number,
				notes[i] as number,
				0.35,
				0.18,
				i * 0.11,
			);
	}
	ui(): void {
		this.tone("triangle", 880, 1200, 0.06, 0.12);
	}
	rewind(): void {
		this.hiss("bandpass", 3000, 300, 0.45, 0.25, 3);
		this.tone("sine", 1400, 300, 0.4, 0.08);
	}
	verified(ok: boolean): void {
		if (ok) {
			this.tone("sine", 1200, 1200, 0.1, 0.12);
			this.tone("sine", 1600, 1600, 0.16, 0.12, 0.09);
		} else this.tone("square", 200, 150, 0.4, 0.15);
	}
}
