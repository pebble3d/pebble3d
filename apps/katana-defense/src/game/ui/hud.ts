import type { PerspectiveCamera } from "three/webgpu";
import { Vector3 } from "three/webgpu";
import { COMBO_TIMEOUT, FOCUS_MAX } from "../constants.ts";
import { PHASE } from "../phase.ts";
import type { GameSim } from "../sim.ts";
import { UPGRADES } from "../upgrades.ts";
import { waveComposition } from "../waves/director.ts";

const DMG_POOL = 28;
const DMG_LIFE = 0.75;
const NAMES: Record<string, string> = {
	shambler: "Shamblers",
	runner: "Runners",
	brute: "Brutes",
};

interface Dmg {
	el: HTMLElement;
	age: number;
	x: number;
	y: number;
	z: number;
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
 * Framework-free DOM HUD over the canvas. Reads the sim every frame but only touches the
 * DOM when a displayed value changes (cached), bars move by `transform` only.
 */
export class Hud {
	private readonly root: HTMLElement;
	private readonly sim: GameSim;
	private readonly waveBig: HTMLElement;
	private readonly waveSub: HTMLElement;
	private readonly gate: HTMLElement;
	private readonly gateBar: HTMLElement;
	private readonly gateLag: HTMLElement;
	private readonly gatePct: HTMLElement;
	private readonly scoreBig: HTMLElement;
	private readonly mult: HTMLElement;
	private readonly player: HTMLElement;
	private readonly hpBar: HTMLElement;
	private readonly hpLag: HTMLElement;
	private readonly hpNum: HTMLElement;
	private readonly focus: HTMLElement;
	private readonly focusBar: HTMLElement;
	private readonly dashPip: HTMLElement;
	private readonly combo: HTMLElement;
	private readonly comboN: HTMLElement;
	private readonly comboTimer: HTMLElement;
	private readonly comboMove: HTMLElement;
	private readonly banner: HTMLElement;
	private readonly bannerT: HTMLElement;
	private readonly bannerS: HTMLElement;
	private readonly bannerCount: HTMLElement;
	private readonly picker: HTMLElement;
	private readonly cards: HTMLElement[] = [];
	private readonly title: HTMLElement;
	private readonly end: HTMLElement;
	private readonly vignette: HTMLElement;
	private readonly popup: HTMLElement;
	private readonly dmg: Dmg[] = [];
	private dmgNext = 0;
	private cache: Record<string, string | number> = {};
	private bannerT0 = -1;
	private bannerHold = 0;
	private hurtT = 0;
	private popupT = 0;
	private struckT = 0;
	private moveT = 0;
	private bumpT = 0;
	private time = 0;
	private lastPhase = -1;

