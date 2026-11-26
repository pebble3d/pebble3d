import { ANOMALIES } from "../anomalies.ts";
import {
	DAY_TICKS,
	DEVELOP_TICKS,
	FILM,
	TICKS_PER_SECOND,
} from "../constants.ts";
import { focusTolerance } from "../photo.ts";
import { END, type FieldSim, PHASE, type PhotoRecord } from "../sim.ts";
import type { Site } from "../sites.ts";

/** Screen-space box of the 16:9 viewfinder frame, CSS pixels. */
export interface FrameBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

const STAR = "★";
const NO_STAR = "☆";

function stars(n: number): string {
	return STAR.repeat(n) + NO_STAR.repeat(3 - n);
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls: string,
	parent?: HTMLElement,
	text?: string,
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	if (text !== undefined) e.textContent = text;
	parent?.append(e);
	return e;
}

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

const RATINGS: [number, string][] = [
	[900, "Anomaly Laureate"],
	[650, "Senior Surveyor"],
	[380, "Field Researcher"],
	[0, "Casual Observer"],
];

/** 35 mm-equivalent focal length for a vertical field of view (24 mm frame height). */
export function focalLength(fovDeg: number): number {
	return 12 / Math.tan((fovDeg * Math.PI) / 360);
}

/**
 * The DOM HUD: title card, survey journal, film and light, signal meter, the photo-mode
 * viewfinder (thirds, eye-AF box, meter strip), the developed print and the contact-sheet
 * results. Text is only rewritten when the value it shows changes.
 */
export class Hud {
	private readonly title: HTMLElement;
	private readonly survey: HTMLElement;
	private readonly journalRows: {
		row: HTMLElement;
		name: HTMLElement;
		stars: HTMLElement;
	}[] = [];
	private readonly journalHead: HTMLElement;
	private readonly frames: HTMLElement;
	private readonly lightFill: HTMLElement;
	private readonly lightText: HTMLElement;
	private readonly signalBars: HTMLElement[] = [];
	private readonly prompt: HTMLElement;
	private readonly toast: HTMLElement;
	private readonly toastTitle: HTMLElement;
	private readonly toastSub: HTMLElement;
	private readonly vf: HTMLElement;
	private readonly vfFrame: HTMLElement;
	private readonly vfSubject: HTMLElement;
	private readonly vfMm: HTMLElement;
	private readonly vfEv: HTMLElement;
	private readonly vfFocus: HTMLElement;
	private readonly vfFrames: HTMLElement;
	private readonly vfNeedle: HTMLElement;
	private readonly vfMeterLabel: HTMLElement;
	private readonly flash: HTMLElement;
	private readonly print: HTMLElement;
	private readonly printThumb: HTMLCanvasElement;
	private readonly printName: HTMLElement;
	private readonly printStars: HTMLElement;
	private readonly printBars: HTMLElement[] = [];
	private readonly printTotal: HTMLElement;
	private readonly printNote: HTMLElement;
	private readonly results: HTMLElement;
	private readonly resultsSheet: HTMLElement;
	private readonly resultsHead: HTMLElement;
	private readonly resultsStats: HTMLElement;
	private readonly resultsRating: HTMLElement;
	/** One thumbnail canvas per frame on the roll (filled by the presentation). */
	readonly thumbs: HTMLCanvasElement[] = [];
	private last = {
		phase: -1,
		film: -1,
		lightSec: -1,
		signal: -1,
		journal: -1,
		mm: -1,
		ev: -999,
		focus: -1,
		meter: -999,
		print: -1,
		toastUntil: 0,
		prompt: "",
		su: -1,
		sv: -1,
		ssz: -1,
	};
	private toastT = 0;

