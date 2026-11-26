/**
 * WebAudio-synthesised sound, no files. The context is created on the first user gesture so
 * there is never an autoplay warning. A rolling bed (filtered noise + a low hum) follows the
 * marble's speed; every other cue is a short synth one-shot.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private rollGain: GainNode | null = null;
	private rollFilter: BiquadFilterNode | null = null;
	private humOsc: OscillatorNode | null = null;
	private humGain: GainNode | null = null;
	private windGain: GainNode | null = null;
	readonly enabled: boolean;
	/** Rotating start offset into the noise buffer (varied without randomness). */
	private offset = 0;

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
		comp.ratio.value = 4;
		const master = ctx.createGain();
		master.gain.value = 0.6;
		master.connect(comp).connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let s = 22222;
		for (let i = 0; i < len; i++) {
			s = (s * 16807) % 2147483647;
			d[i] = (s / 2147483647) * 2 - 1;
		}
		this.noise = buf;
		// rolling: brown-ish noise through a lowpass that opens with speed
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.loop = true;
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = 200;
		lp.Q.value = 0.7;
		const g = ctx.createGain();
		g.gain.value = 0;
		src.connect(lp).connect(g).connect(master);
		src.start();
		this.rollFilter = lp;
		this.rollGain = g;
		const hum = ctx.createOscillator();
		hum.type = "triangle";
		hum.frequency.value = 50;
		const hg = ctx.createGain();
		hg.gain.value = 0;
		hum.connect(hg).connect(master);
		hum.start();
		this.humOsc = hum;
		this.humGain = hg;
		// wind: bandpassed noise that rises with speed (airborne or not)
		const ws = ctx.createBufferSource();
		ws.buffer = buf;
		ws.loop = true;
		ws.playbackRate.value = 0.7;
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 900;
		bp.Q.value = 0.5;
		const wg = ctx.createGain();
		wg.gain.value = 0;
		ws.connect(bp).connect(wg).connect(master);
		ws.start();
		this.windGain = wg;
	}

	/** Continuous bed: call every frame. */
	roll(speed: number, grounded: boolean, active: boolean): void {
		const ctx = this.ctx;
		if (
			!ctx ||
			!this.rollGain ||
			!this.rollFilter ||
			!this.humOsc ||
			!this.humGain ||
			!this.windGain
		)
			return;
		const t = ctx.currentTime;
		const k = Math.min(1, speed / 35);
		const on = active ? 1 : 0;
		this.rollGain.gain.setTargetAtTime(
			grounded ? on * (0.05 + k * 0.35) : 0,
			t,
			0.05,
		);
		this.rollFilter.frequency.setTargetAtTime(180 + k * 1400, t, 0.08);
		this.humOsc.frequency.setTargetAtTime(38 + speed * 2.2, t, 0.1);
		this.humGain.gain.setTargetAtTime(grounded ? on * k * 0.12 : 0, t, 0.06);
		this.windGain.gain.setTargetAtTime(on * k * k * 0.22, t, 0.2);
	}

	private tone(
		freq: number,
		dur: number,
		type: OscillatorType,
		vol: number,
		at = 0,
		slideTo?: number,
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = ctx.currentTime + at;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(this.master);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	private burst(
		dur: number,
		freq: number,
		q: number,
		vol: number,
		sweepTo?: number,
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.master || !this.noise) return;
		const t = ctx.currentTime;
		const s = ctx.createBufferSource();
		s.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.frequency.setValueAtTime(freq, t);
		if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		s.connect(f).connect(g).connect(this.master);
		this.offset = (this.offset + 0.37) % 1.5;
		s.start(t, this.offset);
		s.stop(t + dur + 0.05);
	}

	count(): void {
		this.tone(660, 0.18, "square", 0.08);
	}
	go(): void {
		this.tone(1320, 0.5, "square", 0.1);
		this.tone(990, 0.5, "triangle", 0.08);
	}
	boost(): void {
		this.burst(0.6, 600, 1.2, 0.5, 3800);
		this.tone(220, 0.45, "sawtooth", 0.05, 0, 880);
	}
	checkpoint(ahead: boolean | null): void {
		const base = ahead === false ? 587 : 784;
		this.tone(base, 0.16, "triangle", 0.14);
		this.tone(base * 1.5, 0.3, "triangle", 0.12, 0.09);
	}
	jump(): void {
		this.tone(300, 0.18, "sine", 0.12, 0, 620);
	}
	land(impact: number): void {
		const v = Math.min(1, impact / 10);
		this.tone(90, 0.22, "sine", 0.1 + v * 0.3, 0, 45);
		this.burst(0.12, 900, 0.8, 0.12 + v * 0.3);
	}
	respawn(): void {
		this.tone(520, 0.3, "sine", 0.1, 0, 260);
		this.tone(780, 0.4, "sine", 0.06, 0.12, 1040);
	}
	finish(medal: number): void {
		const notes = [523, 659, 784, 1047, 1319];
		const n = 3 + Math.max(0, 3 - medal);
		for (let i = 0; i < Math.min(n, notes.length); i++)
			this.tone(notes[i] as number, 0.5, "triangle", 0.12, i * 0.09);
	}
	ui(): void {
		this.tone(880, 0.06, "sine", 0.06);
	}
}
