import type { Course } from "../courses.ts";
import { SKIN_LABEL, SKINS, type Skin } from "../view/marbles.ts";

export type GhostMode = "best" | "par" | "off";

export interface HudHandlers {
	onStart(): void;
	onCourse(id: string): void;
	onSkin(s: Skin): void;
	onGhostMode(m: GhostMode): void;
	onRetry(): void;
	onNext(): void;
	onMenu(): void;
}

export interface ResultsData {
	time: number;
	medal: 0 | 1 | 2 | 3; // 0 gold .. 3 none
	newBest: boolean;
	ghostLabel: string | null;
	ghostTime: number | null;
	splits: number[];
	ghostSplits: number[] | null;
	respawns: number;
	verify: {
		ok: boolean;
		ticks: number;
		hash: string;
		ms: number;
		bytes: number;
	} | null;
	hasNext: boolean;
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const MEDAL_NAMES = ["gold", "silver", "bronze", "none"] as const;

/** mm:ss.cc */
export function fmtTime(t: number): string {
	if (!(t >= 0)) return "--:--.--";
	const cs = Math.floor(t * 100 + 1e-6);
	const m = Math.floor(cs / 6000);
	const s = Math.floor(cs / 100) % 60;
	const c = cs % 100;
	return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

export function fmtDelta(d: number): string {
	const cs = Math.round(d * 100);
	if (cs === 0) return "±0.00";
	return `${cs < 0 ? "−" : "+"}${(Math.abs(cs) / 100).toFixed(2)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls: string,
	parent?: HTMLElement,
	text?: string,
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	parent?.append(e);
	return e;
}

/**
 * DOM HUD: title (course cards, marble, ghost mode), race overlay and results. Per-frame
 * setters only touch the DOM when a shown value changes, and the clock and speed are
 * per-digit spans fed from a constant digit table (no string building every frame).
 */
export class Hud {
	readonly root: HTMLElement;
	private readonly h: HudHandlers;
	private readonly raceEl: HTMLElement;
	private readonly titleEl: HTMLElement;
	private readonly resultsEl: HTMLElement;
	private readonly clockDigits: HTMLElement[] = [];
	private readonly speedDigits: HTMLElement[] = [];
	private readonly speedBar: HTMLElement;
	private readonly splitEl: HTMLElement;
	private readonly countEl: HTMLElement;
	private readonly flashEl: HTMLElement;
	private readonly pips: HTMLElement[] = [];
	private readonly medalRows: HTMLElement[] = [];
	private readonly ghostTag: HTMLElement;
	private readonly ghostName: HTMLElement;
	private readonly ghostGap: HTMLElement;
	private readonly ghostMeta: HTMLElement;
	private readonly cards: HTMLElement[] = [];
	private readonly skinEls: HTMLElement[] = [];
	private readonly skinName: HTMLElement;
	private readonly modeBtns: HTMLButtonElement[] = [];
	private lastCs = -1;
	private lastKmh = -1;
	private lastFrac = -1;
	private lastPips = -1;
	private lastLost = -1;
	private lastGap = Number.NaN;
	private lastCount: string | null = null;
	private splitTimer = 0;
	private readonly medals: number[];

	constructor(
		root: HTMLElement,
		courses: Course[],
		current: Course,
		skin: Skin,
		mode: GhostMode,
		bests: Record<string, number | null>,
		h: HudHandlers,
	) {
		this.root = root;
		this.h = h;
		root.style.setProperty("--accent", current.look.accent);
		this.medals = [
			current.medals.gold,
			current.medals.silver,
			current.medals.bronze,
		];

		// ---- race ----
		const race = el("div", "race hidden", root);
		this.raceEl = race;
		const timer = el("div", "timer", race);
		const clock = el("div", "clock num", timer);
		// m : s s . c c
		const mk = (cls = ""): HTMLElement => {
			const s = el("span", cls, clock, "0");
			this.clockDigits.push(s);
			return s;
		};
		mk();
		el("span", "", clock, ":");
		mk();
		mk();
		const cs = el("span", "cs", clock);
		cs.append(".");
		for (let k = 0; k < 2; k++) {
			const s = el("span", "", cs, "0");
			this.clockDigits.push(s);
		}
		el("br", "", timer);
		this.splitEl = el("div", "split num", timer, "");
		const tag = el("div", "course-tag panel", race);
		el("div", "label", tag, "Course");
		el("div", "name", tag, current.name);
		const pips = el("div", "pips", tag);
		for (
			let k = 0;
			k <= current.track.segments.filter((s) => s.checkpoint).length;
			k++
		)
			this.pips.push(el("div", "pip", pips));
		const med = el("div", "medals panel", race);
		el("div", "label", med, "Targets");
		MEDAL_NAMES.slice(0, 3).forEach((m, k) => {
			const r = el("div", "medal-row", med);
			el("span", `dot ${m}`, r);
			el("span", "", r, m[0]?.toUpperCase() + m.slice(1));
			el("span", "t num", r, fmtTime(this.medals[k] as number));
			this.medalRows.push(r);
		});
		const sp = el("div", "speedo", race);
		const v = el("div", "", sp);
		const vv = el("span", "v num", v);
		for (let k = 0; k < 3; k++) this.speedDigits.push(el("span", "", vv, "0"));
		el("span", "u", v, "KM/H");
		const bar = el("div", "bar", sp);
		this.speedBar = el("i", "", bar);
		this.ghostTag = el("div", "ghost-tag panel", race);
		const gr = el("div", "row", this.ghostTag);
		el("span", "gdot", gr);
		this.ghostName = el("span", "", gr, "Ghost");
		this.ghostGap = el("span", "gap num", gr, "");
		this.ghostMeta = el("div", "meta", this.ghostTag, "");
		const keys = el("div", "keys", race);
		keys.innerHTML =
			"<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> tilt &nbsp; <kbd>Space</kbd> hop<br><kbd>Shift</kbd> brake &nbsp; <kbd>R</kbd> retry &nbsp; <kbd>Esc</kbd> menu";
		this.countEl = el("div", "count num", root);
		this.flashEl = el("div", "flash", root);

		// ---- title ----
		const title = el("div", "title", root);
		this.titleEl = title;
		const top = el("div", "", title);
		const logo = el("div", "logo", top);
		logo.innerHTML = `<span class="g">GHOST</span>LINE`;
		el(
			"div",
			"sub",
			top,
			"A marble time-trial where your best run comes back as a ghost — re-simulated tick by tick from its seed and inputs, never replayed from a recording.",
		);
		const cards = el("div", "cards", top);
		courses.forEach((c, k) => {
			const card = el(
				"div",
				`card panel${c.id === current.id ? " sel" : ""}`,
				cards,
			);
			el("div", "n", card, `COURSE ${k + 1}`);
			el("div", "cn", card, c.name);
			el("div", "tg", card, c.tagline);
			const times = el("div", "times num", card);
			MEDAL_NAMES.slice(0, 3).forEach((m) => {
				el("span", `dot ${m}`, times);
				el(
					"span",
					"",
					times,
					(c.medals as Record<string, number>)[m]?.toFixed(1),
				);
			});
			const best = bests[c.id];
			const b = el("div", "best num", card);
			b.innerHTML = best
				? `Your best <b>${fmtTime(best)}</b>`
				: `<span style="opacity:.6">No ghost yet</span>`;
			card.addEventListener("click", () => this.h.onCourse(c.id));
			this.cards.push(card);
		});
		const row2 = el("div", "row2", top);
		const sk = el("div", "", row2);
		el("div", "label", sk, "Marble");
		const skins = el("div", "skins", sk);
		for (const s of SKINS) {
			const e = el("div", `skin ${s}${s === skin ? " sel" : ""}`, skins);
			e.addEventListener("click", () => this.h.onSkin(s));
			this.skinEls.push(e);
		}
		this.skinName = el("div", "skin-name", sk, SKIN_LABEL[skin]);
		const gm = el("div", "", row2);
		el("div", "label", gm, "Race against");
		const seg = el("div", "seg", gm);
		(["best", "par", "off"] as GhostMode[]).forEach((m) => {
			const b = el(
				"button",
				m === mode ? "sel" : "",
				seg,
				m === "best" ? "Your best" : m === "par" ? "Par ghost" : "No ghost",
			);
			b.addEventListener("click", () => this.h.onGhostMode(m));
			this.modeBtns.push(b);
		});
		const go = el("button", "go", top, "ROLL OUT  ⏎");
		go.addEventListener("click", () => this.h.onStart());
		el("div", "foot", title).innerHTML =
			"<kbd>←</kbd><kbd>→</kbd> course &nbsp; <kbd>↑</kbd><kbd>↓</kbd> marble &nbsp; <kbd>G</kbd> ghost &nbsp; <kbd>Enter</kbd> race<br>Pebble3D engine · deterministic Rapier (wasm) · WebGPU · three.js TSL";

		// ---- results ----
		this.resultsEl = el("div", "results hidden", root);
	}

	setSkin(s: Skin): void {
		SKINS.forEach((k, i) => {
			this.skinEls[i]?.classList.toggle("sel", k === s);
		});
		this.skinName.textContent = SKIN_LABEL[s];
	}

	setGhostMode(m: GhostMode): void {
		(["best", "par", "off"] as GhostMode[]).forEach((k, i) => {
			this.modeBtns[i]?.classList.toggle("sel", k === m);
		});
	}

	/** Hidden panels are also `inert`, so a focused button under them cannot fire. */
	private show(el: HTMLElement, on: boolean): void {
		el.classList.toggle("hidden", !on);
		el.inert = !on;
		if (!on && el.contains(document.activeElement))
			(document.activeElement as HTMLElement).blur();
	}

	showTitle(on: boolean): void {
		this.show(this.titleEl, on);
	}

	showRace(on: boolean): void {
		this.show(this.raceEl, on);
	}

	hideResults(): void {
		this.show(this.resultsEl, false);
	}

	/** Clears the previous run's pips, split badge and clock (any frame rate). */
	resetRace(): void {
		this.setPips(0);
		this.splitTimer = 0;
		this.splitEl.classList.remove("show");
		this.setClock(0);
		this.ghostGapMetres(null);
	}

	setClock(t: number): void {
		const cs = Math.min(599999, Math.floor(t * 100 + 1e-6));
		if (cs === this.lastCs) return;
		this.lastCs = cs;
		const m = Math.floor(cs / 6000) % 10;
		const s = Math.floor(cs / 100) % 60;
		const c = cs % 100;
		const d = this.clockDigits;
		(d[0] as HTMLElement).textContent = DIGITS[m] as string;
		(d[1] as HTMLElement).textContent = DIGITS[Math.floor(s / 10)] as string;
		(d[2] as HTMLElement).textContent = DIGITS[s % 10] as string;
		(d[3] as HTMLElement).textContent = DIGITS[Math.floor(c / 10)] as string;
		(d[4] as HTMLElement).textContent = DIGITS[c % 10] as string;
		let lost = 0;
		for (let k = 0; k < 3; k++)
			if (t > (this.medals[k] as number)) lost = k + 1;
		if (lost !== this.lastLost) {
			this.lastLost = lost;
			this.medalRows.forEach((r, k) => {
				r.classList.toggle("lost", k < lost);
			});
		}
	}

	setSpeed(ms: number): void {
		const kmh = Math.min(999, Math.round(ms * 3.6));
		if (kmh !== this.lastKmh) {
			this.lastKmh = kmh;
			const d = this.speedDigits;
			(d[0] as HTMLElement).textContent =
				kmh >= 100 ? (DIGITS[Math.floor(kmh / 100)] as string) : "";
			(d[1] as HTMLElement).textContent =
				kmh >= 10 ? (DIGITS[Math.floor(kmh / 10) % 10] as string) : "";
			(d[2] as HTMLElement).textContent = DIGITS[kmh % 10] as string;
		}
		const f = Math.round(Math.min(1, ms / 40) * 100) / 100;
		if (f !== this.lastFrac) {
			this.lastFrac = f;
			this.speedBar.style.transform = `scaleX(${f})`;
		}
	}

	setPips(passed: number): void {
		if (passed === this.lastPips) return;
		this.lastPips = passed;
		this.pips.forEach((p, k) => {
			p.classList.toggle("on", k < passed);
		});
	}

	/** Shows a split delta vs the ghost (null = no ghost: shows the split time). */
	split(delta: number | null, time: number): void {
		const e = this.splitEl;
		e.classList.remove("ahead", "behind");
		if (delta === null) e.textContent = fmtTime(time);
		else {
			e.textContent = fmtDelta(delta);
			e.classList.add(delta <= 0 ? "ahead" : "behind");
		}
		e.classList.add("show");
		this.splitTimer = 2.6;
	}

	/** Fades the split badge out after a while (call every frame). */
	tickSplit(dt: number): void {
		if (this.splitTimer <= 0) return;
		this.splitTimer -= dt;
		if (this.splitTimer <= 0) this.splitEl.classList.remove("show");
	}

	/**
	 * Countdown overlay driven by sim time (not CSS time), so fixed-tick captures show it:
	 * `k` in [0, 1] is the progress through the current number.
	 */
	countdown(text: string | null, k: number): void {
		const e = this.countEl;
		if (text === null) {
			if (this.lastCount !== null) {
				e.style.opacity = "0";
				this.lastCount = null;
			}
			return;
		}
		if (text !== this.lastCount) {
			e.textContent = text;
			this.lastCount = text;
		}
		const pop = Math.min(1, k / 0.15);
		const scale = 1.6 - 0.6 * pop - 0.08 * Math.max(0, k - 0.15);
		const op = k < 0.15 ? pop : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1;
		e.style.opacity = String(Math.round(op * 100) / 100);
		e.style.transform = `translate(-50%, -50%) scale(${Math.round(scale * 1000) / 1000})`;
	}

	flash(): void {
		this.flashEl.classList.add("on");
		requestAnimationFrame(() => this.flashEl.classList.remove("on"));
	}

	ghost(label: string | null, meta: string): void {
		this.ghostTag.style.display = label ? "" : "none";
		if (label) {
			this.ghostName.textContent = label;
			this.ghostMeta.textContent = meta;
		}
	}

	/** Live gap to the ghost in metres along the track (+ = ghost ahead). */
	ghostGapMetres(m: number | null): void {
		const r = m === null ? Number.NaN : Math.round(m);
		if (r === this.lastGap || (Number.isNaN(r) && Number.isNaN(this.lastGap)))
			return;
		this.lastGap = r;
		const g = this.ghostGap;
		if (Number.isNaN(r)) g.textContent = "";
		else {
			g.textContent =
				r === 0 ? "level" : r > 0 ? `ahead ${r} m` : `behind ${-r} m`;
			g.style.color = r > 0 ? "var(--bad)" : "var(--good)";
		}
	}

	results(d: ResultsData): void {
		const r = this.resultsEl;
		r.replaceChildren();
		const box = el("div", "res panel", r);
		const head = el("div", "head", box);
		const badge = el(
			"div",
			`badge ${MEDAL_NAMES[d.medal]}`,
			head,
			d.medal < 3 ? MEDAL_NAMES[d.medal]?.toUpperCase() : "—",
		);
		void badge;
		const tt = el("div", "", head);
		el("div", "label", tt, "Finish time");
		el("div", "big num", tt, fmtTime(d.time));
		if (d.ghostTime !== null && d.ghostTime > 0) {
			const dd = d.time - d.ghostTime;
			const vs = el(
				"div",
				`vs num ${dd <= 0 ? "good" : "bad"}`,
				tt,
				`${fmtDelta(dd)} vs ${d.ghostLabel ?? "ghost"}`,
			);
			void vs;
		}
		if (d.newBest) el("div", "newbest", tt, "NEW BEST · GHOST SAVED");
		const tbl = el("table", "splits num", box);
		const names = d.splits.map((_, k) =>
			k === d.splits.length - 1 ? "Finish" : `Checkpoint ${k + 1}`,
		);
		d.splits.forEach((s, k) => {
			const tr = el("tr", "", tbl);
			el("td", "", tr, names[k]);
			el("td", "", tr, fmtTime(s));
			const gs = d.ghostSplits?.[k];
			if (gs !== undefined) {
				const dd = s - gs;
				el("td", Math.round(dd * 100) <= 0 ? "good" : "bad", tr, fmtDelta(dd));
			} else el("td", "", tr, "");
		});
		if (d.respawns > 0) {
			const tr = el("tr", "", tbl);
			el("td", "", tr, "Falls");
			el("td", "", tr, String(d.respawns));
			el("td", "", tr, "");
		}
		if (d.verify) {
			const v = el("div", "verify", box);
			const h = el("div", "h", v);
			h.textContent = d.verify.ok
				? "✓ Ghost verified by re-simulation"
				: "✗ Re-simulation mismatch";
			const p = el("div", "", v);
			p.innerHTML = `Seed + ${d.verify.ticks.toLocaleString("en-US")} logged inputs (${(d.verify.bytes / 1024).toFixed(1)} KB) were re-run headless on a fresh Rapier world in ${d.verify.ms.toFixed(0)} ms and reproduced the final state hash <code>${d.verify.hash}</code> bit for bit.`;
		}
		const act = el("div", "actions", box);
		const retry = el("button", "primary", act, "Race the ghost  (R)");
		retry.addEventListener("click", () => this.h.onRetry());
		if (d.hasNext)
			el("button", "", act, "Next course  (N)").addEventListener("click", () =>
				this.h.onNext(),
			);
		el("button", "", act, "Menu  (Esc)").addEventListener("click", () =>
			this.h.onMenu(),
		);
		this.show(r, true);
	}
}
