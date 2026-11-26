import { CORE_HP, WAVES } from "../constants.ts";
import { sellValue, TOWERS } from "../defs.ts";
import { EV } from "../events.ts";
import { PHASE } from "../sim.ts";
import { E_STRIDE, H, OFF_EVENTS, OFF_TOWERS, T_STRIDE } from "../snapshot.ts";
import { bannerFor } from "./banner.ts";

export interface HudActions {
	selectType(t: number): void;
	upgrade(): void;
	sell(): void;
	callWave(): void;
	start(): void;
}

export interface PerfInfo {
	/** Main-thread ms per frame (sim batch when inline, view, render submit). */
	cpuMs: number;
	frameMs: number;
	fps: number;
	simMs: number;
	host: string;
	build: string;
	drawCalls: number;
	drawn: number;
}

const ACCENT = ["#58e8ff", "#ffa040", "#9ad8ff", "#c77dff"];
const ICON = ["⚡", "◉", "❄", "❙"];

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls: string,
	parent: HTMLElement,
	text = "",
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	if (text) e.textContent = text;
	parent.append(e);
	return e;
}

/** Writes text only when it changed (no layout churn per frame). */
class Txt {
	private v = "";
	constructor(readonly e: HTMLElement) {}
	set(s: string): void {
		if (s !== this.v) {
			this.v = s;
			this.e.textContent = s;
		}
	}
}

