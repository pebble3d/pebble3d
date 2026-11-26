/**
 * WebAudio-synthesised sound, no files. The AudioContext is created on the first user gesture
 * (never before: no autoplay warnings), and everything is off in fixed mode and with mute=1.
 * The motor bed is four detuned saw oscillators (one per motor) through a low-pass whose
 * pitch and brightness follow thrust and speed; cues are short tones and filtered noise.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private motorGain: GainNode | null = null;
	private motorFilter: BiquadFilterNode | null = null;
	private readonly motors: OscillatorNode[] = [];
	private windGain: GainNode | null = null;
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
		comp.threshold.value = -18;
		comp.ratio.value = 4;
		const master = ctx.createGain();
		master.gain.value = 0.7;
		master.connect(comp).connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let s = 4242;
		for (let i = 0; i < len; i++) {
			s = (s * 16807) % 2147483647;
			d[i] = (s / 2147483647) * 2 - 1;
		}
		this.noise = buf;
		// motor bed
		const mf = ctx.createBiquadFilter();
		mf.type = "lowpass";
		mf.frequency.value = 600;
		mf.Q.value = 2;
		const mg = ctx.createGain();
		mg.gain.value = 0;
		mf.connect(mg).connect(master);
		for (const det of [0, 7, -5, 12]) {
			const o = ctx.createOscillator();
			o.type = "sawtooth";
			o.frequency.value = 120;
			o.detune.value = det;
			const g = ctx.createGain();
			g.gain.value = 0.25;
			o.connect(g).connect(mf);
			o.start();
			this.motors.push(o);
		}
		this.motorGain = mg;
		this.motorFilter = mf;
		// prop wash: noise that rises with speed
		const wn = ctx.createBufferSource();
		wn.buffer = buf;
		wn.loop = true;
		const wf = ctx.createBiquadFilter();
		wf.type = "bandpass";
		wf.frequency.value = 900;
		wf.Q.value = 0.7;
		const wg = ctx.createGain();
		wg.gain.value = 0;
		wn.connect(wf).connect(wg).connect(master);
		wn.start();
		this.windGain = wg;
	}

	/** Continuous: thrust 0..1, speed m/s, armed = motors spinning. */
	motor(thrust: number, speed: number, armed: boolean): void {
		const ctx = this.ctx;
		if (!ctx || !this.motorGain || !this.motorFilter || !this.windGain) return;
		const t = ctx.currentTime;
		const f = 95 + thrust * 230 + speed * 6;
		for (let i = 0; i < this.motors.length; i++)
			(this.motors[i] as OscillatorNode).frequency.setTargetAtTime(
				f * (1 + i * 0.004),
				t,
				0.04,
			);
		this.motorFilter.frequency.setTargetAtTime(500 + thrust * 2600, t, 0.05);
		this.motorGain.gain.setTargetAtTime(
			armed ? 0.05 + thrust * 0.1 : 0,
			t,
			0.06,
		);
		this.windGain.gain.setTargetAtTime(
			armed ? Math.min(0.16, speed * 0.016) : 0,
			t,
			0.1,
		);
	}

	private tone(
		freq: number,
		dur: number,
		gain: number,
		type: OscillatorType = "sine",
		at = 0,
	): void {
		const ctx = this.ctx;
		const out = this.master;
		if (!ctx || !out) return;
		const t = ctx.currentTime + at;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = type;
		o.frequency.value = freq;
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(out);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	private burst(dur: number, gain: number, freq: number, q = 0.8): void {
		const ctx = this.ctx;
		const out = this.master;
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
		src.start(t, (t * 7.3) % 0.5);
		src.stop(t + dur + 0.02);
	}

	count(n: number): void {
		this.tone(n > 0 ? 660 : 1320, n > 0 ? 0.16 : 0.42, 0.22, "square");
	}

	gate(): void {
		this.tone(1046, 0.12, 0.16, "triangle");
		this.tone(1568, 0.2, 0.12, "triangle", 0.05);
	}

	lap(best: boolean): void {
		const notes = best ? [784, 988, 1175, 1568] : [784, 988, 1175];
		notes.forEach((f, i) => {
			this.tone(f, 0.24, 0.15, "triangle", i * 0.07);
		});
	}

	bump(v: number): void {
		this.burst(0.08, Math.min(0.35, v * 0.1), 1800, 1.4);
	}

	crash(): void {
		this.burst(0.7, 0.6, 500, 0.5);
		this.tone(70, 0.5, 0.4, "sine");
	}

	respawn(): void {
		this.tone(440, 0.1, 0.12, "sine");
		this.tone(880, 0.16, 0.12, "sine", 0.08);
	}

	shutter(): void {
		this.burst(0.05, 0.4, 3500, 2);
		this.burst(0.09, 0.3, 1200, 2);
	}
}