	constructor(
		root: HTMLElement,
		opts: { survey: number; site: Site; sites: readonly Site[] },
	) {
		root.replaceChildren();

		// --- title -------------------------------------------------------------------
		this.title = el("div", "screen title", root);
		const card = el("div", "title-card", this.title);
		el("div", "kicker", card, `Survey № ${opts.survey} · ${opts.site.name}`);
		el("h1", "", card, "Field Notes");
		el("p", "lede", card, opts.site.blurb);
		const sites = el("div", "sites", card);
		opts.sites.forEach((s, i) => {
			const b = el("div", `site${s === opts.site ? " on" : ""}`, sites);
			el("b", "", b, String(i + 1));
			el("span", "", b, s.name);
		});
		el("div", "sites-hint", card, "Tab or 1–2 to change site");
		const keys = el("div", "keys", card);
		for (const [k, v] of [
			["WASD", "walk · Shift run"],
			["Mouse", "look (click to capture the pointer)"],
			["C / Right click", "raise / lower the camera"],
			["Click / Space", "release the shutter"],
			["Wheel", "zoom"],
			["F", "autofocus · Z/X focus by hand"],
			["Q / E", "exposure −/+"],
		])
			el("div", "key", keys).append(
				el("b", "", undefined, k),
				el("span", "", undefined, v),
			);
		el("div", "start", card, "Press Enter or click to begin");
		el("div", "credit", this.title, opts.site.credit);

		// --- survey HUD ----------------------------------------------------------------
		this.survey = el("div", "survey", root);
		const journal = el("div", "journal", this.survey);
		this.journalHead = el("div", "journal-head", journal, "Field Notes");
		for (let i = 0; i < ANOMALIES.length; i++) {
			const row = el("div", "jrow", journal);
			el("span", "jnum", row, pad2(i + 1));
			const name = el("span", "jname", row, "— unrecorded —");
			const st = el("span", "jstars", row, stars(0));
			this.journalRows.push({ row, name, stars: st });
		}
		const status = el("div", "status", this.survey);
		const film = el("div", "film", status);
		this.frames = el("div", "film-count", film, pad2(FILM));
		el("div", "film-label", film, "frames left");
		const light = el("div", "light", status);
		el("div", "light-label", light, "Daylight");
		const bar = el("div", "light-bar", light);
		this.lightFill = el("div", "light-fill", bar);
		this.lightText = el("div", "light-text", light, "5:00");
		const signal = el("div", "signal", this.survey);
		const bars = el("div", "signal-bars", signal);
		for (let i = 0; i < 6; i++) this.signalBars.push(el("i", "", bars));
		el("div", "signal-label", signal, "Signal");
		this.prompt = el("div", "prompt", this.survey);
		this.toast = el("div", "toast", this.survey);
		this.toastTitle = el("div", "toast-title", this.toast);
		this.toastSub = el("div", "toast-sub", this.toast);

		// --- viewfinder ------------------------------------------------------------------
		this.vf = el("div", "viewfinder", root);
		this.vfFrame = el("div", "vf-frame", this.vf);
		for (const c of ["tl", "tr", "bl", "br"])
			el("i", `corner ${c}`, this.vfFrame);
		for (const c of ["v1", "v2", "h1", "h2"])
			el("i", `third ${c}`, this.vfFrame);
		el("div", "vf-af", this.vfFrame);
		this.vfSubject = el("div", "vf-subject", this.vfFrame);
		const strip = el("div", "vf-strip", this.vfFrame);
		this.vfMm = el("span", "vf-mm", strip, "50mm");
		el("span", "vf-ap", strip, "f/2.0");
		this.vfEv = el("span", "vf-ev", strip, "EV ±0");
		this.vfFocus = el("span", "vf-focus", strip, "◎ 4.0 m");
		const meter = el("span", "vf-meter", strip);
		el("span", "scale", meter, "−2 · · −1 · · 0 · · +1 · · +2");
		this.vfNeedle = el("i", "needle", meter);
		this.vfMeterLabel = el("span", "vf-meter-label", strip, "");
		this.vfFrames = el("span", "vf-frames", strip, "12");
		el(
			"div",
			"vf-help",
			this.vfFrame,
			"Click/Space shoot · F focus · Q/E exposure · Wheel zoom · C lower",
		);
		this.flash = el("div", "flash", root);

		// --- the developed print ----------------------------------------------------------
		this.print = el("div", "print", root);
		this.printThumb = el("canvas", "print-thumb", this.print);
		this.printThumb.width = 384;
		this.printThumb.height = 216;
		const cap = el("div", "print-cap", this.print);
		this.printName = el("div", "print-name", cap);
		this.printStars = el("div", "print-stars", cap);
		const crit = el("div", "print-crit", this.print);
		for (const label of ["Composition", "Fill", "Focus", "Exposure"]) {
			const r = el("div", "crit", crit);
			el("span", "crit-label", r, label);
			const b = el("span", "crit-bar", r);
			this.printBars.push(el("i", "", b));
		}
		const foot = el("div", "print-foot", this.print);
		this.printNote = el("span", "print-note", foot);
		this.printTotal = el("span", "print-total", foot);

		// --- results ----------------------------------------------------------------------
		this.results = el("div", "screen results", root);
		const rc = el("div", "results-card", this.results);
		this.resultsHead = el("div", "kicker", rc, "Survey complete");
		el("h2", "", rc, "Contact sheet");
		this.resultsSheet = el("div", "sheet", rc);
		const tail = el("div", "results-tail", rc);
		this.resultsStats = el("div", "results-stats", tail);
		this.resultsRating = el("div", "results-rating", tail);
		el("div", "start", rc, "Press Enter for a new survey");

		for (let i = 0; i < FILM; i++) {
			const c = document.createElement("canvas");
			c.width = 384;
			c.height = 216;
			this.thumbs.push(c);
		}
	}

