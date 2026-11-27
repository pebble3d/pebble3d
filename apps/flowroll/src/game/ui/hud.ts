/**
 * The DOM HUD: scoreboard and clock, position banner, both players' panels (grip and gas
 * meters, the moves or counters on their keys), the exchange widget with the timing ring,
 * the submission tension bar, banners, toasts, and the title / results / pause screens.
 * Every setter caches what it last wrote, so a frame that changes nothing touches no DOM.
 */

export type Screen = "title" | "play" | "results" | "pause";

export interface Row {
	key: string;
	label: string;
	note: string;
	off: boolean;
	hot: boolean;
	right: boolean;
}

export interface PanelData {
	title: string;
	sub: string;
	mode: string;
	defending: boolean;
	grip: number;
	gas: number;
	need: number;
	rows: Row[];
	foot: string;
}

export interface MenuItem {
	label: string;
	note: string;
	chip?: string;
}

export interface ResultsData {
	headline: string;
	method: string;
	names: [string, string];
	colors: [string, string];
	/** CPU seats only: the belt label and colour. */
	cpuBelts: [
		{ label: string; color: string } | null,
		{ label: string; color: string } | null,
	];
	points: [number, number];
	adv: [number, number];
	segments: {
		from: number;
		to: number;
		label: string;
		color: string;
		lane: number;
	}[];
	marks: { at: number; text: string; color: string }[];
	total: number;
	legend: { label: string; color: string }[];
	stats: { label: string; value: string }[];
}

const h = (tag: string, cls = "", html = ""): HTMLElement => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (html) e.innerHTML = html;
	return e;
};

class Text {
	private v = "";
	readonly el: HTMLElement;
	constructor(el: HTMLElement) {
		this.el = el;
	}
	set(s: string): void {
		if (s !== this.v) {
			this.v = s;
			this.el.textContent = s;
		}
	}
}
class Html {
	private v = "";
	readonly el: HTMLElement;
	constructor(el: HTMLElement) {
		this.el = el;
	}
	set(s: string): void {
		if (s !== this.v) {
			this.v = s;
			this.el.innerHTML = s;
		}
	}
}
class Style {
	private v = "";
	readonly el: HTMLElement;
	readonly prop: string;
	constructor(el: HTMLElement, prop: string) {
		this.el = el;
		this.prop = prop;
	}
	set(s: string): void {
		if (s !== this.v) {
			this.v = s;
			this.el.style.setProperty(this.prop, s);
		}
	}
}
class Toggle {
	private v: boolean | null = null;
	readonly el: HTMLElement;
	readonly cls: string;
	constructor(el: HTMLElement, cls = "hidden") {
		this.el = el;
		this.cls = cls;
	}
	set(on: boolean): void {
		if (on !== this.v) {
			this.v = on;
			this.el.classList.toggle(this.cls, on);
		}
	}
}

interface PanelEls {
	root: HTMLElement;
	title: Text;
	sub: Text;
	mode: Text;
	modeDef: Toggle;
	grip: Style;
	gas: Style;
	gasLow: Toggle;
	need: Style;
	needShow: Toggle;
	gripNum: Text;
	gasNum: Text;
	rows: Html;
	foot: Html;
}

import { keycap } from "./keycap.ts";

/** The scoreboard and position title end here; floating labels stay below it. */
const HEADER_PX = 160;

export { keycap };

