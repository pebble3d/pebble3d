import { EV, type LanternSim } from "../game/sim.ts";

/**
 * WebAudio-synthesised sound, no files. The AudioContext is created on the first gesture (no
 * autoplay warning) and never in fixed mode. Ambience: night wind plus a low drone whose level
 * follows the highest guard suspicion. Cues come from the sim's event ring after each tick.
 */
export class Sfx {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private noise: AudioBuffer | null = null;
	private tension: GainNode | null = null;
	private stepT = 0;

	constructor(readonly enabled: boolean) {
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
		comp.ratio.value = 3;
		const master = ctx.createGain();
		master.gain.value = 0.6;
		master.connect(comp).connect(ctx.destination);
		this.master = master;
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let seed = 4242;
		for (let i = 0; i < len; i++) {
			seed = (seed * 16807) % 2147483647;
			d[i] = (seed / 2147483647) * 2 - 1;
		}
		this.noise = buf;
		// Wind.
		const n = ctx.createBufferSource();
		n.buffer = buf;
		n.loop = true;
		const bp = ctx.createBiquadFilter();
		bp.type = "bandpass";
		bp.frequency.value = 300;
		bp.Q.value = 0.7;
		const wg = ctx.createGain();
		wg.gain.value = 0.06;
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 0.09;
		const la = ctx.createGain();
		la.gain.value = 140;
		lfo.connect(la).connect(bp.frequency);
		n.connect(bp).connect(wg).connect(master);
		n.start();
		lfo.start();
		// Tension drone: two detuned low saws through a low-pass.
		const tg = ctx.createGain();
		tg.gain.value = 0;
		const lp = ctx.createBiquadFilter();
		lp.type = "lowpass";
		lp.frequency.value = 320;
		for (const f of [55, 55.7]) {
			const o = ctx.createOscillator();
			o.type = "sawtooth";
			o.frequency.value = f;
			o.connect(lp);
			o.start();
		}
		lp.connect(tg).connect(master);
		this.tension = tg;
	}

	private tone(
		freq: number,
		dur: number,
		gain: number,
		type: OscillatorType = "sine",
		when = 0,
		slideTo = 0,
	): void {
		const ctx = this.ctx;
		const out = this.master;
		if (!ctx || !out) return;
		const t = ctx.currentTime + when;
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		o.type = type;
		o.frequency.setValueAtTime(freq, t);
		if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(out);
		o.start(t);
		o.stop(t + dur + 0.02);
	}

	private thump(freq: number, gain: number, dur = 0.08): void {
		const ctx = this.ctx;
		const out = this.master;
		if (!ctx || !out || !this.noise) return;
		const t = ctx.currentTime;
		const s = ctx.createBufferSource();
		s.buffer = this.noise;
		const f = ctx.createBiquadFilter();
		f.type = "lowpass";
		f.frequency.value = freq;
		const g = ctx.createGain();
		g.gain.setValueAtTime(gain, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		s.connect(f).connect(g).connect(out);
		s.start(t, (t * 0.37) % 1.5);
		s.stop(t + dur + 0.02);
	}

	/** After each sim tick: play this tick's cues. */
	handle(sim: LanternSim): void {
		if (!this.ctx) return;
		for (let i = 0; i < sim.evCount; i++) {
			switch (sim.evType[i]) {
				case EV.START:
				case EV.RETRY:
					this.tone(196, 0.9, 0.12, "triangle");
					this.tone(294, 0.9, 0.08, "triangle", 0.12);
					break;
				case EV.SPOT:
					this.tone(660, 0.25, 0.1, "triangle", 0, 880);
					break;
				case EV.ALERT:
					this.tone(220, 0.5, 0.22, "sawtooth", 0, 440);
					this.tone(233, 0.5, 0.18, "sawtooth", 0.05, 466);
					break;
				case EV.LOST:
					this.tone(440, 0.6, 0.08, "triangle", 0, 300);
					break;
				case EV.LOOT:
					this.tone(1318, 0.18, 0.1);
					this.tone(1760, 0.3, 0.08, "sine", 0.07);
					break;
				case EV.RELIC:
					for (let k = 0; k < 4; k++)
						this.tone(
							[523, 659, 784, 1046][k] as number,
							1.2,
							0.09,
							"sine",
							k * 0.09,
						);
					break;
				case EV.CAUGHT:
					this.thump(260, 0.6, 0.4);
					this.tone(110, 1.2, 0.2, "sawtooth", 0, 55);
					break;
				case EV.ESCAPED:
					for (let k = 0; k < 5; k++)
						this.tone(
							[392, 494, 587, 784, 988][k] as number,
							1.4,
							0.08,
							"triangle",
							k * 0.12,
						);
					break;
			}
		}
	}

	/** Per frame: soft footsteps while moving, the tension drone level. */
	frame(sim: LanternSim, dt: number): void {
		if (!this.ctx) return;
		const speed = Math.hypot(sim.pvx, sim.pvz);
		if (speed > 0.6 && sim.phase === 1) {
			this.stepT -= dt * (speed > 3.5 ? 3.2 : 1.9);
			if (this.stepT <= 0) {
				this.stepT = 1;
				this.thump(speed > 3.5 ? 900 : 420, speed > 3.5 ? 0.14 : 0.05, 0.05);
			}
		}
		if (this.tension) {
			const target = sim.phase === 1 ? sim.danger * 0.12 : 0;
			const g = this.tension.gain;
			g.value += (target - g.value) * Math.min(1, dt * 3);
		}
	}
}