	constructor(
		root: HTMLElement,
		sim: GameSim,
		opts: {
			demo: boolean;
			onPick: (slot: number) => void;
			onStart: () => void;
		},
	) {
		this.root = root;
		this.sim = sim;
		root.textContent = "";

		const w = el("div", "plate wave", root);
		el("div", "label", w, "Wave");
		this.waveBig = el("div", "big num", w);
		this.waveSub = el("div", "sub", w);

		this.gate = el("div", "plate gate", root);
		const gr = el("div", "row", this.gate);
		el("div", "label", gr, `${sim.arena.objective.name} integrity`);
		this.gatePct = el("div", "pct", gr);
		const gb = el("div", "bar ticks", this.gate);
		this.gateLag = el("i", "lag", gb);
		this.gateBar = el("i", "", gb);

		const s = el("div", "plate score", root);
		el("div", "label", s, "Score");
		this.scoreBig = el("div", "big", s);
		this.mult = el("div", "mult", s);

		this.player = el("div", "plate player", root);
		const hp = el("div", "hp", this.player);
		const hr = el("div", "row", hp);
		el("div", "label", hr, "Ronin");
		this.hpNum = el("div", "num", hr);
		const hb = el("div", "bar", hp);
		this.hpLag = el("i", "lag", hb);
		this.hpBar = el("i", "", hb);
		this.focus = el("div", "focus", this.player);
		const fr = el("div", "row", this.focus);
		el("div", "label", fr, "Focus");
		el("div", "hint", fr, "Hold E · Spin Storm");
		const fb = el("div", "bar", this.focus);
		this.focusBar = el("i", "", fb);
		const dash = el("div", "dash", this.player);
		el("div", "label", dash, "Dodge");
		this.dashPip = el("i", "dash-pip", dash);

		this.combo = el("div", "combo", root);
		this.comboN = el("div", "n", this.combo);
		el("div", "hits", this.combo, "Hits");
		const ct = el("div", "timer", this.combo);
		this.comboTimer = el("i", "timer-fill", ct);
		this.comboMove = el("div", "move", this.combo);

		this.banner = el("div", "banner", root);
		this.bannerT = el("div", "t", this.banner);
		this.bannerS = el("div", "s", this.banner);
		this.bannerCount = el("div", "count", this.banner);

		this.vignette = el("div", "vignette", root);
		this.popup = el("div", "popup", root);
		for (let i = 0; i < DMG_POOL; i++)
			this.dmg.push({
				el: el("div", "dmg", root),
				age: DMG_LIFE,
				x: 0,
				y: 0,
				z: 0,
			});

		this.picker = el("div", "picker", root);
		el("h2", "", this.picker, "Choose a boon");
		el("p", "", this.picker, "The dead regroup. Steel yourself.");
		const cards = el("div", "cards", this.picker);
		for (let i = 0; i < 3; i++) {
			const c = el("button", "card", cards);
			c.addEventListener("click", () => opts.onPick(i));
			this.cards.push(c);
		}

		this.title = el("div", "screen title", root);
		this.title.innerHTML = `
			<div class="kicker">A katana horde-defense</div>
			<h1>Ronin<br/>Outpost</h1>
			<div class="rule"></div>
			<div class="tag">The dead are coming for the hall. One blade, one gate, eight waves until nightfall.</div>
			<button class="go">${opts.demo ? "Demo running" : "Press Enter · Click to begin"}</button>
			<div class="controls">
				<span>Move / sprint</span><b>WASD · Shift</b>
				<span>Light / heavy (hold to charge)</span><b>LMB · RMB  (J · K)</b>
				<span>Dodge (then light: dash-slash)</span><b>Q · double-tap</b>
				<span>Jump (then heavy: plunge)</span><b>Space</b>
				<span>Spin Storm at full Focus</span><b>Hold E</b>
				<span>Launcher</span><b>Light, Light, Heavy</b>
			</div>`;
		this.title
			.querySelector(".go")
			?.addEventListener("click", () => opts.onStart());

		this.end = el("div", "screen end", root);
		if (opts.demo) el("div", "demo-tag", root, "Demo · autoplayer");
	}

	/** True (and records `v`) when the displayed value for `key` changes. */
	private changed(key: string, v: string | number): boolean {
		if (this.cache[key] === v) return false;
		this.cache[key] = v;
		return true;
	}

	private showBanner(title: string, sub: string, hold: number): void {
		this.bannerT.textContent = title;
		this.bannerS.innerHTML = sub;
		this.bannerCount.textContent = "";
		this.banner.classList.add("on");
		this.bannerT0 = this.time;
		this.bannerHold = hold;
	}

	// --- event hooks (called by the presentation) -------------------------------------------

	waveStart(wave: number): void {
		this.showBanner(`Wave ${wave}`, "They come", 2.2);
	}

	preWave(wave: number): void {
		const def = this.sim.waves.waves[wave - 1];
		const comp = def ? waveComposition(def) : {};
		const parts = Object.entries(comp)
			.map(([k, v]) => `<b>${v}</b> ${NAMES[k] ?? k}`)
			.join(" &nbsp;·&nbsp; ");
		this.showBanner(
			`Wave ${wave} / ${this.sim.totalWaves}`,
			`Incoming &nbsp; ${parts}`,
			3.6,
		);
	}

	waveClear(wave: number, bonus: number): void {
		this.showBanner(
			"Wave cleared",
			`Bonus <b>+${bonus}</b> &nbsp;·&nbsp; wave ${wave} of ${this.sim.totalWaves}`,
			3.2,
		);
	}

	hurt(): void {
		this.hurtT = 1;
	}

	gateStruck(): void {
		this.struckT = 0.35;
	}

	perfect(): void {
		this.popup.textContent = "Perfect dodge";
		this.popupT = 0.9;
	}

	focusReady(): void {
		this.popup.textContent = "Focus ready";
		this.popupT = 0.9;
	}