export class Hud {
	private readonly root: HTMLElement;
	private readonly play: HTMLElement;
	private readonly titleEl: HTMLElement;
	private readonly resultsEl: HTMLElement;
	private readonly pauseEl: HTMLElement;
	private readonly names: Text[] = [];
	private readonly belts: Style[] = [];
	private readonly beltSub: Text[] = [];
	private readonly beltChips: { show: Toggle; color: Style }[] = [];
	private readonly pts: Text[] = [];
	private readonly adv: Text[] = [];
	private readonly clock!: Text;
	private readonly clockLow!: Toggle;
	private readonly posName: Text;
	private readonly posRoles: Text;
	private readonly panels: PanelEls[] = [];
	private readonly xch: HTMLElement;
	private readonly xchShow: Toggle;
	private readonly xchName: Text;
	private readonly xchSub: Text;
	private readonly xchHint: Html;
	private readonly xchReading: Toggle;
	private readonly ringOuter: SVGCircleElement;
	private readonly ringTarget: SVGCircleElement;
	private readonly ringKey: SVGTextElement;
	private readonly ringShow: Toggle;
	private readonly subEl: HTMLElement;
	private readonly subShow: Toggle;
	private readonly subName: Text;
	private readonly subTension: Style;
	private readonly subEscape: Style;
	private readonly subLeft: Html;
	private readonly subRight: Html;
	private readonly banner: HTMLElement;
	private readonly bannerShow: Toggle;
	private readonly bannerH: Text;
	private readonly bannerP: Text;
	private readonly bannerScale: Style;
	private readonly toasts: HTMLElement;
	private readonly menu: HTMLElement;
	private readonly tut: HTMLElement;
	private readonly tutShow: Toggle;
	private readonly tutStep: Text;
	private readonly tutH: Text;
	private readonly tutP: Html;
	private readonly labels: {
		el: HTMLElement;
		text: Text;
		x: Style;
		y: Style;
		show: Toggle;
	}[] = [];
	private readonly vignette: HTMLElement | null;
	private screen: Screen | "" = "";
	private sat = "";
	onMenu: ((i: number) => void) | null = null;

