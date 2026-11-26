import type { Course } from "../course.ts";
import type { RunnerKind } from "../view/runner-view.ts";

const TOAST_SECONDS = 2.2;
const FLASH_SECONDS = 0.65;

export type Medal = "gold" | "silver" | "bronze" | "none";

export function medalFor(c: Course, seconds: number): Medal {
	if (seconds <= c.medals.gold) return "gold";
	if (seconds <= c.medals.silver) return "silver";
	if (seconds <= c.medals.bronze) return "bronze";
	return "none";
}

/** 83.456 -> "1:23.45"; under a minute "23.45". */
export function fmtTime(s: number): string {
	const cs = Math.floor(s * 100 + 1e-6);
	const m = Math.floor(cs / 6000);
	const sec = Math.floor((cs % 6000) / 100);
	const c = cs % 100;
	const ss = m > 0 ? String(sec).padStart(2, "0") : String(sec);
	return `${m > 0 ? `${m}:` : ""}${ss}.${String(c).padStart(2, "0")}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls: string,
	parent: HTMLElement,
	text?: string,
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	if (text !== undefined) e.textContent = text;
	parent.appendChild(e);
	return e;
}

export interface TitleState {
	courses: Course[];
	sel: number;
	runner: RunnerKind;
	bests: (number | null)[];
}

export interface ResultsState {
	course: Course;
	time: number;
	medal: Medal;
	shards: number;
	totalShards: number;
	falls: number;
	best: number | null;
	newBest: boolean;
	hasNext: boolean;
}

/**
 * DOM overlay: title screen (course cards, runner choice), run HUD (timer, ghost delta,
 * checkpoint pips, shards, countdown, toasts, respawn flash) and the results card. Text
 * is only rewritten when its value changes.
 */
export class Hud {
	private readonly run: HTMLElement;
	private readonly timer: HTMLElement;
	private readonly deltaEl: HTMLElement;
	private readonly courseName: HTMLElement;
	private readonly pips: HTMLElement;
	private readonly shardsEl: HTMLElement;
	private readonly shardsNum: HTMLElement;
	private readonly ghostTag: HTMLElement;
	private readonly countEl: HTMLElement;
	private readonly toastEl: HTMLElement;
	private readonly flashEl: HTMLElement;
	private readonly help: HTMLElement;
	private readonly title: HTMLElement;
	private readonly results: HTMLElement;
	private countAge = 1;
	private countDur = 0;
	private toastAge = TOAST_SECONDS;
	private flashAge = FLASH_SECONDS;
	private lastCs = -1;
	private lastShards = -1;
	private lastCp = -1;
	/** UI actions (clicks); keys go through the app. */
	onAction: ((a: string, arg?: number) => void) | null = null;

	constructor(root: HTMLElement) {
		this.run = el("div", "run hud-hidden", root);
		const top = el("div", "run-top", this.run);
		this.timer = el("div", "timer", top, "0.00");
		this.deltaEl = el("div", "delta", top);
		const left = el("div", "corner left", this.run);
		el("div", "label", left, "Course");
		this.courseName = el("div", "course-name", left);
		this.pips = el("div", "pips", left);
		const right = el("div", "corner right", this.run);
		el("div", "label", right, "Sky shards");
		this.shardsEl = el("div", "shards", right);
		el("div", "shard-icon", this.shardsEl);
		this.shardsNum = el("span", "", this.shardsEl, "0/0");
		this.ghostTag = el("div", "ghost-tag", right);
		this.countEl = el("div", "countdown", this.run);
		this.toastEl = el("div", "toast", this.run);
		this.help = el("div", "help", this.run);
		this.help.innerHTML =
			"<kbd>WASD</kbd> run &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>Shift</kbd> sprint &nbsp; <kbd>Q</kbd><kbd>E</kbd> or click + mouse: camera &nbsp; <kbd>R</kbd> restart &nbsp; <kbd>Esc</kbd> menu";
		this.flashEl = el("div", "flash", root);
		this.title = el("div", "title hud-hidden", root);
		this.results = el("div", "results hud-hidden", root);
	}

	// ---------------------------------------------------------------- title

	showTitle(s: TitleState): void {
		this.run.classList.add("hud-hidden");
		this.results.classList.add("hud-hidden");
		const t = this.title;
		t.classList.remove("hud-hidden");
		t.replaceChildren();
		const wm = el("div", "wordmark", t);
		wm.innerHTML = "SKY<span>RUN</span>";
		el(
			"div",
			"sub",
			t,
			"A parkour time trial across the floating isles. Ride the movers, catch the shards, beat your ghost.",
		);
		const cards = el("div", "cards", t);
		s.courses.forEach((c, i) => {
			const card = el("div", `card${i === s.sel ? " sel" : ""}`, cards);
			el("h3", "", card, c.name);
			el("p", "", card, c.tagline);
			const m = el("div", "medals", card);
			for (const k of ["gold", "silver", "bronze"] as const) {
				const span = el("span", "", m);
				el("span", `medal-dot m-${k}`, span);
				span.append(fmtTime(c.medals[k]));
			}
			const b = s.bests[i];
			el(
				"div",
				"best",
				card,
				b !== null && b !== undefined
					? `Your best  ${fmtTime(b)}`
					: "No run yet",
			);
			card.addEventListener("click", () => this.onAction?.("select", i));
		});
		const row = el("div", "row", t);
		el("span", "label", row, "Runner");
		for (const k of ["human", "robot"] as const) {
			const p = el(
				"div",
				`pill${s.runner === k ? " sel" : ""}`,
				row,
				k === "human" ? "Rocketbox runner" : "Robot",
			);
			p.addEventListener("click", () =>
				this.onAction?.("runner", k === "human" ? 0 : 1),
			);
		}
		const go = el("button", "go-btn", row, "RUN  ⏎");
		go.addEventListener("click", () => this.onAction?.("start"));
		const help = el("div", "row", t);
		help.innerHTML =
			'<span class="label" style="opacity:.8"><kbd>←</kbd><kbd>→</kbd> course &nbsp; <kbd>Tab</kbd> runner &nbsp; <kbd>Enter</kbd> run</span>';
	}

	hideTitle(): void {
		this.title.classList.add("hud-hidden");
	}

	// ---------------------------------------------------------------- run

	startRun(c: Course, ghostLabel: string | null): void {
		this.title.classList.add("hud-hidden");
		this.results.classList.add("hud-hidden");
		this.run.classList.remove("hud-hidden");
		this.courseName.textContent = c.name;
		this.pips.replaceChildren();
		for (let i = 0; i < c.checkpoints.length; i++) el("div", "pip", this.pips);
		el("div", "pip goal", this.pips);
		this.ghostTag.textContent = ghostLabel ?? "";
		this.lastCs = -1;
		this.lastShards = -1;
		this.lastCp = -1;
		this.deltaEl.classList.remove("show");
		this.timer.textContent = "0.00";
	}

	frame(time: number, shards: number, totalShards: number, cp: number): void {
		const cs = Math.floor(time * 100);
		if (cs !== this.lastCs) {
			this.lastCs = cs;
			this.timer.textContent = fmtTime(time);
		}
		if (shards !== this.lastShards) {
			if (this.lastShards >= 0) {
				this.shardsEl.classList.remove("pop");
				void this.shardsEl.offsetWidth;
				this.shardsEl.classList.add("pop");
			}
			this.lastShards = shards;
			this.shardsNum.textContent = `${shards}/${totalShards}`;
		}
		if (cp !== this.lastCp) {
			this.lastCp = cp;
			const kids = this.pips.children;
			for (let i = 0; i < kids.length - 1; i++)
				kids[i]?.classList.toggle("on", i < cp);
		}
	}

	countdown(n: number): void {
		const e = this.countEl;
		e.textContent = n > 0 ? String(n) : "GO";
		e.className = n > 0 ? "countdown" : "countdown go";
		this.countAge = 0;
		this.countDur = n > 0 ? 0.82 : 1.1;
	}

	toast(html: string): void {
		this.toastEl.innerHTML = html;
		this.toastAge = 0;
	}
	/** Seconds relative to the ghost: negative is ahead. */
	delta(sec: number): void {
		const e = this.deltaEl;
		e.textContent = `${sec < 0 ? "−" : "+"}${fmtTime(Math.abs(sec))}`;
		e.classList.remove("ahead", "behind");
		e.classList.add("show", sec < 0 ? "ahead" : "behind");
	}

	flash(): void {
		this.flashAge = 0;
	}

	/**
	 * Advances the countdown, toast and flash animations by `dt` seconds of game time (sim
	 * time in fixed mode), so captures show the same frame on every run.
	 */
	animate(dt: number): void {
		if (this.countAge < this.countDur) {
			this.countAge += dt;
			const p = Math.min(1, this.countAge / this.countDur);
			const o = p < 0.15 ? p / 0.15 : p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
			const sc =
				p < 0.15 ? 1.6 - (p / 0.15) * 0.6 : 1 - Math.max(0, p - 0.75) * 0.32;
			this.countEl.style.opacity = String(o);
			this.countEl.style.transform = `scale(${sc.toFixed(3)})`;
		}
		if (this.toastAge < TOAST_SECONDS) {
			this.toastAge += dt;
			const p = Math.min(1, this.toastAge / TOAST_SECONDS);
			const o = p < 0.12 ? p / 0.12 : p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
			this.toastEl.style.opacity = String(o);
			this.toastEl.style.transform = `translate(-50%, ${(p < 0.12 ? (1 - p / 0.12) * 12 : 0).toFixed(1)}px)`;
		}
		if (this.flashAge < FLASH_SECONDS) {
			this.flashAge += dt;
			this.flashEl.style.opacity = String(
				Math.max(0, 1 - this.flashAge / FLASH_SECONDS),
			);
		}
	}

	// ---------------------------------------------------------------- results

	showResults(r: ResultsState): void {
		this.run.classList.add("hud-hidden");
		const e = this.results;
		e.classList.remove("hud-hidden");
		e.replaceChildren();
		el("div", "label", e, `${r.course.name} · finish`);
		el("div", "big", e, fmtTime(r.time));
		const badge = el(
			"div",
			`badge ${r.medal}`,
			e,
			r.medal === "none" ? "No medal" : `${r.medal} medal`,
		);
		void badge;
		if (r.newBest) el("div", "newbest", e, "NEW PERSONAL BEST");
		else if (r.best !== null) el("div", "best", e, `Best ${fmtTime(r.best)}`);
		const stats = el("div", "stats", e);
		const stat = (label: string, v: string): void => {
			const s = el("div", "stat", stats);
			el("div", "label", s, label);
			el("div", "v", s, v);
		};
		stat("Shards", `${r.shards}/${r.totalShards}`);
		stat("Falls", String(r.falls));
		const nextMedal =
			r.medal === "gold"
				? null
				: r.medal === "silver"
					? "gold"
					: r.medal === "bronze"
						? "silver"
						: "bronze";
		stat(
			nextMedal ? `To ${nextMedal}` : "Gold by",
			nextMedal
				? `${fmtTime(Math.max(0, r.time - r.course.medals[nextMedal]))}`
				: fmtTime(r.course.medals.gold - r.time),
		);
		const actions = el("div", "actions", e);
		const btn = (label: string, a: string): void => {
			const b = el("div", "pill", actions);
			b.innerHTML = label;
			b.addEventListener("click", () => this.onAction?.(a));
		};
		btn("<kbd>Enter</kbd> Retry", "retry");
		if (r.hasNext) btn("<kbd>N</kbd> Next course", "next");
		btn("<kbd>Esc</kbd> Menu", "menu");
	}

	hideAll(): void {
		this.title.classList.add("hud-hidden");
		this.results.classList.add("hud-hidden");
		this.run.classList.add("hud-hidden");
	}
}