	/** Positions the viewfinder frame over the 16:9 box. */
	layoutFrame(box: FrameBox): void {
		const s = this.vfFrame.style;
		s.left = `${box.x}px`;
		s.top = `${box.y}px`;
		s.width = `${box.w}px`;
		s.height = `${box.h}px`;
	}

	showToast(title: string, sub: string, ticks: number, now: number): void {
		this.toastTitle.textContent = title;
		this.toastSub.textContent = sub;
		this.toast.classList.remove("show");
		void this.toast.offsetWidth;
		this.toast.classList.add("show");
		this.toastT = now + ticks;
	}

	shutterFlash(): void {
		this.flash.classList.remove("go");
		void this.flash.offsetWidth;
		this.flash.classList.add("go");
	}

	/** Per-frame update. `subjectU/V` (0..1 in frame) place the eye-AF box; NaN hides it. */
	update(
		sim: FieldSim,
		subjectU: number,
		subjectV: number,
		subjectSize: number,
		prompt: string,
	): void {
		const L = this.last;
		const phase = sim.phase;
		if (phase !== L.phase) {
			L.phase = phase;
			this.title.classList.toggle("on", phase === PHASE.TITLE);
			this.survey.classList.toggle(
				"on",
				phase === PHASE.EXPLORE || phase === PHASE.PHOTO,
			);
			this.survey.classList.toggle("dim", phase === PHASE.PHOTO);
			this.vf.classList.toggle("on", phase === PHASE.PHOTO);
			this.results.classList.toggle("on", phase === PHASE.RESULTS);
			if (phase === PHASE.RESULTS) this.fillResults(sim);
		}
		if (phase === PHASE.TITLE || phase === PHASE.RESULTS) {
			this.print.classList.remove("on");
			return;
		}

		// Journal.
		// Numeric key (no per-frame strings): 3 bits per anomaly, revealed + stars.
		let key = 0;
		for (let i = 0; i < sim.anomalies.length; i++) {
			const a = sim.anomalies[i] as (typeof sim.anomalies)[number];
			key = key * 8 + (a.revealed ? 4 : 0) + a.bestStars;
		}
		if (key !== L.journal) {
			L.journal = key;
			sim.anomalies.forEach((a, i) => {
				const r = this.journalRows[i];
				if (!r) return;
				r.name.textContent = a.revealed ? a.def.name : "— unrecorded —";
				r.stars.textContent = stars(a.bestStars);
				r.row.classList.toggle("seen", a.revealed);
				r.row.classList.toggle("done", a.bestStars > 0);
				r.row.style.setProperty("--hue", a.def.hue);
			});
			this.journalHead.textContent = `Field Notes · ${sim.documented}/6 documented`;
		}
		if (sim.film !== L.film) {
			L.film = sim.film;
			this.frames.textContent = pad2(sim.film);
			this.vfFrames.textContent = `[${pad2(sim.film)}]`;
			this.frames.classList.toggle("low", sim.film <= 2);
		}
		const sec = Math.ceil(sim.light / TICKS_PER_SECOND);
		if (sec !== L.lightSec) {
			L.lightSec = sec;
			this.lightText.textContent = `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
			this.lightFill.style.transform = `scaleX(${sim.light / DAY_TICKS})`;
			this.lightFill.classList.toggle("low", sec <= 45);
		}
		const sig = Math.round(sim.signal * 6);
		if (sig !== L.signal) {
			L.signal = sig;
			this.signalBars.forEach((b, i) => {
				b.classList.toggle("on", i < sig);
			});
		}
		if (prompt !== L.prompt) {
			L.prompt = prompt;
			this.prompt.textContent = prompt;
			this.prompt.classList.toggle("on", prompt !== "");
		}
		if (sim.tick > this.toastT) this.toast.classList.remove("show");

		// Viewfinder.
		if (phase === PHASE.PHOTO) {
			const c = sim.cam;
			const mm = Math.round(focalLength(c.fovDeg));
			if (mm !== L.mm) {
				L.mm = mm;
				this.vfMm.textContent = `${mm}mm`;
			}
			const ev = Math.round(c.ev * 3);
			if (ev !== L.ev) {
				L.ev = ev;
				const thirds = ["", "⅓", "⅔"];
				const whole = Math.trunc(Math.abs(ev) / 3);
				const frac = thirds[Math.abs(ev) % 3] ?? "";
				const sign = ev > 0 ? "+" : ev < 0 ? "−" : "±";
				this.vfEv.textContent = `EV ${sign}${whole || !frac ? whole : ""}${frac}`;
			}
			const fo = Math.round(c.focus * 10);
			if (fo !== L.focus) {
				L.focus = fo;
				this.vfFocus.textContent = `◎ ${(fo / 10).toFixed(1)} m`;
			}
			const m = Number.isFinite(sim.meter) ? Math.round(sim.meter * 3) : -99;
			if (m !== L.meter) {
				L.meter = m;
				const has = m !== -99;
				this.vfNeedle.style.opacity = has ? "1" : "0.25";
				const pos = has ? Math.max(-2, Math.min(2, m / 3)) : 0;
				this.vfNeedle.style.left = `${50 + pos * 23.5}%`;
				this.vfMeterLabel.textContent = !has
					? "no subject"
					: m > 1
						? "too bright"
						: m < -1
							? "too dark"
							: "metered";
				this.vfMeterLabel.className = `vf-meter-label ${!has ? "" : Math.abs(m) > 1 ? "warn" : "ok"}`;
			}
			const sub = this.vfSubject.style;
			if (Number.isFinite(subjectU)) {
				const sz = Math.round(Math.max(4, Math.min(60, subjectSize * 100)) * 4);
				const u = Math.round(subjectU * 400);
				const v = Math.round(subjectV * 400);
				sub.display = "block";
				// Styles only change when the box moves by a quarter percent.
				if (u !== L.su || v !== L.sv || sz !== L.ssz) {
					L.su = u;
					L.sv = v;
					L.ssz = sz;
					sub.left = `${u / 4}%`;
					sub.top = `${v / 4}%`;
					sub.width = `${(sz / 4) * 0.5625}%`;
					sub.height = `${sz / 4}%`;
				}
				const inFocus =
					Math.abs(c.focus - sim.subjectDepth) <=
					focusTolerance(sim.subjectDepth);
				this.vfSubject.classList.toggle("sharp", inFocus);
			} else sub.display = "none";
		}

		// Developed print.
		const showPrint =
			sim.lastPhoto >= 0 && sim.tick - sim.lastPhotoTick < DEVELOP_TICKS;
		this.print.classList.toggle("on", showPrint);
		if (showPrint && sim.lastPhoto !== L.print) {
			L.print = sim.lastPhoto;
			this.fillPrint(
				sim,
				sim.photos[sim.lastPhoto] as PhotoRecord,
				sim.lastPhoto,
			);
		}
		if (!showPrint) L.print = -1;
	}

	/** A new survey: forget per-survey display state (toast deadline, cached values). */
	reset(): void {
		this.toastT = 0;
		this.toast.classList.remove("show");
		this.print.classList.remove("on");
		const L = this.last;
		L.phase = L.film = L.lightSec = L.signal = L.journal = L.print = -1;
		L.mm = L.focus = -1;
		L.ev = L.meter = -999;
		L.prompt = "";
	}

	/** Thumbnail `n` was just captured (after its frame rendered): show it on the print. */
	captured(n: number): void {
		if (this.last.print !== n) return;
		const ctx = this.printThumb.getContext("2d");
		const src = this.thumbs[n];
		if (ctx && src) ctx.drawImage(src, 0, 0);
	}

	private fillPrint(sim: FieldSim, rec: PhotoRecord, n: number): void {
		const ctx = this.printThumb.getContext("2d");
		const src = this.thumbs[n];
		if (ctx && src) ctx.drawImage(src, 0, 0);
		const s = rec.score;
		const a = rec.anomaly >= 0 ? sim.anomalies[rec.anomaly] : undefined;
		this.printName.textContent = a ? a.def.name : "Nothing in frame";
		this.printStars.textContent = stars(s.stars);
		this.print.style.setProperty("--hue", a?.def.hue ?? "#9a958a");
		const vals = [s.composition, s.fill, s.focus, s.exposure];
		this.printBars.forEach((b, i) => {
			b.style.transform = `scaleX(${vals[i] ?? 0})`;
		});
		this.printTotal.textContent = a ? `${s.total}` : "—";
		this.printNote.textContent = !a
			? "Frame wasted"
			: rec.extra > 0
				? `Two in one frame${rec.extra > 1 ? ` (+${rec.extra})` : ""}`
				: s.occluded
					? "Subject obstructed"
					: rec.firstDoc
						? "New entry in the journal"
						: s.stars === 0
							? "Not good enough to file"
							: s.stars === 3
								? "A keeper"
								: "Filed";
	}

	private fillResults(sim: FieldSim): void {
		this.resultsHead.textContent =
			sim.endReason === END.ALL
				? "Survey complete · all six documented"
				: sim.endReason === END.FILM
					? "Survey over · out of film"
					: "Survey over · the light is gone";
		this.resultsSheet.replaceChildren();
		const used = sim.photos.filter((p) => p.used);
		for (let i = 0; i < FILM; i++) {
			const rec = sim.photos[i] as PhotoRecord;
			const cell = el(
				"div",
				`frame${rec.used ? "" : " blank"}`,
				this.resultsSheet,
			);
			el("span", "frame-no", cell, pad2(i + 1));
			if (!rec.used) continue;
			const c = document.createElement("canvas");
			c.width = 384;
			c.height = 216;
			c.getContext("2d")?.drawImage(this.thumbs[i] as HTMLCanvasElement, 0, 0);
			cell.append(c);
			const a = rec.anomaly >= 0 ? sim.anomalies[rec.anomaly] : undefined;
			const cap = el("div", "frame-cap", cell);
			el("span", "frame-name", cap, a ? a.def.name : "—");
			el("span", "frame-stars", cap, stars(rec.score.stars));
			if (a) cell.style.setProperty("--hue", a.def.hue);
		}
		const score = sim.score;
		const rating = RATINGS.find(([min]) => score >= min)?.[1] ?? "";
		this.resultsStats.replaceChildren();
		for (const [k, v] of [
			["Documented", `${sim.documented} / 6`],
			["Stars", `${sim.totalStars} / 18`],
			["Frames used", `${used.length} / ${FILM}`],
			["Score", `${score}`],
		]) {
			const d = el("div", "stat", this.resultsStats);
			el("span", "stat-k", d, k);
			el("span", "stat-v", d, v);
		}
		this.resultsRating.textContent = rating;
	}
}