	constructor(root: HTMLElement) {
		this.root = root;
		this.vignette = document.getElementById("vignette");
		// ---------- play layer ----------
		this.play = h("div", "layer");
		const board = h("div", "board");
		for (let p = 0; p < 2; p++) {
			const side = h("div", `side ${p ? "right" : "left"}`);
			// the bar is the gi colour (who is who); the belt chip is a separate element,
			// shown only on CPU seats next to "Partner · Blue belt"
			const belt = h("div", "bar-gi");
			const who = h("div", "who");
			const nm = h("b");
			const sm = h("small");
			const chip = h("i", "chip belt-chip");
			const smText = h("span");
			sm.append(chip, smText);
			who.append(nm, sm);
			this.beltChips.push({
				show: new Toggle(sm, "hidden"),
				color: new Style(chip, "background"),
			});
			const pts = h("div", "pts", "0");
			const adv = h("div", "adv");
			side.append(belt, who, pts, adv);
			this.names.push(new Text(nm));
			this.beltSub.push(new Text(smText));
			this.belts.push(new Style(belt, "background"));
			this.pts.push(new Text(pts));
			this.adv.push(new Text(adv));
			if (p === 0) board.append(side);
			else {
				const ck = h("div", "clock", "3:00");
				this.clock = new Text(ck);
				this.clockLow = new Toggle(ck, "low");
				board.append(ck, side);
			}
		}
		const pos = h("div", "pos");
		const pn = h("h2");
		const pr = h("p");
		pos.append(pn, pr);
		this.posName = new Text(pn);
		this.posRoles = new Text(pr);
		this.play.append(board, pos);
		for (let p = 0; p < 2; p++) {
			const el = h("div", `panel p${p + 1}`);
			const h3 = h("h3");
			const t = h("b");
			const s = h("span");
			h3.append(t, s);
			const mode = h("div", "mode");
			const mg = h("div", "meter");
			const gb = h("div", "bar grip");
			const gi = h("i");
			const need = h("div", "need");
			gb.append(gi, need);
			const gn = h("span");
			mg.append(h("span", "", "Grip"), gb, gn);
			const ms = h("div", "meter");
			const sb = h("div", "bar gas");
			const si = h("i");
			sb.append(si);
			const sn = h("span");
			ms.append(h("span", "", "Gas"), sb, sn);
			const rows = h("div", "moves");
			const foot = h("div", "foot");
			el.append(h3, mg, ms, mode, rows, foot);
			this.play.append(el);
			this.panels.push({
				root: el,
				title: new Text(t),
				sub: new Text(s),
				mode: new Text(mode),
				modeDef: new Toggle(mode, "def"),
				grip: new Style(gi, "width"),
				gas: new Style(si, "width"),
				gasLow: new Toggle(sb, "low"),
				need: new Style(need, "left"),
				needShow: new Toggle(need, "hidden"),
				gripNum: new Text(gn),
				gasNum: new Text(sn),
				rows: new Html(rows),
				foot: new Html(foot),
			});
		}
		// exchange widget
		this.xch = h("div", "xch");
		const xn = h("div", "nm");
		const xs = h("div", "sub");
		const xh = h("div", "hint");
		const svgNS = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(svgNS, "svg");
		svg.setAttribute("viewBox", "-50 -50 100 100");
		svg.setAttribute("class", "ring");
		const tgt = document.createElementNS(svgNS, "circle");
		tgt.setAttribute("r", "16");
		tgt.setAttribute("fill", "rgba(240,195,106,0.18)");
		tgt.setAttribute("stroke", "#f0c36a");
		tgt.setAttribute("stroke-width", "3");
		const outer = document.createElementNS(svgNS, "circle");
		outer.setAttribute("r", "46");
		outer.setAttribute("fill", "none");
		outer.setAttribute("stroke", "#f4efe6");
		outer.setAttribute("stroke-width", "3");
		const key = document.createElementNS(svgNS, "text");
		key.setAttribute("text-anchor", "middle");
		key.setAttribute("dominant-baseline", "central");
		key.setAttribute("fill", "#f4efe6");
		key.setAttribute("font-size", "15");
		key.setAttribute("font-weight", "800");
		key.textContent = "J";
		svg.append(tgt, outer, key);
		this.ringOuter = outer;
		this.ringTarget = tgt;
		this.ringKey = key;
		this.xch.append(xs, xn, svg, xh);
		this.xchName = new Text(xn);
		this.xchSub = new Text(xs);
		this.xchHint = new Html(xh);
		this.xchShow = new Toggle(this.xch, "hidden");
		this.xchReading = new Toggle(xn, "reading");
		this.ringShow = new Toggle(svg as unknown as HTMLElement, "hidden");
		this.play.append(this.xch);
		// submission box
		this.subEl = h("div", "subbox");
		const sh = h("h2");
		const tb = h("div", "tension");
		const ti = h("i", "fill");
		tb.append(ti);
		const eb = h("div", "escape");
		const ei = h("i", "fill");
		eb.append(ei);
		const row = h("div", "subrow");
		const sl = h("div");
		const sr = h("div");
		row.append(sl, sr);
		this.subEl.append(sh, tb, eb, row);
		this.subName = new Text(sh);
		this.subTension = new Style(ti, "width");
		this.subEscape = new Style(ei, "width");
		this.subLeft = new Html(sl);
		this.subRight = new Html(sr);
		this.subShow = new Toggle(this.subEl, "hidden");
		this.play.append(this.subEl);
		for (let p = 0; p < 2; p++) {
			const el = h("div", "label");
			this.play.append(el);
			this.labels.push({
				el,
				text: new Text(el),
				x: new Style(el, "left"),
				y: new Style(el, "top"),
				show: new Toggle(el, "hidden"),
			});
		}
		// tutorial card
		this.tut = h("div", "tut");
		const ts = h("div", "step");
		const th = h("h3");
		const tp = h("p");
		const tk = h("div", "skip", `${keycap("Esc")} skip tutorial`);
		this.tut.append(ts, th, tp, tk);
		this.tutStep = new Text(ts);
		this.tutH = new Text(th);
		this.tutP = new Html(tp);
		this.tutShow = new Toggle(this.tut, "hidden");
		this.play.append(this.tut);
		// banners and toasts
		this.banner = h("div", "banner");
		const bh = h("h1");
		const bp = h("p");
		this.banner.append(bh, bp);
		this.bannerH = new Text(bh);
		this.bannerP = new Text(bp);
		this.bannerShow = new Toggle(this.banner, "hidden");
		this.bannerScale = new Style(this.banner, "transform");
		this.toasts = h("div", "toasts");
		this.play.append(this.banner, this.toasts);
		// ---------- title ----------
		this.titleEl = h("div", "screen title");
		const tw = h("div");
		tw.append(
			h("h1", "logo", "FLOW<span>ROLL</span>"),
			h("div", "tag", "Jiu-jitsu, one position at a time"),
		);
		this.menu = h("div", "menu");
		tw.append(this.menu);
		tw.append(
			h(
				"div",
				"helpline",
				`${keycap("W")}${keycap("S")} choose &nbsp; ${keycap("A")}${keycap("D")} belt &nbsp; ${keycap("Enter")} start`,
			),
		);
		this.titleEl.append(tw);
		// ---------- results ----------
		this.resultsEl = h("div", "screen results");
		// ---------- pause ----------
		this.pauseEl = h(
			"div",
			"screen pause",
			`<div><h1 class="logo" style="font-size:64px">PAUSED</h1><div class="helpline">${keycap("Esc")} resume &nbsp; ${keycap("Q")} quit to title</div></div>`,
		);
		root.append(this.play, this.titleEl, this.resultsEl, this.pauseEl);
		this.show("title");
	}