function fmt(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

/** The DOM HUD: status bar, core gauge, perf panel, tower palette, selection card and overlays. */
export class Hud {
	private readonly wave: Txt;
	private readonly status: Txt;
	private readonly gold: Txt;
	private readonly coreFill: HTMLElement;
	private readonly coreTxt: Txt;
	private readonly perf: Txt[] = [];
	private readonly cards: HTMLButtonElement[] = [];
	private readonly sel: HTMLElement;
	private readonly selName: Txt;
	private readonly selInfo: Txt;
	private readonly upBtn: HTMLButtonElement;
	private readonly sellBtn: HTMLButtonElement;
	private readonly callBtn: HTMLButtonElement;
	private readonly title: HTMLElement;
	private readonly result: HTMLElement;
	private readonly resHead: Txt;
	private readonly resBody: Txt;
	private readonly banner: HTMLElement;
	private readonly bannerTxt: Txt;
	private readonly bannerSub: Txt;
	private readonly toast: Txt;
	private bannerT = 0;
	private toastT = 0;
	private lastPhase = -1;
	private chosen = -1;
	private readonly root: HTMLElement;

	/** `stress`: label the endless perf stream instead of waves. */
	private readonly stress: boolean;

	constructor(root: HTMLElement, a: HudActions, stress = false) {
		this.stress = stress;
		this.root = root;
		root.className = "hud";
		const top = el("div", "top", root);
		const left = el("div", "panel status", top);
		el("div", "brand", left, "SWARM SIEGE");
		this.wave = new Txt(el("div", "wave", left));
		this.status = new Txt(el("div", "sub", left));
		const mid = el("div", "panel core", top);
		el("div", "label", mid, "BEACON");
		const bar = el("div", "bar", mid);
		this.coreFill = el("div", "fill", bar);
		this.coreTxt = new Txt(el("div", "corehp", mid));
		const pf = el("div", "panel perf", top);
		const rows = ["agents", "frame", "fps", "cpu", "sim", "draws"];
		const labels = [
			"AGENTS",
			"FRAME",
			"FPS",
			"MAIN CPU",
			"SIM / TICK",
			"DRAW CALLS",
		];
		for (let i = 0; i < rows.length; i++) {
			const r = el("div", `row ${rows[i]}`, pf);
			el("span", "k", r, labels[i]);
			this.perf.push(new Txt(el("span", "v", r)));
		}
		this.perf.push(new Txt(el("div", "host", pf)));

		const bottom = el("div", "bottom", root);
		const g = el("div", "panel gold", bottom);
		el("div", "label", g, "GOLD");
		this.gold = new Txt(el("div", "amount", g));
		const pal = el("div", "palette", bottom);
		TOWERS.forEach((d, i) => {
			const b = el("button", "card", pal);
			b.style.setProperty("--accent", ACCENT[i] as string);
			el("span", "key", b, String(i + 1));
			el("span", "icon", b, ICON[i]);
			el("span", "name", b, d.name);
			el("span", "cost", b, `${d.cost}`);
			el("span", "blurb", b, d.blurb);
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				a.selectType(i);
			});
			this.cards.push(b);
		});
		this.callBtn = el("button", "panel call", bottom, "CALL WAVE ⏎");
		this.callBtn.addEventListener("click", () => a.callWave());

		this.sel = el("div", "panel select", root);
		this.selName = new Txt(el("div", "name", this.sel));
		this.selInfo = new Txt(el("div", "info", this.sel));
		const row = el("div", "btns", this.sel);
		this.upBtn = el("button", "btn up", row);
		this.sellBtn = el("button", "btn sell", row);
		this.upBtn.addEventListener("click", () => a.upgrade());
		this.sellBtn.addEventListener("click", () => a.sell());

		this.banner = el("div", "banner", root);
		this.bannerTxt = new Txt(el("div", "big", this.banner));
		this.bannerSub = new Txt(el("div", "small", this.banner));
		this.toast = new Txt(el("div", "toast", root));

		this.title = el("div", "overlay title", root);
		const card = el("div", "titlecard", this.title);
		el("div", "logo", card, "SWARM SIEGE");
		el("div", "tag", card, "Thousands are coming for the Beacon.");
		el(
			"div",
			"pitch",
			card,
			"Two rifts pour a living tide across the salt flats. Raise Spark, Mortar, Frost and Lance towers on the pads, upgrade them, and hold for twelve waves.",
		);
		const keys = el("div", "keys", card);
		for (const [k, v] of [
			["1-4", "choose tower"],
			["Click", "place / select"],
			["U / X", "upgrade / sell"],
			["Enter", "call next wave"],
			["WASD  Q/E  wheel", "pan  rotate  zoom"],
			["Right drag", "orbit"],
		]) {
			const r = el("div", "k", keys);
			el("b", "", r, k as string);
			el("span", "", r, v as string);
		}
		const go = el("button", "go", card, "BEGIN THE SIEGE");
		go.addEventListener("click", () => a.start());

		this.result = el("div", "overlay result", root);
		const rc = el("div", "titlecard", this.result);
		this.resHead = new Txt(el("div", "logo", rc));
		this.resBody = new Txt(el("div", "pitch", rc));
		const again = el("button", "go", rc, "DEFEND AGAIN");
		again.addEventListener("click", () => a.start());
		// Buttons never take focus, so Space / Enter keep meaning "call wave", not "press it again".
		for (const b of root.querySelectorAll("button"))
			b.addEventListener("mousedown", (e) => e.preventDefault());
	}

	setChosen(t: number): void {
		this.chosen = t;
	}

	flash(msg: string): void {
		this.toast.set(msg);
		this.toastT = 1.6;
	}

	/** Banner / toast reactions to a snapshot's events. */
	handle(snap: Float32Array): void {
		const n = snap[H.EVENTS] as number;
		for (let e = 0; e < n; e++) {
			const o = OFF_EVENTS + e * E_STRIDE;
			const t = snap[o] as number;
			const a = snap[o + 1] as number;
			if (t === EV.WAVE_START || t === EV.WAVE_CLEAR) {
				const b = bannerFor(snap);
				if (b) {
					this.bannerTxt.set(b[0]);
					this.bannerSub.set(b[1]);
					this.bannerT = b[2];
				}
			} else if (t === EV.DENY) {
				this.flash(a === 1 ? "Not enough gold" : "Can't build there");
			}
		}
	}

	update(dt: number, s: Float32Array, selected: number, perf: PerfInfo): void {
		const ph = s[H.PHASE] as number;
		const w = s[H.WAVE] as number;
		const gold = s[H.GOLD] as number;
		if (ph !== this.lastPhase) {
			this.lastPhase = ph;
			this.title.classList.toggle("on", ph === PHASE.TITLE);
			this.root.classList.toggle("menu", ph === PHASE.TITLE);
			this.result.classList.toggle("on", ph === PHASE.WON || ph === PHASE.LOST);
			if (ph === PHASE.WON || ph === PHASE.LOST) {
				this.resHead.set(
					ph === PHASE.WON ? "THE BEACON STANDS" : "THE BEACON HAS FALLEN",
				);
				this.result.classList.toggle("won", ph === PHASE.WON);
			}
		}
		if (ph === PHASE.WON || ph === PHASE.LOST)
			this.resBody.set(
				`Score ${fmt(s[H.SCORE] as number)}   ·   ${fmt(s[H.KILLS] as number)} destroyed   ·   wave ${w} of ${WAVES}   ·   beacon ${Math.max(0, s[H.CORE] as number)} / ${CORE_HP}`,
			);
		if (this.stress) {
			this.wave.set("Stress test");
			this.status.set("Endless looping stream, no casualties");
		} else {
			this.wave.set(
				ph === PHASE.TITLE
					? "Standing by"
					: `Wave ${Math.max(1, ph === PHASE.BUILD ? w + 1 : w)} / ${WAVES}`,
			);
			if (ph === PHASE.BUILD)
				this.status.set(
					`Build phase · next wave in ${Math.ceil((s[H.TIMER] as number) / 60)} s`,
				);
			else if (ph === PHASE.WAVE)
				this.status.set(
					`${fmt(s[H.ALIVE] as number)} on the field · ${fmt(s[H.PENDING] as number)} still to come`,
				);
			else this.status.set(`Score ${fmt(s[H.SCORE] as number)}`);
		}
		const core = Math.max(0, s[H.CORE] as number);
		this.coreFill.style.transform = `scaleX(${core / CORE_HP})`;
		this.coreFill.classList.toggle("low", core < CORE_HP * 0.3);
		this.coreTxt.set(`${core} / ${CORE_HP}`);
		this.gold.set(fmt(gold));
		const p = this.perf;
		p[0]?.set(fmt(s[H.ALIVE] as number));
		p[1]?.set(`${perf.frameMs.toFixed(1)} ms`);
		p[2]?.set(perf.fps.toFixed(0));
		p[3]?.set(`${perf.cpuMs.toFixed(1)} ms`);
		p[4]?.set(`${(s[H.SIM_MS] as number).toFixed(2)} ms`);
		p[5]?.set(String(perf.drawCalls));
		p[6]?.set(
			`sim: ${perf.host} · wasm: ${perf.build} · ${fmt(perf.drawn)} instances`,
		);
		for (let i = 0; i < this.cards.length; i++) {
			const c = this.cards[i] as HTMLButtonElement;
			c.classList.toggle("poor", gold < (TOWERS[i]?.cost ?? 0));
			c.classList.toggle("chosen", this.chosen === i);
		}
		this.callBtn.classList.toggle("on", ph === PHASE.BUILD);
		// Selection card
		if (selected >= 0 && (s[OFF_TOWERS + selected * T_STRIDE] as number) >= 0) {
			const o = OFF_TOWERS + selected * T_STRIDE;
			const ty = s[o] as number;
			const lv = s[o + 1] as number;
			const d = TOWERS[ty];
			this.sel.classList.add("on");
			this.sel.style.setProperty("--accent", ACCENT[ty] as string);
			this.selName.set(`${d?.name ?? ""}  ·  level ${lv}`);
			this.selInfo.set(
				`${fmt(s[o + 6] as number)} kills · range ${d?.range[lv - 1]} m · dmg ${d?.damage[lv - 1]}`,
			);
			const up = s[o + 7] as number;
			this.upBtn.textContent = up < 0 ? "MAX LEVEL" : `UPGRADE (U) · ${up}`;
			this.upBtn.disabled = up < 0 || gold < up;
			let inv = d?.cost ?? 0;
			for (let l = 1; l < lv; l++) inv += d?.upgrade[l - 1] ?? 0;
			this.sellBtn.textContent = `SELL (X) · ${sellValue(inv)}`;
		} else this.sel.classList.remove("on");
		this.bannerT = Math.max(0, this.bannerT - dt);
		this.banner.classList.toggle("on", this.bannerT > 0);
		this.toastT = Math.max(0, this.toastT - dt);
		this.toast.e.classList.toggle("on", this.toastT > 0);
	}
}
