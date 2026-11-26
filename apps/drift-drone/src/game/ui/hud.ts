import type { FlightMode } from "../constants.ts";
import type { TrackFile } from "../track.ts";

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

/** 7.4213 -> "07.42"; 75.2 -> "1:15.20". */
export function fmtTime(t: number): string {
	if (!(t >= 0)) return "--.--";
	const cs = Math.floor(t * 100 + 1e-6);
	const m = Math.floor(cs / 6000);
	const s = Math.floor((cs % 6000) / 100);
	const c = cs % 100;
	const ss = `${s < 10 ? "0" : ""}${s}.${c < 10 ? "0" : ""}${c}`;
	return m > 0 ? `${m}:${ss}` : ss;
}

export function fmtDelta(d: number): string {
	const a = Math.abs(d);
	return `${d < 0 ? "-" : "+"}${a.toFixed(2)}`;
}

export function medalOf(t: number, m: TrackFile["medals"]): string {
	if (!(t > 0)) return "";
	if (t <= m.gold) return "gold";
	if (t <= m.silver) return "silver";
	if (t <= m.bronze) return "bronze";
	return "";
}

const MEDAL_COLOR: Record<string, string> = {
	gold: "#ffcf3a",
	silver: "#d6dde6",
	bronze: "#e0915a",
};

export interface ResultsData {
	track: TrackFile;
	mode: FlightMode;
	total: number;
	laps: number[];
	crashes: number;
	best: number;
	newBest: boolean;
	ghostLine: string;
	ghostOk: boolean | null;
}

/**
 * The DOM HUD in an FPV on-screen-display style: monospace telemetry with hard shadows, the lap
 * clock top centre, gate pips, ghost delta, OSD readouts, and the title, photo-finish and
 * results screens. Text is written only when it changes.
 */
export class Hud {
	private readonly root: HTMLElement;
	private readonly title: HTMLElement;
	private readonly cards: HTMLElement;
	private readonly modes: HTMLElement[] = [];
	private readonly modeNote: HTMLElement;
	private readonly kicker: HTMLElement;
	private readonly tagline: HTMLElement;
	private readonly race: HTMLElement;
	private readonly lap: HTMLElement;
	private readonly time: HTMLElement;
	private readonly sub: HTMLElement;
	private readonly delta: HTMLElement;
	private readonly trackName: HTMLElement;
	private readonly pips: HTMLElement;
	private readonly next: HTMLElement;
	private readonly ghost: HTMLElement;
	private readonly alt: HTMLElement;
	private readonly spd: HTMLElement;
	private readonly thr: HTMLElement[] = [];
	private readonly cam: HTMLElement;
	private readonly count: HTMLElement;
	private readonly toastEl: HTMLElement;
	private readonly lost: HTMLElement;
	private readonly fpv: HTMLElement;
	private readonly horizon: HTMLElement;
	private readonly arrow: HTMLElement;
	private readonly photo: HTMLElement;
	private readonly photoLabel: HTMLElement;
	private readonly photoStamp: HTMLElement;
	private readonly flashEl: HTMLElement;
	private readonly results: HTMLElement;
	private readonly cache = new Map<HTMLElement, string>();
	private toastT = 0;
	private deltaT = 0;
	private pipEls: HTMLElement[] = [];

