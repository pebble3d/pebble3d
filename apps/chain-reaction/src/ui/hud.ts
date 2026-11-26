import type { Level, PartKind } from "../puzzle/level.ts";
import { PART_KINDS } from "../puzzle/level.ts";

/** DOM HUD: title/level select, the play bar and parts tray, and the results card. */

const ICONS: Record<PartKind, string> = {
	ramp: `<svg viewBox="0 0 40 40"><rect x="4" y="17" width="32" height="6" rx="2.5" transform="rotate(35 20 20)" fill="#f08a24"/></svg>`,
	domino: `<svg viewBox="0 0 40 40"><rect x="14" y="3" width="12" height="34" rx="2.5" fill="#f3eee2"/><rect x="15.5" y="19" width="9" height="1.6" fill="#26272c"/><circle cx="20" cy="11" r="1.8" fill="#26272c"/><circle cx="17.5" cy="26" r="1.6" fill="#26272c"/><circle cx="22.5" cy="31" r="1.6" fill="#26272c"/></svg>`,
	spring: `<svg viewBox="0 0 40 40"><rect x="7" y="33" width="26" height="4" rx="1.5" fill="#5b616c"/><path d="M12 31 L28 28 L12 25 L28 22 L12 19 L28 16" stroke="#cfd5de" stroke-width="2.4" fill="none" stroke-linejoin="round"/><rect x="8" y="9" width="24" height="5" rx="2" fill="#e5402f"/></svg>`,
	fan: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="none" stroke="#3d8be0" stroke-width="3"/><g fill="#cfd5de"><ellipse cx="20" cy="12" rx="3.6" ry="7"/><ellipse cx="20" cy="28" rx="3.6" ry="7"/><ellipse cx="12" cy="20" rx="7" ry="3.6"/><ellipse cx="28" cy="20" rx="7" ry="3.6"/></g><circle cx="20" cy="20" r="3" fill="#1c2a3c"/></svg>`,
	seesaw: `<svg viewBox="0 0 40 40"><path d="M14 36 L26 36 L20 24 Z" fill="#6d55a8"/><rect x="3" y="20" width="34" height="4.5" rx="2" transform="rotate(-14 20 22)" fill="#8f5fd6"/></svg>`,
};

const NAMES: Record<PartKind, string> = {
	ramp: "Ramp",
	domino: "Domino",
	spring: "Spring",
	fan: "Fan",
	seesaw: "See-saw",
};

/** Level text comes from JSON files; escape it anyway before it goes into markup. */
const esc = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STAR = `<svg viewBox="0 0 24 24"><path d="M12 2.6l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.9 6.2 20.1l1.4-6.4L2.7 9.3l6.5-.7z"/></svg>`;

export interface HudHandlers {
	onPlay(levelIndex: number): void;
	onSelectPart(kind: PartKind): void;
	onRun(): void;
	onReset(): void;
	onClear(): void;
	onMenu(): void;
	onNext(): void;
	onRetry(): void;
}

export interface ResultInfo {
	solved: boolean;
	reason: string | null;
	stars: number;
	parts: number;
	par: number;
	seconds: number;
	hash: string;
	/** True/false when the run is the reference solution and has a stored Node hash. */
	verified: boolean | null;
	last: boolean;
	placementsJson: string;
	levelId: string;
}

export class Hud {
	private readonly h: HudHandlers;
	private readonly title: HTMLElement;
	private readonly play: HTMLElement;
	private readonly result: HTMLElement;
	private readonly tray: HTMLElement;
	private readonly levelName: HTMLElement;
	private readonly levelHint: HTMLElement;
	private readonly partsUsed: HTMLElement;
	private readonly starsRow: HTMLElement;
	private readonly runBtn: HTMLButtonElement;
	private readonly status: HTMLElement;
	private readonly toast: HTMLElement;
	private toastTimer = 0;

	constructor(root: HTMLElement, h: HudHandlers) {
		this.h = h;
		root.innerHTML = `
<section class="title" hidden>
  <div class="logo">
    <div class="logo-chain"><i></i><i></i><i></i><i></i><b></b></div>
    <h1>CHAIN<br/>REACTION</h1>
    <p>Build a contraption. Press run. Every run plays out exactly the same.</p>
  </div>
  <div class="levels"></div>
  <div class="foot">Levels are JSON scenes · each one is verified headless by <code>pnpm verify</code></div>
</section>
<section class="play" hidden>
  <header class="bar">
    <button class="ghost-btn menu" title="Menu (Esc)">◂ Levels</button>
    <div class="lvl"><span class="lvl-name"></span><span class="lvl-hint"></span></div>
    <div class="score"><span class="parts-used"></span><span class="stars"></span></div>
  </header>
  <div class="status"></div>
  <footer class="dock">
    <div class="tray"></div>
    <div class="actions">
      <button class="run">▶ Run</button>
      <button class="ghost-btn clear" title="Remove all parts">Clear</button>
    </div>
  </footer>
  <div class="keys">Click a cell to place · Right-click to remove · R / wheel rotates · Space runs</div>
</section>
<section class="result" hidden></section>
<div class="toast" hidden></div>`;
		const q = <T extends HTMLElement>(s: string): T => {
			const el = root.querySelector(s);
			if (!el) throw new Error(`hud: ${s} missing`);
			return el as T;
		};
		this.title = q(".title");
		this.play = q(".play");
		this.result = q(".result");
		this.tray = q(".tray");
		this.levelName = q(".lvl-name");
		this.levelHint = q(".lvl-hint");
		this.partsUsed = q(".parts-used");
		this.starsRow = q(".stars");
		this.runBtn = q<HTMLButtonElement>(".run");
		this.status = q(".status");
		this.toast = q(".toast");
		q(".menu").addEventListener("click", () => h.onMenu());
		q(".clear").addEventListener("click", () => h.onClear());
		this.runBtn.addEventListener("click", () => {
			if (this.runBtn.dataset.state === "run") h.onReset();
			else h.onRun();
		});
		// A clicked button must not keep focus: Space is the global run/reset key, and a
		// focused button would also be activated by it (a double fire in some browsers).
		root.addEventListener("click", (e) => {
			(e.target as HTMLElement | null)?.closest("button")?.blur();
		});
		// Keep clicks on HUD controls from reaching the board.
		for (const el of [
			this.play.querySelector(".dock"),
			this.play.querySelector(".bar"),
		])
			el?.addEventListener("pointerdown", (e) => e.stopPropagation());
	}

	showTitle(levels: readonly Level[], best: number[]): void {
		this.play.hidden = true;
		this.result.hidden = true;
		this.title.hidden = false;
		const box = this.title.querySelector(".levels") as HTMLElement;
		box.innerHTML = levels
			.map((l, i) => {
				const s = best[i] ?? 0;
				const stars = [1, 2, 3]
					.map((k) => `<span class="st${k <= s ? " on" : ""}">${STAR}</span>`)
					.join("");
				return `<button class="card" data-i="${i}"><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="nm">${esc(l.name)}</span><span class="cs">${stars}</span></button>`;
			})
			.join("");
		for (const b of box.querySelectorAll<HTMLButtonElement>(".card"))
			b.addEventListener("click", () => this.h.onPlay(Number(b.dataset.i)));
	}

	showPlay(level: Level, index: number): void {
		this.title.hidden = true;
		this.result.hidden = true;
		this.play.hidden = false;
		this.levelName.textContent = `${String(index + 1).padStart(2, "0")} · ${level.name}`;
		this.levelHint.textContent = level.hint;
		this.tray.innerHTML = PART_KINDS.filter((k) => level.inventory[k])
			.map(
				(k, i) =>
					`<button class="part" data-kind="${k}" title="${NAMES[k]} (${i + 1})">${ICONS[k]}<span class="pn">${NAMES[k]}</span><span class="pc"></span><kbd>${i + 1}</kbd></button>`,
			)
			.join("");
		for (const b of this.tray.querySelectorAll<HTMLButtonElement>(".part"))
			b.addEventListener("click", () =>
				this.h.onSelectPart(b.dataset.kind as PartKind),
			);
	}

	/** Remaining counts, the selection and the live star preview. */
	updateTray(
		level: Level,
		used: Partial<Record<PartKind, number>>,
		selected: PartKind | null,
		count: number,
	): void {
		for (const b of this.tray.querySelectorAll<HTMLButtonElement>(".part")) {
			const k = b.dataset.kind as PartKind;
			const left = (level.inventory[k] ?? 0) - (used[k] ?? 0);
			(b.querySelector(".pc") as HTMLElement).textContent = `×${left}`;
			b.classList.toggle("sel", k === selected);
			b.classList.toggle("empty", left <= 0);
		}
		this.partsUsed.textContent = `${count} part${count === 1 ? "" : "s"} · par ${level.par}`;
		const stars =
			count === 0 ? 3 : count <= level.par ? 3 : count <= level.par + 1 ? 2 : 1;
		this.starsRow.innerHTML = [1, 2, 3]
			.map((k) => `<span class="st${k <= stars ? " on" : ""}">${STAR}</span>`)
			.join("");
	}

	setRunning(running: boolean): void {
		this.runBtn.dataset.state = running ? "run" : "edit";
		this.runBtn.textContent = running ? "↺ Reset" : "▶ Run";
		this.play.classList.toggle("running", running);
	}

	setStatus(text: string): void {
		this.status.textContent = text;
		this.status.classList.toggle("on", text.length > 0);
	}

	flash(text: string): void {
		this.toast.textContent = text;
		this.toast.hidden = false;
		window.clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(() => {
			this.toast.hidden = true;
		}, 1600);
	}

	showResult(r: ResultInfo): void {
		const stars = [1, 2, 3]
			.map(
				(k) =>
					`<span class="st big${r.solved && k <= r.stars ? " on" : ""}" style="--d:${k * 0.12}s">${STAR}</span>`,
			)
			.join("");
		const verify =
			r.verified === true
				? `<span class="ok">✓ identical to the Node verifier</span>`
				: r.verified === false
					? `<span class="bad">✗ differs from the Node verifier</span>`
					: `<span class="dim">reproduce headless: <code>pnpm --filter chain-reaction verify ${esc(r.levelId)} --placements '…'</code></span>`;
		const reason =
			r.reason === "timeout"
				? "Out of time."
				: r.reason === "stopped"
					? "The machine came to rest."
					: r.reason === "lost"
						? "The ball left the board."
						: "";
		this.result.innerHTML = `
<div class="card-r ${r.solved ? "win" : "lose"}">
  <h2>${r.solved ? "Solved!" : "Not quite"}</h2>
  ${r.solved ? `<div class="stars-r">${stars}</div>` : `<p class="why">${reason}</p>`}
  <dl>
    <div><dt>Parts</dt><dd>${r.parts} <small>par ${r.par}</small></dd></div>
    <div><dt>Time</dt><dd>${r.seconds.toFixed(2)}<small>s</small></dd></div>
    <div><dt>State hash</dt><dd class="mono">${r.hash}</dd></div>
  </dl>
  <p class="verify">${verify}</p>
  <div class="btns">
    <button class="ghost-btn retry">${r.solved ? "Improve" : "Edit"}</button>
    ${r.solved && !r.last ? `<button class="next">Next level ▸</button>` : `<button class="next">Levels</button>`}
  </div>
</div>`;
		this.result.hidden = false;
		const placements = r.placementsJson;
		const code = this.result.querySelector(".verify code");
		if (code) code.setAttribute("title", placements);
		(this.result.querySelector(".retry") as HTMLElement).addEventListener(
			"click",
			() => this.h.onRetry(),
		);
		(this.result.querySelector(".next") as HTMLElement).addEventListener(
			"click",
			() => (r.solved && !r.last ? this.h.onNext() : this.h.onMenu()),
		);
	}

	hideResult(): void {
		this.result.hidden = true;
	}
}
