/**
 * Synthesised WebAudio cues (no audio files). The context is created on the first pointer
 * or key press, never at load, and the whole thing is off in fixed mode (captures) or with
 * `?mute=1`. Sound is presentation only: it never feeds back into the sim.
 */
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66];

export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private voices = 0;

	constructor(readonly enabled: boolean) {
		if (!enabled) return;
		const unlock = (): void => {
			if (!this.ctx) {
				this.ctx = new AudioContext();
				this.master = this.ctx.createGain();
				this.master.gain.value = 0.55;
				this.master.connect(this.ctx.destination);
				// Noise from a small LCG (nothing random near sim code).
				const len = this.ctx.sampleRate;
				this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
				const d = this.noise.getChannelData(0);
				let s = 22222;
				for (let i = 0; i < len; i++) {
					s = (s * 1103515245 + 12345) & 0x7fffffff;
					d[i] = (s / 0x7fffffff) * 2 - 1;
				}
			}
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
		};
		window.addEventListener("pointerdown", unlock);
		window.addEventListener("keydown", unlock);
	}

	/** Call once per rendered frame: caps how many impact voices start per frame. */
	frame(): void {
		this.voices = 0;
	}

	private tone(
		freq: number,
		gain: number,
		dur: number,
		type: OscillatorType = "sine",
		delay = 0,
		bend = 1,
	): void {
		const ctx = this.ctx;
		const out = this.master;
		if (!ctx || !out) return;
		const t = ctx.currentTime + delay;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		if (bend !== 1)
			o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(out);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	private hiss(
		gain: number,
		dur: number,
		freq: number,
		q = 1,
		delay = 0,
	): void {
		const ctx = this.ctx;
		const out = this.master;
		if (!ctx || !out || !this.noise) return;
		const t = ctx.currentTime + delay;
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
		src.start(t, (t * 7919) % 0.5);
		src.stop(t + dur + 0.02);
	}

	/** A wooden or stone knock, louder for harder hits. */
	impact(strength: number): void {
		if (this.voices >= 3) return;
		this.voices++;
		const g = Math.min(0.5, 0.06 + strength * 0.05);
		this.tone(180 + strength * 25, g, 0.09, "triangle", 0, 0.6);
		this.hiss(g * 0.6, 0.06, 1800, 2);
	}

	place(): void {
		this.tone(420, 0.22, 0.1, "triangle", 0, 0.7);
		this.hiss(0.12, 0.05, 2500, 3);
	}

	pick(): void {
		this.tone(880, 0.08, 0.05, "sine");
	}

	remove(): void {
		this.hiss(0.2, 0.22, 900, 0.8);
		this.tone(300, 0.1, 0.18, "sine", 0, 0.5);
	}

	play(): void {
		this.tone(392, 0.18, 0.25, "sine", 0);
		this.tone(587.33, 0.18, 0.35, "sine", 0.08);
	}

	rewind(): void {
		this.tone(900, 0.12, 0.3, "sine", 0, 0.35);
		this.hiss(0.1, 0.3, 1200, 1.5);
	}

	goal(): void {
		PENTATONIC.forEach((f, i) => {
			this.tone(f, 0.16, 1.4, "sine", i * 0.09);
			this.tone(f * 2, 0.04, 0.9, "sine", i * 0.09 + 0.01);
		});
	}

	fail(): void {
		this.tone(220, 0.2, 0.6, "triangle", 0, 0.7);
		this.tone(164.8, 0.16, 0.8, "sine", 0.15, 0.8);
	}

	error(): void {
		this.tone(140, 0.2, 0.18, "square", 0, 0.9);
		this.tone(140, 0.18, 0.18, "square", 0.2, 0.9);
	}

	success(): void {
		this.tone(659.25, 0.15, 0.2, "sine");
		this.tone(987.77, 0.15, 0.3, "sine", 0.07);
	}
}
