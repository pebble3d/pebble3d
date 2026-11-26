/**
 * WebAudio-synthesised sound: no samples. The context starts on the first user gesture; with
 * `muted` every call is a no-op (captures, fixed mode). One shared noise buffer, rate-limited
 * impacts, and a collapse rumble whose level follows how much is moving.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private rumbleGain: GainNode | null = null;
	private lastImpact = 0;
	private impactsThisWindow = 0;
	readonly muted: boolean;

	constructor(muted: boolean) {
		this.muted = muted;
		if (muted) return;
		const unlock = (): void => {
			this.start();
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
		};
		window.addEventListener("pointerdown", unlock);
		window.addEventListener("keydown", unlock);
	}

	private start(): void {
		if (this.ctx) return;
		const ctx = new AudioContext();
		this.ctx = ctx;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -14;
		comp.ratio.value = 4;
		comp.connect(ctx.destination);
		this.master = ctx.createGain();
		this.master.gain.value = 0.8;
		this.master.connect(comp);
		const len = ctx.sampleRate * 2;
		this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = this.noise.getChannelData(0);
		let s = 12345;
		for (let i = 0; i < len; i++) {
			s = (s * 1103515245 + 12345) >>> 0;
			d[i] = (s / 4294967296) * 2 - 1;
		}
		// Rumble bed: low-passed noise, gain driven by `rumble()`.
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		src.loop = true;
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = 140;
		this.rumbleGain = ctx.createGain();
		this.rumbleGain.gain.value = 0;
		src.connect(lp).connect(this.rumbleGain).connect(this.master);
		src.start();
	}

	private noiseBurst(
		at: number,
		dur: number,
		freq: number,
		q: number,
		gain: number,
		type: BiquadFilterType = "lowpass",
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.noise || !this.master) return;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		src.playbackRate.value = 0.7 + ((at * 977) % 1) * 0.6;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(gain, at);
		g.gain.exponentialRampToValueAtTime(0.001, at + dur);
		src.connect(f).connect(g).connect(this.master);
		src.start(at, (at * 0.37) % 1.5);
		src.stop(at + dur + 0.05);
	}

	private thump(
		at: number,
		f0: number,
		f1: number,
		dur: number,
		gain: number,
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const o = ctx.createOscillator();
		o.type = "sine";
		o.frequency.setValueAtTime(f0, at);
		o.frequency.exponentialRampToValueAtTime(f1, at + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(gain, at);
		g.gain.exponentialRampToValueAtTime(0.001, at + dur);
		o.connect(g).connect(this.master);
		o.start(at);
		o.stop(at + dur + 0.05);
	}

	/** Cannon shot. */
	fire(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const t = ctx.currentTime;
		this.thump(t, 120, 38, 0.6, 0.9);
		this.noiseBurst(t, 0.5, 900, 0.7, 0.7);
		this.noiseBurst(t + 0.02, 1.4, 2400, 0.5, 0.12, "bandpass");
	}

	/** A hit; `power` ~0..1. Rate-limited so a collapse is texture, not a wall of noise. */
	impact(power: number, ball: boolean): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const t = ctx.currentTime;
		if (t - this.lastImpact > 0.05) {
			this.lastImpact = t;
			this.impactsThisWindow = 0;
		}
		if (++this.impactsThisWindow > 3 && !ball) return;
		const p = Math.min(1, power);
		if (ball) {
			this.thump(t, 90, 30, 0.9, 1.0);
			this.noiseBurst(t, 0.9, 700, 0.6, 0.9);
			this.noiseBurst(t, 0.25, 3200, 1.2, 0.25, "bandpass");
			return;
		}
		// Stone on stone: a short knock plus a gritty tail.
		this.noiseBurst(
			t,
			0.08 + p * 0.18,
			500 + p * 1500,
			1.4,
			0.08 + p * 0.3,
			"bandpass",
		);
		if (p > 0.5) this.thump(t, 140, 60, 0.25, p * 0.25);
	}

	/** Continuous collapse rumble level 0..1. */
	rumble(level: number): void {
		const g = this.rumbleGain;
		const ctx = this.ctx;
		if (!g || !ctx) return;
		g.gain.setTargetAtTime(Math.min(1, level) * 0.9, ctx.currentTime, 0.12);
	}

	/** Shot result / best shot / UI. */
	chime(best: boolean): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t = ctx.currentTime;
		const notes = best ? [523.25, 659.25, 783.99, 1046.5] : [440, 554.37];
		notes.forEach((f, i) => {
			const o = ctx.createOscillator();
			o.type = "triangle";
			o.frequency.value = f;
			const g = ctx.createGain();
			const at = t + i * 0.09;
			g.gain.setValueAtTime(0, at);
			g.gain.linearRampToValueAtTime(0.18, at + 0.02);
			g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
			o.connect(g).connect(this.master as GainNode);
			o.start(at);
			o.stop(at + 0.7);
		});
	}

	click(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		this.noiseBurst(ctx.currentTime, 0.04, 2500, 2, 0.15, "bandpass");
	}

	/** Charging whine; `k` 0..1 (call each frame while charging; 0 stops it). */
	charge(k: number): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		if (!this.chargeOsc && k > 0) {
			const o = ctx.createOscillator();
			o.type = "sawtooth";
			const f = ctx.createBiquadFilter();
			f.type = "lowpass";
			f.frequency.value = 900;
			const g = ctx.createGain();
			g.gain.value = 0;
			o.connect(f).connect(g).connect(this.master);
			o.start();
			this.chargeOsc = o;
			this.chargeGain = g;
		}
		if (this.chargeOsc && this.chargeGain) {
			this.chargeOsc.frequency.setTargetAtTime(
				70 + k * 160,
				ctx.currentTime,
				0.03,
			);
			this.chargeGain.gain.setTargetAtTime(
				k > 0 ? 0.04 + k * 0.05 : 0,
				ctx.currentTime,
				0.04,
			);
		}
	}
	private chargeOsc: OscillatorNode | null = null;
	private chargeGain: GainNode | null = null;
}
