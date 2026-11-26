import { type PerspectiveCamera, Vector3 } from "three/webgpu";
import { MAX_HP, STAMINA_MAX, WAVE_TICKS } from "../constants.ts";
import { EV, type EventQueue } from "../events.ts";
import { PHASE } from "../phase.ts";
import { PICKUP, type RockfallSim } from "../sim.ts";
import { PATTERN_CALLOUTS, waveName } from "../waves.ts";

const POP_POOL = 24;
const POP_LIFE = 1.1;

interface Pop {
	el: HTMLElement;
	age: number;
	x: number;
	y: number;
	z: number;
}

/** Engine numbers shown top right (sampled by main every few frames). */
export interface EngineStats {
	active: number;
	sleeping: number;
	build: string;
	fps: number;
	/** Fixed-tick capture mode: frame rate is the capture's, not the game's, so hide it. */
	fixed: boolean;
	physicsMs: number;
}

const _v = new Vector3();

function el(
	tag: string,
	cls: string,
	parent: HTMLElement,
	html = "",
): HTMLElement {
	const e = document.createElement(tag);
	e.className = cls;
	if (html) e.innerHTML = html;
	parent.append(e);
	return e;
}

/**
 * Framework-free DOM HUD. Reads the sim every frame but writes the DOM only when a shown
 * value changes; bars move by `transform`. Floating popups are a fixed pool.
 */
export class Hud {
	private readonly root: HTMLElement;
	private readonly sim: RockfallSim;
	private readonly camera: PerspectiveCamera;
	private readonly waveBig: HTMLElement;
	private readonly waveName: HTMLElement;
	private readonly waveBar: HTMLElement;
	private readonly score: HTMLElement;
	private readonly mult: HTMLElement;
	private readonly bodies: HTMLElement;
	private readonly bodySub: HTMLElement;
	private readonly hpNum: HTMLElement;
	private readonly hpBar: HTMLElement;
	private readonly hpLag: HTMLElement;
	private readonly stam: HTMLElement;
	private readonly shieldTag: HTMLElement;
	private readonly banner: HTMLElement;
	private readonly bannerK: HTMLElement;
	private readonly bannerT: HTMLElement;
	private readonly callout: HTMLElement;
	private readonly vignette: HTMLElement;
	private readonly lowhp: HTMLElement;
	private readonly title: HTMLElement;
	private readonly over: HTMLElement;
	private readonly overScore: HTMLElement;
	private readonly overStats: HTMLElement;
	private readonly overBest: HTMLElement;
	private readonly titleBest: HTMLElement;
	private readonly pops: Pop[] = [];
	private popNext = 0;
	private cache = new Map<HTMLElement, string>();
	private bannerT0 = -1;
	private calloutT = 0;
	private vig = 0;
	private multPop = 0;
	private t = 0;
	private nearPop: Pop | null = null;
	private nearT = -1;
	private nearN = 0;
	private nearPts = 0;
	peakBodies = 0;
	best = 0;