	moveName(name: string): void {
		this.comboMove.textContent = name;
		this.moveT = 1.2;
	}

	damage(
		x: number,
		y: number,
		z: number,
		amount: number,
		heavy: boolean,
	): void {
		const d = this.dmg[this.dmgNext] as Dmg;
		this.dmgNext = (this.dmgNext + 1) % DMG_POOL;
		d.age = 0;
		d.x = x + (Math.random() - 0.5) * 0.4;
		d.y = y;
		d.z = z;
		d.el.textContent = String(Math.round(amount));
		d.el.className = heavy ? "dmg heavy" : "dmg";
	}

	// --- per frame ----------------------------------------------------------------------------

	update(dt: number, camera: PerspectiveCamera, w: number, h: number): void {
		this.time += dt;
		const s = this.sim;
		const p = s.player;
		const ph = s.phase;
		const inRun =
			ph === PHASE.PRE_WAVE ||
			ph === PHASE.WAVE ||
			ph === PHASE.WAVE_CLEAR ||
			ph === PHASE.UPGRADE;
		if (this.changed("chrome", inRun ? 1 : 0))
			this.root.classList.toggle("hud-hidden", !inRun);

		if (this.changed("wave", s.wave)) {
			this.waveBig.innerHTML = `${String(s.wave).padStart(2, "0")}<small> / ${String(s.totalWaves).padStart(2, "0")}</small>`;
		}
		const remaining =
			s.phase === PHASE.WAVE ? s.alive + s.director.remaining : 0;
		const secs = s.phase === PHASE.PRE_WAVE ? Math.ceil(s.phaseT / 60) : 0;
		if (this.changed("remain", remaining * 1000 + secs)) {
			this.waveSub.innerHTML =
				s.phase === PHASE.WAVE
					? `Hostiles <b>${remaining}</b>`
					: s.phase === PHASE.PRE_WAVE
						? `Next wave in <b>${secs}</b>`
						: "Hold the line";
		}

		const o = s.objective;
		const gk = Math.max(0, o.hp / o.maxHp);
		if (this.changed("gate", Math.round(gk * 1000))) {
			this.gateBar.style.transform = `scaleX(${gk})`;
			this.gateLag.style.transform = `scaleX(${gk})`;
			this.gatePct.textContent = `${Math.ceil(gk * 100)}%`;
		}
		this.struckT = Math.max(0, this.struckT - dt);
		if (this.changed("struck", this.struckT > 0 ? 1 : 0))
			this.gate.classList.toggle("struck", this.struckT > 0);

		if (this.changed("score", s.score)) {
			this.scoreBig.textContent = s.score.toLocaleString("en-US");
		}
		const mult = s.multiplier;
		if (this.changed("mult", Math.round(mult * 10))) {
			this.mult.textContent =
				mult > 1.001 ? `x${mult.toFixed(1)} combo bonus` : "";
		}

		const hk = Math.max(0, p.hp / s.mods.maxHp);
		if (this.changed("hp", Math.round(p.hp * 10) + s.mods.maxHp * 100000)) {
			this.hpBar.style.transform = `scaleX(${hk})`;
			this.hpLag.style.transform = `scaleX(${hk})`;
			this.hpNum.textContent = `${Math.ceil(p.hp)} / ${s.mods.maxHp}`;
			this.player.classList.toggle("low", hk < 0.3);
		}
		const fk = p.focus / FOCUS_MAX;
		if (this.changed("focus", Math.round(fk * 200))) {
			this.focusBar.style.transform = `scaleX(${fk})`;
			this.focus.classList.toggle("ready", fk >= 1);
		}
		const dashCd = Math.round(30 * s.mods.dodgeCooldown) || 1;
		const dk = p.dodgeCd > 0 ? 1 - Math.min(1, p.dodgeCd / (dashCd * 1.2)) : 1;
		if (this.changed("dash", Math.round(dk * 20))) {
			this.dashPip.style.transform = `scaleX(${dk})`;
			this.dashPip.style.opacity = dk >= 1 ? "1" : "0.4";
		}

		const combo = s.comboHits;
		if (this.changed("combo", combo)) {
			this.comboN.textContent = String(combo);
			this.combo.classList.toggle("on", combo >= 2);
			if (combo >= 2) this.bumpT = 0.08;
		}
		this.bumpT = Math.max(0, this.bumpT - dt);
		if (this.changed("bump", this.bumpT > 0 ? 1 : 0))
			this.combo.classList.toggle("bump", this.bumpT > 0);
		const tk = s.comboT / COMBO_TIMEOUT;
		if (this.changed("ctimer", Math.round(tk * 60))) {
			this.comboTimer.style.transform = `scaleX(${tk})`;
		}
		this.moveT = Math.max(0, this.moveT - dt);
		if (this.changed("moveOn", this.moveT > 0 ? 1 : 0)) {
			this.comboMove.style.opacity = this.moveT > 0 ? "0.9" : "0";
		}

		// banner lifetime
		if (this.bannerT0 >= 0 && this.time - this.bannerT0 > this.bannerHold) {
			this.banner.classList.remove("on");
			this.bannerT0 = -1;
		}

		// hurt vignette, popup
		this.hurtT = Math.max(0, this.hurtT - dt * 2.2);
		if (this.changed("hurt", Math.round(this.hurtT * 40))) {
			this.vignette.style.opacity = String(this.hurtT);
		}
		this.popupT = Math.max(0, this.popupT - dt);
		if (this.changed("popup", this.popupT > 0 ? 1 : 0))
			this.popup.classList.toggle("on", this.popupT > 0);

		// phase screens
		if (ph !== this.lastPhase) {
			this.lastPhase = ph;
			this.picker.classList.toggle("on", ph === PHASE.UPGRADE);
			if (ph === PHASE.UPGRADE) this.fillCards();
			this.title.classList.toggle("on", ph === PHASE.TITLE);
			const ended = ph === PHASE.GAME_OVER || ph === PHASE.VICTORY;
			if (ended) this.fillEnd(ph === PHASE.VICTORY);
			this.end.classList.toggle("on", ended);
			if (
				ph !== PHASE.PRE_WAVE &&
				ph !== PHASE.WAVE &&
				ph !== PHASE.WAVE_CLEAR
			) {
				this.banner.classList.remove("on");
				this.bannerT0 = -1;
			}
		}

		// floating damage numbers
		for (const d of this.dmg) {
			if (d.age >= DMG_LIFE) continue;
			d.age += dt;
			const k = d.age / DMG_LIFE;
			_v.set(d.x, d.y + k * 0.7, d.z).project(camera);
			if (_v.z > 1 || k >= 1) {
				d.el.style.opacity = "0";
				continue;
			}
			const sx = (_v.x * 0.5 + 0.5) * w;
			const sy = (-_v.y * 0.5 + 0.5) * h;
			const pop = k < 0.12 ? 1 + (0.12 - k) * 4 : 1;
			d.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${pop.toFixed(2)})`;
			d.el.style.opacity = String(k < 0.7 ? 1 : (1 - k) / 0.3);
		}
	}

	private fillCards(): void {
		const s = this.sim;
		for (let i = 0; i < 3; i++) {
			const c = this.cards[i] as HTMLElement;
			const u = UPGRADES[s.offer[i] ?? -1];
			c.style.display = u ? "" : "none";
			if (!u) continue;
			const taken = s.timesTaken(u.id);
			c.innerHTML = `<span class="key">${i + 1}</span><div class="name">${u.name}</div><div class="desc">${u.desc}</div><div class="rank">Rank ${taken + 1} / ${u.max}</div>`;
		}
	}

	private fillEnd(won: boolean): void {
		const s = this.sim;
		const lostGate = s.objective.hp <= 0;
		this.end.classList.toggle("lost", !won);
		const title = won
			? "Nightfall<br/>survived"
			: lostGate
				? "The gate<br/>has fallen"
				: "The ronin<br/>has fallen";
		const kicker = won ? "Victory" : `Overrun on wave ${s.wave}`;
		this.end.innerHTML = `
			<div class="kicker">${kicker}</div>
			<h1>${title}</h1>
			<div class="rule"></div>
			<div class="stats">
				<span class="label">Score</span><span class="label">Kills</span><span class="label">Best combo</span><span class="label">Waves</span>
				<span class="v">${s.score.toLocaleString("en-US")}</span><span class="v">${s.kills}</span><span class="v">${s.maxCombo}</span><span class="v">${won ? s.wave : s.wave - 1} / ${s.totalWaves}</span>
			</div>
			<div class="go">Press Enter · Try again</div>`;
	}
}
