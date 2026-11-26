import { EV, type EventQueue } from "../events.ts";
import { KIND } from "../rocks.ts";
import type { RockfallSim } from "../sim.ts";

/** Max impact voices started per rendered frame (a rockslide is hundreds of landings). */
const IMPACTS_PER_FRAME = 4;

/**
 * WebAudio-synthesised sound, no files. The AudioContext is created on the first user
 * gesture (never before, so no autoplay warnings). Impacts are filtered noise thumps whose
 * pitch and weight follow rock size, attenuated by distance to the player; a desert wind
 * bed swells with the number of falling rocks.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private windGain: GainNode | null = null;
	private rumbleGain: GainNode | null = null;
	private voices = 0;
	private noiseSeed = 7;
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
		comp.ratio.value = 5;
		const master = ctx.createGain();
		master.gain.value = 0.75;
		master.connect(comp).connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let s = 12345;
		for (let i = 0; i < len; i++) {
			s = (s * 16807) % 2147483647;
			d[i] = (s / 2147483647) * 2 - 1;
		}
		this.noise = buf;
		// Wind bed: band-passed noise with a slow gust LFO.
		const wind = this.noiseSrc();
		const wf = ctx.createBiquadFilter();
		wf.type = "bandpass";
		wf.frequency.value = 420;
		wf.Q.value = 0.6;
		const wg = ctx.createGain();
		wg.gain.value = 0.05;
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 0.13;
		const lg = ctx.createGain();
		lg.gain.value = 180;
		lfo.connect(lg).connect(wf.frequency);
		wind?.connect(wf).connect(wg).connect(master);
		wind?.start();
		lfo.start();
		this.windGain = wg;
		// Rumble bed: low noise, swells with the number of rocks in the air.
		const rum = this.noiseSrc();
		const rf = ctx.createBiquadFilter();
		rf.type = "lowpass";
		rf.frequency.value = 90;
		const rg = ctx.createGain();
		rg.gain.value = 0;
		rum?.connect(rf).connect(rg).connect(master);
		rum?.start();
		this.rumbleGain = rg;
	}

	private now(): number {
		return this.ctx?.currentTime ?? 0;
	}

	private noiseSrc(): AudioBufferSourceNode | null {
		if (!this.ctx || !this.noise) return null;
		const s = this.ctx.createBufferSource();
		s.buffer = this.noise;
		s.loop = true;
		this.noiseSeed = (this.noiseSeed * 16807) % 2147483647;
		s.loopStart = (this.noiseSeed / 2147483647) * 1.5;
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
		g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
		return g;
	}

	/** A stone impact: noise through a low-pass whose cutoff drops with size, plus a sub thump. */
	private thump(size: number, gain: number): void {
		const ctx = this.ctx;
		if (!ctx || !this.master || gain < 0.02) return;
		const t0 = this.now();
		const src = this.noiseSrc();
		const f = ctx.createBiquadFilter();
		f.type = "lowpass";
		f.frequency.value = 2600 / (0.6 + size * 2.2);
		const e = this.env(gain * 0.9, 0.004, 0.12 + size * 0.35, t0);
		if (!src || !e) return;
		src.connect(f).connect(e).connect(this.master);
		src.start(t0);
		src.stop(t0 + 0.6 + size * 0.5);
		if (size > 0.35) {
			const o = ctx.createOscillator();
			o.type = "sine";
			o.frequency.setValueAtTime(110 / (0.5 + size), t0);
			o.frequency.exponentialRampToValueAtTime(32, t0 + 0.25 + size * 0.2);
			const oe = this.env(
				gain * 0.8 * Math.min(1, size),
				0.005,
				0.3 + size * 0.3,
				t0,
			);
			if (oe) {
				o.connect(oe).connect(this.master);
				o.start(t0);
				o.stop(t0 + 0.9);
			}
		}
	}

	private tone(
		freq: number,
		type: OscillatorType,
		peak: number,
		decay: number,
		delay = 0,
		glide = 1,
	): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t0 = this.now() + delay;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(freq, t0);
		if (glide !== 1)
			o.frequency.exponentialRampToValueAtTime(freq * glide, t0 + decay);
		const e = this.env(peak, 0.006, decay, t0);
		if (!e) return;
		o.connect(e).connect(this.master);
		o.start(t0);
		o.stop(t0 + decay + 0.05);
	}

	private whoosh(peak: number): void {
		const ctx = this.ctx;
		if (!ctx || !this.master) return;
		const t0 = this.now();
		const src = this.noiseSrc();
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.Q.value = 2;
		f.frequency.setValueAtTime(400, t0);
		f.frequency.exponentialRampToValueAtTime(2400, t0 + 0.22);
		const e = this.env(peak, 0.05, 0.25, t0);
		if (!src || !e) return;
		src.connect(f).connect(e).connect(this.master);
		src.start(t0);
		src.stop(t0 + 0.4);
	}

	/** Plays one tick's events. */
	handle(ev: EventQueue, sim: RockfallSim): void {
		if (!this.ctx) return;
		for (let i = 0; i < ev.n; i++) {
			const x = ev.x[i] as number;
			const z = ev.z[i] as number;
			const d = Math.hypot(x - sim.px, z - sim.pz);
			const near = 1 / (1 + d * 0.12);
			switch (ev.type[i]) {
				case EV.LAND: {
					if (this.voices >= IMPACTS_PER_FRAME) break;
					const kind = ev.a[i] as number;
					const r = ev.v[i] as number;
					const sp = Math.min(1, (ev.u[i] as number) / 18);
					if (kind === KIND.PEBBLE && d > 9) break;
					this.voices++;
					this.thump(
						r,
						(kind === KIND.PEBBLE ? 0.12 : 0.35 + r * 0.4) * sp * near,
					);
					break;
				}
				case EV.BLAST:
					this.thump(2.2, 0.9 * near + 0.2);
					this.tone(70, "sawtooth", 0.25, 0.8, 0, 0.4);
					break;
				case EV.HIT:
					if ((ev.v[i] as number) > 0)
						this.tone(900, "triangle", 0.3, 0.35, 0, 0.5);
					else {
						this.thump(0.9, 0.7);
						this.tone(160, "square", 0.18, 0.25, 0, 0.5);
					}
					break;
				case EV.NEAR_MISS:
					this.whoosh(0.35);
					this.tone(
						1320 * Math.min(2, (ev.u[i] as number) * 0.6),
						"sine",
						0.08,
						0.18,
						0.05,
					);
					break;
				case EV.PICKUP: {
					const t = ev.a[i] as number;
					const base = t === 0 ? 1046 : t === 1 ? 660 : 523;
					this.tone(base, "triangle", 0.2, 0.25);
					this.tone(base * 1.5, "triangle", 0.16, 0.3, 0.07);
					this.tone(base * 2, "sine", 0.1, 0.4, 0.14);
					break;
				}
				case EV.WAVE_START:
					this.tone(110, "sawtooth", 0.18, 1.2, 0, 1.01);
					this.tone(165, "sawtooth", 0.12, 1.2, 0.02, 1.01);
					break;
				case EV.WAVE_CLEAR:
					this.tone(523, "triangle", 0.15, 0.3);
					this.tone(784, "triangle", 0.15, 0.5, 0.12);
					break;
				case EV.PATTERN:
					this.tone(220, "square", 0.08, 0.15);
					this.tone(220, "square", 0.08, 0.15, 0.2);
					break;
				case EV.JUMP:
					this.whoosh(0.12);
					break;
				case EV.GAME_OVER:
					this.tone(196, "sawtooth", 0.2, 1.6, 0, 0.5);
					this.thump(1.6, 0.8);
					break;
			}
		}
	}

	/** Per frame: resets the impact voice budget and drives the ambience beds. */
	frame(falling: number): void {
		this.voices = 0;
		if (!this.ctx || !this.rumbleGain || !this.windGain) return;
		const t = this.now();
		const r = Math.min(0.35, falling * 0.004);
		this.rumbleGain.gain.setTargetAtTime(r, t, 0.3);
	}
}