	constructor(root: HTMLElement, sim: RockfallSim, camera: PerspectiveCamera) {
		this.root = root;
		this.sim = sim;
		this.camera = camera;
		this.vignette = el("div", "vignette", root);
		this.lowhp = el("div", "lowhp", root);

		const wave = el("div", "plate wave play-only", root);
		el("div", "label", wave, "Wave");
		this.waveBig = el("div", "big num", wave, "1");
		this.waveName = el("div", "name", wave);
		this.waveBar = el("i", "", el("div", "bar", wave));

		const score = el("div", "score play-only", root);
		this.score = el("div", "big num", score, "0");
		this.mult = el("div", "mult num", score, "×1.0");

		const eng = el("div", "plate engine", root);
		el("div", "label", eng, "Live rigid bodies");
		this.bodies = el("div", "big num", eng, "0");
		this.bodySub = el("div", "sub", eng);

		const vit = el("div", "plate vitals play-only", root);
		const row = el("div", "row", vit);
		el("div", "label", row, "Hull");
		this.shieldTag = el("div", "shield-tag", row, "◆ Shield");
		this.hpNum = el("div", "hp-num num", row, "100");
		const hp = el("div", "bar hp", vit);
		this.hpLag = el("i", "lag", hp);
		this.hpBar = el("i", "", hp);
		this.stam = el("i", "", el("div", "bar stam", vit));

		this.banner = el("div", "banner", root);
		this.bannerK = el("div", "k", this.banner);
		this.bannerT = el("div", "t", this.banner);
		this.callout = el("div", "callout", root);

		for (let i = 0; i < POP_POOL; i++) {
			const p = el("div", "pop", root);
			p.style.opacity = "0";
			this.pops.push({ el: p, age: POP_LIFE, x: 0, y: 0, z: 0 });
		}

		this.title = el("div", "screen", root);
		el("div", "logo", this.title, "Rock<br>fall");
		el(
			"div",
			"tag",
			this.title,
			"The quarry walls are coming down. Read the shadows, dodge the stones, grab the crystals &mdash; and stay standing.",
		);
		el("div", "cta", this.title, "Press Space or click to start");
		el(
			"div",
			"keys",
			this.title,
			"<span><kbd>WASD</kbd> move</span><span><kbd>Shift</kbd> sprint</span><span><kbd>Space</kbd> jump</span><span>Push through the rubble</span>",
		);
		this.titleBest = el("div", "best", this.title);
		this.titleBest.style.marginTop = "22px";

		this.over = el("div", "screen", root);
		el("div", "logo small", this.over, "Buried");
		el("div", "label", this.over, "Final score");
		this.overScore = el("div", "final", this.over, "0");
		this.overBest = el("div", "best", this.over);
		this.overStats = el("div", "results", this.over);
		el("div", "cta", this.over, "Press Space to dig out again");
		try {
			this.best = Number(localStorage.getItem("rockfall.best") ?? 0) || 0;
		} catch {
			this.best = 0;
		}
	}

	private set(e: HTMLElement, v: string): void {
		if (this.cache.get(e) === v) return;
		this.cache.set(e, v);
		e.textContent = v;
	}

	private setHtml(e: HTMLElement, v: string): void {
		if (this.cache.get(e) === v) return;
		this.cache.set(e, v);
		e.innerHTML = v;
	}

	private setStyle(e: HTMLElement, v: string): void {
		const key = `__s${v}`;
		if ((e as unknown as { _s?: string })._s === key) return;
		(e as unknown as { _s?: string })._s = key;
		e.style.transform = v;
	}

	private showBanner(k: string, t: string): void {
		this.set(this.bannerK, k);
		this.set(this.bannerT, t);
		this.banner.classList.add("show");
		this.bannerT0 = this.t;
	}

	private showCallout(text: string): void {
		this.set(this.callout, text);
		this.callout.classList.remove("show");
		void this.callout.offsetWidth;
		this.callout.classList.add("show");
		this.calloutT = 1.6;
	}

	private pop(cls: string, html: string, x: number, y: number, z: number): Pop {
		const p = this.pops[this.popNext] as Pop;
		this.popNext = (this.popNext + 1) % POP_POOL;
		p.el.className = `pop ${cls}`;
		p.el.innerHTML = html;
		p.age = 0;
		p.x = x;
		p.y = y;
		p.z = z;
		return p;
	}