	show(s: Screen): void {
		if (s === this.screen) return;
		this.screen = s;
		this.play.classList.toggle("hidden", s !== "play" && s !== "pause");
		this.titleEl.classList.toggle("hidden", s !== "title");
		this.resultsEl.classList.toggle("hidden", s !== "results");
		this.pauseEl.classList.toggle("hidden", s !== "pause");
		if (s !== "play") this.setVignette(0);
	}

	setMenu(items: MenuItem[], sel: number): void {
		this.menu.innerHTML = "";
		items.forEach((it, i) => {
			const el = h("div", `item${i === sel ? " sel" : ""}`);
			el.append(h("span", "", it.label));
			el.append(
				h(
					"small",
					"",
					`${it.chip ? `<i class="chip" style="background:${it.chip}"></i>` : ""}${it.note}`,
				),
			);
			el.addEventListener("click", () => this.onMenu?.(i));
			this.menu.append(el);
		});
	}

	/** `giColor` fills the bar; `cpuBelt` (CPU seats only) shows "Partner · Blue belt" and its chip. */
	setBoard(
		p: number,
		name: string,
		giColor: string,
		cpuBelt: { label: string; color: string } | null,
		pts: number,
		adv: number,
	): void {
		this.names[p]?.set(name);
		this.belts[p]?.set(giColor);
		const chip = this.beltChips[p];
		chip?.show.set(cpuBelt === null);
		if (cpuBelt) {
			this.beltSub[p]?.set(cpuBelt.label);
			chip?.color.set(cpuBelt.color);
		}
		this.pts[p]?.set(String(pts));
		this.adv[p]?.set(adv > 0 ? `ADV ${adv}` : "");
	}

	setClock(sec: number, untimed: boolean): void {
		const s = Math.ceil(sec);
		this.clock.set(
			untimed
				? "—"
				: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
		);
		this.clockLow.set(!untimed && sec <= 20);
	}

	setPosition(name: string, roles: string): void {
		this.posName.set(name);
		this.posRoles.set(roles);
	}

	/** Only the meters (grip and gas change every frame; the rows do not). */
	setMeters(p: number, grip: number, gas: number): void {
		const e = this.panels[p] as PanelEls;
		e.grip.set(`${(grip * 100).toFixed(1)}%`);
		e.gas.set(`${(gas * 100).toFixed(1)}%`);
		e.gasLow.set(gas < 0.25);
		e.gripNum.set(String(Math.round(grip * 100)));
		e.gasNum.set(String(Math.round(gas * 100)));
	}