	constructor(root: HTMLElement, credit: string) {
		this.root = root;
		// title
		this.title = el("div", "dd-title dd-hide", root);
		this.kicker = el("div", "dd-kicker", this.title);
		const logo = el("div", "dd-logo", this.title);
		logo.innerHTML = "Drift<br><span>Drone</span>";
		el("div", "dd-logo-rule", this.title);
		this.tagline = el("div", "dd-tagline", this.title);
		this.cards = el("div", "dd-cards", this.title);
		const modes = el("div", "dd-modes", this.title);
		this.modes.push(
			el("div", "dd-mode", modes, "ASSISTED"),
			el("div", "dd-mode", modes, "ACRO"),
		);
		this.modeNote = el("div", "dd-mode-note", this.title);
		const keys = el("div", "dd-keys", this.title);
		for (const [k, v] of [
			["W / S", "climb / descend (acro: throttle lever)"],
			["A / D", "yaw"],
			["Arrows", "pitch and roll"],
			["C", "chase / FPV camera"],
			["Tab  M", "track  ·  flight mode"],
			["R  Esc", "restart  ·  menu"],
		]) {
			el("b", "", keys, k);
			el("span", "", keys, v);
		}
		el("div", "dd-press", this.title, "PRESS ENTER TO ARM");
		el("div", "dd-credit", this.title, credit);

		// race
		this.race = el("div", "dd-race dd-hide", root);
		this.fpv = el("div", "dd-fpv dd-hide", this.race);
		el("div", "dd-cross", this.fpv);
		this.horizon = el("div", "dd-horizon", this.fpv);
		const timer = el("div", "dd-timer", this.race);
		this.lap = el("div", "dd-lap", timer);
		this.time = el("div", "dd-time", timer);
		this.sub = el("div", "dd-sub", timer);
		this.delta = el("div", "dd-delta", timer);
		const gates = el("div", "dd-gates", this.race);
		this.trackName = el("div", "dd-track", gates);
		this.pips = el("div", "dd-pips", gates);
		this.next = el("div", "dd-next", gates);
		this.ghost = el("div", "dd-ghost", this.race);
		const osd = el("div", "dd-osd", this.race);
		const r1 = el("div", "", osd);
		el("span", "", r1, "ALT ");
		this.alt = el("span", "v", r1);
		el("span", "", r1, "SPD ");
		this.spd = el("span", "v", r1);
		const r2 = el("div", "", osd);
		el("span", "", r2, "THR ");
		const bar = el("span", "dd-thr", r2);
		for (let i = 0; i < 12; i++) this.thr.push(el("i", "", bar));
		this.cam = el("div", "dd-cam", this.race);
		this.arrow = el("div", "dd-arrow dd-hide", this.race);
		this.count = el("div", "dd-count", this.race);
		this.toastEl = el("div", "dd-toast", this.race);
		this.lost = el("div", "dd-lost dd-hide", this.race);
		this.lost.innerHTML = "SIGNAL LOST<small>RESPAWNING AT LAST GATE</small>";

		// photo finish
		this.photo = el("div", "dd-photo dd-hide", root);
		el("div", "dd-bar top", this.photo);
		el("div", "dd-bar bottom", this.photo);
		this.photoLabel = el("div", "dd-photo-label", this.photo);
		this.photoStamp = el("div", "dd-photo-stamp", this.photo);
		this.flashEl = el("div", "dd-flash", root);

		// results
		this.results = el("div", "dd-results dd-hide", root);
	}

	private set(e: HTMLElement, s: string): void {
		if (this.cache.get(e) === s) return;
		this.cache.set(e, s);
		e.textContent = s;
	}

	private show(e: HTMLElement, on: boolean): void {
		e.classList.toggle("dd-hide", !on);
	}

	setAccent(hot: string, cool: string): void {
		this.root.style.setProperty("--hot", hot);
		this.root.style.setProperty("--cool", cool);
	}

	screen(s: "title" | "race" | "photo" | "results"): void {
		this.show(this.title, s === "title");
		this.show(this.race, s === "race");
		this.show(this.photo, s === "photo");
		this.show(this.results, s === "results");
	}

	titleScreen(
		tracks: TrackFile[],
		sel: number,
		mode: FlightMode,
		bests: (number | null)[],
		site: string,
	): void {
		const t = tracks[sel] as TrackFile;
		this.kicker.textContent = `FPV time trial  ·  ${site}`;
		this.tagline.textContent = t.tagline;
		this.cards.replaceChildren();
		tracks.forEach((k, i) => {
			const c = el("div", `dd-card${i === sel ? " on" : ""}`, this.cards);
			el("div", "dd-card-name", c, k.name);
			el(
				"div",
				"dd-card-meta",
				c,
				`${k.difficulty} · ${k.gates.length} gates · ${k.laps} laps`,
			);
			const b = bests[i];
			el(
				"div",
				"dd-card-best",
				c,
				b !== null && b !== undefined
					? `BEST LAP ${fmtTime(b)}`
					: `GOLD ${fmtTime(k.medals.gold)}`,
			);
		});
		this.modes[0]?.classList.toggle("on", mode === "assisted");
		this.modes[1]?.classList.toggle("on", mode === "acro");
		this.modeNote.textContent =
			mode === "assisted"
				? "Self-levelling with altitude hold: let go of the sticks and it hovers."
				: "Rate mode: the sticks spin the airframe, nothing levels it, the throttle is yours.";
	}

	raceSetup(track: TrackFile, mode: FlightMode, gates: number): void {
		this.set(
			this.trackName,
			`${track.name} · ${mode === "acro" ? "ACRO" : "ASSIST"}`,
		);
		this.pips.replaceChildren();
		this.pipEls = [];
		for (let i = 0; i < gates; i++)
			this.pipEls.push(el("div", "dd-pip", this.pips));
		this.delta.classList.remove("show");
		this.toastEl.classList.remove("show");
		this.show(this.lost, false);
	}

	timer(lap: number, laps: number, time: number, sub: string): void {
		this.set(
			this.lap,
			lap < 0 ? "TO THE LINE" : `LAP ${Math.min(lap + 1, laps)}/${laps}`,
		);
		this.set(this.time, fmtTime(time));
		this.set(this.sub, sub);
	}