	/** Reacts to one tick's events. */
	handle(ev: EventQueue): void {
		const sim = this.sim;
		// The title's attract rain and the results screen's rain stay silent.
		if (sim.phase === PHASE.TITLE || sim.phase === PHASE.OVER) {
			for (let i = 0; i < ev.n; i++)
				if (ev.type[i] === EV.GAME_OVER) this.endRun();
			return;
		}
		let nearN = 0;
		let nearPts = 0;
		let nearMult = 1;
		for (let i = 0; i < ev.n; i++) {
			const x = ev.x[i] as number;
			const y = ev.y[i] as number;
			const z = ev.z[i] as number;
			switch (ev.type[i]) {
				case EV.COUNTDOWN:
					this.showBanner("Get ready", "Rocks incoming");
					break;
				case EV.WAVE_START:
					this.showBanner(`Wave ${ev.a[i]}`, waveName(ev.a[i] as number));
					break;
				case EV.WAVE_CLEAR:
					this.showBanner(`Wave ${ev.a[i]} survived`, `+${ev.u[i]}`);
					break;
				case EV.PATTERN: {
					const c = PATTERN_CALLOUTS[ev.a[i] as number];
					if (c) this.showCallout(`${c}!`);
					break;
				}
				case EV.NEAR_MISS:
					// Several in one tick (a ring of rocks) merge into one popup.
					nearN++;
					nearPts += ev.a[i] as number;
					nearMult = ev.u[i] as number;
					break;
				case EV.PICKUP: {
					const t = ev.a[i] as number;
					const u = ev.u[i] as number;
					if (t === PICKUP.CRYSTAL) this.pop("gem", `◆ +${u}`, x, y + 0.6, z);
					else if (t === PICKUP.HEART)
						this.pop("heal", `+${u} hull`, x, y + 0.6, z);
					else this.pop("shield", "Shield up", x, y + 0.6, z);
					break;
				}
				case EV.HIT:
					if ((ev.v[i] as number) > 0) {
						this.pop("shield", "Shield broke", sim.px, sim.py + 1.3, sim.pz);
						this.vig = Math.max(this.vig, 0.35);
					} else {
						this.pop("hurt", `-${ev.u[i]}`, sim.px, sim.py + 1.3, sim.pz);
						this.vig = Math.max(
							this.vig,
							Math.min(1, (ev.u[i] as number) / 25),
						);
					}
					break;
				case EV.GAME_OVER:
					this.endRun();
					break;
			}
		}
		if (nearN > 0) {
			// Near misses within half a second form one streak: the same popup counts up.
			const streak = this.t - this.nearT < 0.5 && this.nearPop !== null;
			this.nearT = this.t;
			this.nearN = (streak ? this.nearN : 0) + nearN;
			this.nearPts = (streak ? this.nearPts : 0) + nearPts;
			const label = this.nearN > 1 ? `CLOSE ×${this.nearN}` : "CLOSE";
			const html = `${label} +${this.nearPts}<small>×${nearMult.toFixed(1)}</small>`;
			if (streak && this.nearPop) {
				this.nearPop.el.innerHTML = html;
				this.nearPop.age = Math.min(this.nearPop.age, 0.2);
			} else
				this.nearPop = this.pop("near", html, sim.px, sim.py + 1.3, sim.pz);
			this.multPop = 0.15;
		}
	}

	private endRun(): void {
		const sim = this.sim;
		const newBest = sim.score > this.best;
		if (newBest) {
			this.best = sim.score;
			try {
				localStorage.setItem("rockfall.best", String(sim.score));
			} catch {
				/* storage unavailable: best lives for this page only */
			}
		}
		this.set(this.overScore, sim.score.toLocaleString("en-US"));
		this.set(
			this.overBest,
			newBest ? "New best" : `Best ${this.best.toLocaleString("en-US")}`,
		);
		const secs = sim.survived / 60;
		const time = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
		this.setHtml(
			this.overStats,
			[
				["Reached", `wave ${sim.wave}`],
				["Survived", time],
				["Close calls", String(sim.nearMisses)],
				["Crystals", String(sim.crystals)],
				["Peak bodies", this.peakBodies.toLocaleString("en-US")],
			]
				.map(([l, v]) => `<div class="l">${l}</div><div class="v">${v}</div>`)
				.join(""),
		);
	}