	setPanel(p: number, d: PanelData | null): void {
		const e = this.panels[p] as PanelEls;
		e.root.classList.toggle("hidden", d === null);
		if (!d) return;
		e.title.set(d.title);
		e.sub.set(d.sub);
		e.mode.set(d.mode);
		e.modeDef.set(d.defending);
		e.grip.set(`${(d.grip * 100).toFixed(1)}%`);
		e.gas.set(`${(d.gas * 100).toFixed(1)}%`);
		e.gasLow.set(d.gas < 0.25);
		e.needShow.set(d.need <= 0);
		e.need.set(`${(d.need * 100).toFixed(1)}%`);
		e.gripNum.set(String(Math.round(d.grip * 100)));
		e.gasNum.set(String(Math.round(d.gas * 100)));
		let html = "";
		for (const r of d.rows)
			html += `<div class="mv${r.off ? " off" : ""}${r.hot ? " hot" : ""}${r.right ? " right-answer" : ""}">${keycap(r.key)}<span>${r.label}</span><em>${r.note}</em></div>`;
		e.rows.set(html);
		e.foot.set(d.foot);
	}

	setExchange(
		show: boolean,
		x: number,
		y: number,
		sub: string,
		name: string,
		reading: boolean,
		ring: number,
		ringOn: boolean,
		hint: string,
		color: string,
		ringKey = "",
	): void {
		this.xchShow.set(!show);
		if (!show) return;
		this.xch.style.left = `${x.toFixed(0)}px`;
		// anchored by its bottom edge above the attacker's head, but never above the header
		const top = Math.max(HEADER_PX, y - this.xch.offsetHeight);
		this.xch.style.top = `${top.toFixed(0)}px`;
		this.xchSub.set(sub);
		this.xchName.set(name);
		this.xchReading.set(reading);
		this.ringShow.set(!ringOn);
		if (ringOn) {
			const r = 16 + Math.max(0, ring) * 30;
			this.ringOuter.setAttribute("r", r.toFixed(1));
			const near = Math.abs(ring) < 0.18;
			this.ringOuter.setAttribute(
				"stroke",
				ring < -0.3 ? "#777" : near ? "#8fe38a" : "#f4efe6",
			);
			this.ringTarget.setAttribute("stroke", color);
			this.ringKey.textContent = ringKey;
			this.ringKey.setAttribute("font-size", ringKey.length > 2 ? "11" : "15");
		}
		this.xchHint.set(hint);
	}

	setSub(
		show: boolean,
		name: string,
		tension: number,
		escapeP: number,
		left: string,
		right: string,
	): void {
		this.subShow.set(!show);
		if (!show) return;
		this.subName.set(name);
		this.subTension.set(`${(tension * 100).toFixed(1)}%`);
		this.subEscape.set(`${(escapeP * 100).toFixed(1)}%`);
		this.subLeft.set(left);
		this.subRight.set(right);
	}

	setVignette(a: number): void {
		if (!this.vignette) return;
		this.vignette.style.opacity = a.toFixed(3);
		// desaturate the scene as the lock tightens (a canvas filter: no backdrop readback)
		const sat = a > 0.01 ? (1 - Math.min(0.75, a * 0.75)).toFixed(2) : "";
		if (sat !== this.sat) {
			this.sat = sat;
			const c = document.getElementById("app");
			if (c) c.style.filter = sat ? `saturate(${sat})` : "";
		}
		// the backdrop filter costs a full-screen pass: off entirely when unused
		this.vignette.style.display = a > 0.01 ? "block" : "none";
	}

	showBanner(t: string, sub: string, scale = 1): void {
		this.bannerShow.set(false);
		this.bannerH.set(t);
		this.bannerP.set(sub);
		this.bannerScale.set(`translate(-50%,-50%) scale(${scale.toFixed(3)})`);
	}
	hideBanner(): void {
		this.bannerShow.set(true);
	}

