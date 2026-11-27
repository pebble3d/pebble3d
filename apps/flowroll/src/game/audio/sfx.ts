/**
 * WebAudio-synthesised sound, no files. The context starts on the first key or pointer
 * gesture (no autoplay warning). Mat thuds, cloth grips, the beat tick, a heartbeat that
 * speeds up with submission tension, taps, and the referee's whistle.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private heartT = 0;
	private off = 0;
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
		comp.ratio.value = 4;
		const master = ctx.createGain();
		master.gain.value = 0.6;
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
		g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(this.master);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	private hiss(
		dur: number,
		gain: number,
		freq: number,
		q: number,
		delay = 0,
		type: BiquadFilterType = "bandpass",
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.master || !this.noise) return;
		const t = ctx.currentTime + delay;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f).connect(g).connect(this.master);
		this.off = (this.off + 0.137) % 0.6;
		src.start(t, this.off);
		src.stop(t + dur + 0.02);
	}

	/** Bodies hitting the mat: a low slap and a dull body. */
	thud(power = 1): void {
		this.hiss(0.18, 0.5 * power, 380, 0.8, 0, "lowpass");
		this.tone("sine", 95, 45, 0.25, 0.55 * power);
	}
	grip(): void {
		this.hiss(0.09, 0.12, 2400, 1.4);
	}
	breathe(): void {
		this.hiss(0.5, 0.08, 500, 0.6, 0, "lowpass");
	}
	posture(): void {
		this.hiss(0.08, 0.1, 300, 1, 0, "lowpass");
	}
	ready(): void {
		this.tone("sine", 990, 990, 0.06, 0.05);
	}
	launch(): void {
		this.hiss(0.22, 0.12, 900, 0.7);
	}
	reveal(): void {
		this.tone("triangle", 520, 520, 0.08, 0.08);
	}
	beat(grade: number): void {
		if (grade > 0.8) {
			this.tone("triangle", 880, 880, 0.14, 0.16);
			this.tone("triangle", 1320, 1320, 0.18, 0.1, 0.04);
		} else if (grade > 0.4) this.tone("triangle", 660, 660, 0.1, 0.12);
		else this.tone("square", 220, 180, 0.08, 0.06);
	}
	counter(): void {
		this.hiss(0.06, 0.18, 1600, 2);
	}
	stuffed(): void {
		this.tone("sine", 160, 90, 0.18, 0.3);
		this.hiss(0.12, 0.2, 600, 1);
	}
	wrong(): void {
		this.tone("sawtooth", 150, 110, 0.2, 0.08);
	}
	score(pts: number): void {
		this.tone("triangle", 660, 660, 0.12, 0.12);
		this.tone(
			"triangle",
			pts >= 3 ? 990 : 880,
			pts >= 3 ? 990 : 880,
			0.22,
			0.12,
			0.09,
		);
	}
	advantage(): void {
		this.tone("triangle", 740, 740, 0.12, 0.08);
	}
	ui(): void {
		this.tone("triangle", 600, 600, 0.05, 0.06);
	}
	/** Heartbeat paced by submission tension (call every frame during a submission). */
	heart(dt: number, tension: number): void {
		this.heartT -= dt;
		if (this.heartT > 0) return;
		const bpm = 70 + tension * 90;
		this.heartT = 60 / bpm;
		this.tone("sine", 70, 50, 0.12, 0.35 + tension * 0.3);
		this.tone("sine", 64, 45, 0.1, 0.25 + tension * 0.2, 0.16);
	}
	escapeBeat(q: number): void {
		this.hiss(0.1, 0.12 + q * 0.12, 1200, 1);
	}
	tap(): void {
		for (let i = 0; i < 3; i++)
			this.hiss(0.07, 0.4, 700, 1, i * 0.16, "lowpass");
	}
	whistle(long = false): void {
		const d = long ? 0.7 : 0.35;
		this.tone("sine", 2100, 2050, d, 0.12);
		this.tone("sine", 2350, 2300, d, 0.06);
	}
}