	gates(next: number, nextName: string, racing: boolean): void {
		for (let i = 0; i < this.pipEls.length; i++) {
			const p = this.pipEls[i] as HTMLElement;
			const done = racing && next !== 0 ? i < next && i > 0 : false;
			p.classList.toggle("done", done || (racing && next !== 0 && i === 0));
			p.classList.toggle("next", i === next);
		}
		if (this.cache.get(this.next) !== nextName) {
			this.cache.set(this.next, nextName);
			this.next.innerHTML = `NEXT <b>${nextName.toUpperCase()}</b>`;
		}
	}

	ghostInfo(s: string): void {
		if (this.cache.get(this.ghost) === s) return;
		this.cache.set(this.ghost, s);
		this.ghost.innerHTML = s;
	}

	splitDelta(d: number): void {
		this.delta.textContent = fmtDelta(d);
		this.delta.classList.toggle("ahead", d <= 0);
		this.delta.classList.toggle("behind", d > 0);
		this.delta.classList.add("show");
		this.deltaT = 2.2;
	}

	osd(alt: number, kmh: number, thr: number): void {
		this.set(this.alt, `${alt.toFixed(1)}m`);
		this.set(this.spd, `${Math.round(kmh)}km/h`);
		const n = Math.round(thr * this.thr.length);
		for (let i = 0; i < this.thr.length; i++)
			(this.thr[i] as HTMLElement).classList.toggle("on", i < n);
	}

	camLabel(cam: string, mode: FlightMode): void {
		const s = `CAM <b>${cam.toUpperCase()}</b> · C<br>MODE <b>${mode === "acro" ? "ACRO" : "ASSIST"}</b>`;
		if (this.cache.get(this.cam) === s) return;
		this.cache.set(this.cam, s);
		this.cam.innerHTML = s;
	}

	countdown(n: number): void {
		if (n < 0) {
			this.set(this.count, "");
			return;
		}
		this.set(this.count, n === 0 ? "GO" : String(n));
		this.count.classList.toggle("go", n === 0);
	}

	toast(text: string, sub: string, best = false, secs = 1.8): void {
		this.toastEl.innerHTML = `${text}<small>${sub}</small>`;
		this.toastEl.classList.toggle("best", best);
		this.toastEl.classList.add("show");
		this.toastT = secs;
	}

	signalLost(on: boolean): void {
		this.show(this.lost, on);
	}

	fpvOverlay(on: boolean, roll: number, pitchPx: number): void {
		this.show(this.fpv, on);
		if (on)
			this.horizon.style.transform = `translateY(${pitchPx.toFixed(1)}px) rotate(${(roll * 57.2958).toFixed(1)}deg)`;
	}

	/** Edge arrow toward an off-screen target: x, y in px, angle in radians (0 = up). */
	gateArrow(on: boolean, x = 0, y = 0, angle = 0): void {
		this.show(this.arrow, on);
		if (on)
			this.arrow.style.transform = `translate(${(x - 13).toFixed(0)}px, ${(y - 12).toFixed(0)}px) rotate(${angle.toFixed(3)}rad)`;
	}

	photoFinish(label: string, sub: string, stamp: string): void {
		this.photoLabel.innerHTML = `${label}<small>${sub}</small>`;
		this.photoStamp.innerHTML = stamp;
	}

	flash(a: number): void {
		this.flashEl.style.opacity = a.toFixed(3);
	}

	showResults(r: ResultsData): void {
		const best = r.laps.length > 0 ? Math.min(...r.laps) : -1;
		const medal = medalOf(best, r.track.medals);
		const rows = r.laps
			.map(
				(t, i) =>
					`<div class="dd-res-row${t === best ? " best" : ""}"><span>LAP ${i + 1}</span><span>${fmtTime(t)}</span></div>`,
			)
			.join("");
		const medalHtml = medal
			? `<span style="color:${MEDAL_COLOR[medal]}">${medal} lap</span>`
			: `<span style="color:#9fb0c4">no medal · bronze ${fmtTime(r.track.medals.bronze)}</span>`;
		this.results.innerHTML = `
			<div class="dd-res-kicker">${r.track.name} · ${r.mode === "acro" ? "acro" : "assisted"}</div>
			<div class="dd-res-time">${fmtTime(r.total)}</div>
			<div class="dd-res-medal">${medalHtml}${r.newBest ? ' · <span style="color:#2bf08a">new best lap</span>' : ""}</div>
			<div class="dd-res-laps">${rows}
				<div class="dd-res-row"><span>CRASHES</span><span>${r.crashes}</span></div>
				<div class="dd-res-row"><span>BEST EVER</span><span>${fmtTime(r.best)}</span></div>
			</div>
			<div class="dd-res-ghost">${r.ghostLine}</div>
			<div class="dd-res-keys">ENTER RACE AGAIN · ESC TRACKS</div>`;
	}

	update(dt: number): void {
		if (this.toastT > 0) {
			this.toastT -= dt;
			if (this.toastT <= 0) this.toastEl.classList.remove("show");
		}
		if (this.deltaT > 0) {
			this.deltaT -= dt;
			if (this.deltaT <= 0) this.delta.classList.remove("show");
		}
	}
}