	toast(text: string, color = "#f4efe6"): void {
		const t = h("div", "toast");
		t.textContent = text;
		t.style.color = color;
		this.toasts.append(t);
		while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
		setTimeout(() => t.remove(), 2000);
	}
	clearToasts(): void {
		this.toasts.innerHTML = "";
	}

	setTutorial(show: boolean, step = "", title = "", text = ""): void {
		this.tutShow.set(!show);
		if (!show) return;
		this.tutStep.set(step);
		this.tutH.set(title);
		this.tutP.set(text);
	}

	setLabel(
		p: number,
		show: boolean,
		x: number,
		y: number,
		text: string,
		color: string,
	): void {
		const l = this.labels[p];
		if (!l) return;
		l.show.set(!show);
		if (!show) return;
		l.x.set(`${x.toFixed(0)}px`);
		l.y.set(`${y.toFixed(0)}px`);
		l.text.set(text);
		l.el.style.color = color;
	}

	setResults(d: ResultsData): void {
		const r = this.resultsEl;
		r.innerHTML = "";
		const card = h("div", "card");
		card.append(h("h1", "", d.headline), h("div", "how", d.method));
		const fin = h("div", "final");
		const side = (p: number): HTMLElement => {
			const cpu = d.cpuBelts[p];
			const who = `<span style="color:${d.colors[p]}">${d.names[p]}</span>${cpu ? `<small class="cpu-belt"><i class="chip belt-chip" style="background:${cpu.color}"></i>${cpu.label}</small>` : ""}`;
			const bar = `<i class="bar-gi" style="background:${d.colors[p]}"></i>`;
			const big = `<span class="big">${d.points[p]}</span>`;
			const adv = `<span class="adv">${d.adv[p] ? `ADV ${d.adv[p]}` : ""}</span>`;
			return h(
				"div",
				`s${p ? " r" : ""}`,
				p === 0
					? `${bar}<span class="who">${who}</span>${big}${adv}`
					: `${adv}${big}<span class="who">${who}</span>${bar}`,
			);
		};
		fin.append(side(0), h("div", "vs", "POINTS"), side(1));
		card.append(
			fin,
			h(
				"div",
				"tl-h",
				"The roll, position by position (lane = who was on top)",
			),
		);
		const tl = h("div", "tl");
		for (const lane of [0, 1]) {
			const l = h("div", "lane");
			l.style.top = `${lane * 34}px`;
			tl.append(l);
			const tag = h("div", "lane-tag", d.names[lane] as string);
			tag.style.top = `${lane * 34 + 8}px`;
			tag.style.color = d.colors[lane] as string;
			tl.append(tag);
		}
		const pct = (t: number): string =>
			`${((t / Math.max(1, d.total)) * 100).toFixed(2)}%`;
		for (const s of d.segments) {
			const e = h(
				"div",
				"seg",
				(s.to - s.from) / d.total > 0.07 ? s.label : "",
			);
			e.style.left = pct(s.from);
			e.style.width = `calc(${pct(s.to - s.from)} - 1px)`;
			e.style.top = `${s.lane * 34}px`;
			e.style.background = s.color;
			e.title = s.label;
			tl.append(e);
		}
		for (const m of d.marks) {
			const e = h("div", "mark", m.text);
			e.style.left = pct(m.at);
			e.style.color = m.color;
			tl.append(e);
		}
		card.append(tl);
		const lg = h("div", "legend");
		for (const it of d.legend)
			lg.append(
				h(
					"span",
					"",
					`<i class="chip" style="background:${it.color}"></i>${it.label}`,
				),
			);
		card.append(lg);
		const st = h("div", "stats");
		for (const s of d.stats)
			st.append(h("div", "stat", `<b class="v">${s.value}</b>${s.label}`));
		card.append(st);
		card.append(
			h(
				"div",
				"helpline",
				`${keycap("Enter")} rematch &nbsp; ${keycap("Esc")} title`,
			),
		);
		r.append(card);
	}
}