	update(dt: number, eng: EngineStats): void {
		this.t += dt;
		const sim = this.sim;
		const menu = sim.phase === PHASE.TITLE || sim.phase === PHASE.OVER;
		this.root.classList.toggle("menu", menu);
		this.title.classList.toggle("show", sim.phase === PHASE.TITLE);
		this.over.classList.toggle(
			"show",
			sim.phase === PHASE.OVER && sim.phaseTick > 50,
		);
		if (sim.phase === PHASE.TITLE)
			this.set(
				this.titleBest,
				this.best > 0 ? `Best ${this.best.toLocaleString("en-US")}` : "",
			);

		this.set(this.waveBig, String(Math.max(1, sim.wave)));
		this.set(
			this.waveName,
			sim.phase === PHASE.COUNTDOWN
				? "Get ready"
				: waveName(Math.max(1, sim.wave)),
		);
		const wt =
			sim.phase === PHASE.WAVE
				? sim.phaseTick / WAVE_TICKS
				: sim.phase === PHASE.BREATHER
					? 1
					: 0;
		this.setStyle(this.waveBar, `scaleX(${wt.toFixed(3)})`);
		this.set(this.score, sim.score.toLocaleString("en-US"));
		this.set(this.mult, `×${sim.mult.toFixed(1)}`);
		this.mult.classList.toggle("dead", sim.mult <= 1);
		this.multPop = Math.max(0, this.multPop - dt);
		this.mult.classList.toggle("bump", this.multPop > 0);

		const total = eng.active + eng.sleeping;
		this.peakBodies = Math.max(this.peakBodies, total);
		this.set(this.bodies, total.toLocaleString("en-US"));
		this.setHtml(
			this.bodySub,
			`<b>${eng.active}</b> awake · <b>${eng.sleeping}</b> asleep · ${eng.build}<br><b>${eng.physicsMs.toFixed(1)}</b> ms sim/tick · ${eng.fixed ? "fixed-tick capture" : `<b>${Math.round(eng.fps)}</b> fps`}`,
		);

		const hp = sim.hp / MAX_HP;
		this.set(this.hpNum, String(Math.ceil(sim.hp)));
		this.setStyle(this.hpBar, `scaleX(${hp.toFixed(3)})`);
		this.setStyle(this.hpLag, `scaleX(${hp.toFixed(3)})`);
		this.setStyle(
			this.stam,
			`scaleX(${(sim.stamina / STAMINA_MAX).toFixed(3)})`,
		);
		this.shieldTag.classList.toggle("on", sim.shield);
		this.lowhp.style.opacity =
			!menu && hp < 0.3 ? String(0.6 + 0.4 * Math.sin(this.t * 6)) : "0";

		if (this.bannerT0 >= 0 && this.t - this.bannerT0 > 2.4) {
			this.banner.classList.remove("show");
			this.bannerT0 = -1;
		}
		if (sim.phase === PHASE.COUNTDOWN) {
			const left = Math.ceil((150 - sim.phaseTick) / 50);
			if (left > 0 && left <= 3) {
				this.set(this.bannerK, "Get ready");
				this.set(this.bannerT, String(left));
				this.banner.classList.add("show");
				this.bannerT0 = this.t;
			}
		}
		if (this.calloutT > 0) {
			this.calloutT -= dt;
			if (this.calloutT <= 0) this.callout.classList.remove("show");
		}
		this.vig = Math.max(0, this.vig - dt * 1.8);
		this.vignette.style.opacity = this.vig.toFixed(3);

		const w = window.innerWidth;
		const h = window.innerHeight;
		for (const p of this.pops) {
			if (p.age >= POP_LIFE) continue;
			p.age += dt;
			const k = p.age / POP_LIFE;
			_v.set(p.x, p.y + k * 1.2, p.z).project(this.camera);
			const sx = (_v.x * 0.5 + 0.5) * w;
			const sy = (-_v.y * 0.5 + 0.5) * h;
			p.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${(1 + (1 - Math.min(1, k * 6)) * 0.4).toFixed(3)})`;
			p.el.style.opacity = (k < 0.7 ? 1 : (1 - k) / 0.3).toFixed(3);
		}
	}
}
