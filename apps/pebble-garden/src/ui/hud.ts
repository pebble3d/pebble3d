import { CHALLENGES, GARDENS } from "../garden/gardens.ts";
import { COLORS, PIECES } from "../garden/pieces.ts";
import type { ImportIssue } from "../garden/validate.ts";

/**
 * The DOM layer: title, garden picker, editor chrome (palette, inspector, top bar), the
 * export and import dialogs, the result card and toasts. It holds no game state: every
 * button reports an action name to the app, and the app pushes what to show.
 */

export type HudAction =
	| "title"
	| "challenges"
	| "sandbox"
	| "open"
	| "blank"
	| "piece"
	| "play"
	| "reset"
	| "undo"
	| "redo"
	| "export"
	| "import"
	| "download"
	| "copy"
	| "import-apply"
	| "import-file"
	| "close"
	| "delete"
	| "duplicate"
	| "body"
	| "mode"
	| "retry"
	| "next"
	| "menu"
	| "help";

export interface InspectorData {
	id: string;
	label: string;
	locked: boolean;
	body: "dynamic" | "static" | "kinematic" | null;
	color: string;
	roughness: number;
	metalness: number;
	position: [number, number, number];
	rotY: number;
	scale: [number, number, number];
	editable: boolean;
}

export type FieldChange =
	| { field: "color"; value: string }
	| { field: "roughness" | "metalness" | "rotY"; value: number }
	| { field: "pos" | "scale"; axis: 0 | 1 | 2; value: number };

export interface HudHandlers {
	action(a: HudAction, arg?: string): void;
	field(c: FieldChange, commit: boolean): void;
	importFile(file: File): void;
}

const SWATCHES = [
	COLORS.cream,
	COLORS.granite,
	COLORS.basalt,
	COLORS.cedar,
	COLORS.darkCedar,
	COLORS.moss,
	COLORS.jade,
	COLORS.vermilion,
	COLORS.ink,
	"#e9c46a",
	"#7fa7c9",
	"#f4f1ea",
];

/** Small inline SVG glyphs per piece (no image assets). */
const GLYPH: Record<string, string> = {
	box: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
	sphere: '<circle cx="12" cy="12" r="7.5"/>',
	cylinder:
		'<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11"/>',
	capsule: '<rect x="8" y="3" width="8" height="18" rx="4"/>',
	plank: '<path d="M3 15 L20 8 L21 10 L4 17 Z"/>',
	domino:
		'<rect x="9" y="3" width="6" height="18" rx="1"/><path d="M12 7v0M12 16v0" stroke-width="2.4" stroke-linecap="round"/>',
	pebble:
		'<circle cx="12" cy="13" r="5.5"/><path d="M9.5 11.5a3 3 0 0 1 2.5-1.6" />',
	boulder:
		'<path d="M4 17c0-6 3-11 8.5-11S20 10 20 15c0 2-1.6 3-3 3H6c-1.2 0-2-.4-2-1z"/>',
	wall: '<rect x="2" y="10" width="20" height="7" rx="1"/>',
	pillar: '<rect x="8" y="3" width="8" height="18" rx="1.5"/>',
	rake: '<path d="M3 12h18M12 5v14" /><circle cx="12" cy="12" r="2.2"/>',
	roller: '<circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14"/>',
	goal: '<ellipse cx="12" cy="13" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="5" ry="2"/>',
};

function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function stars(n: number): string {
	let s = "";
	for (let i = 0; i < 3; i++)
		s += `<span class="star${i < n ? " on" : ""}">&#9670;</span>`;
	return s;
}

export class Hud {
	private readonly el: HTMLElement;
	private readonly q = <T extends HTMLElement>(sel: string): T =>
		this.el.querySelector(sel) as T;
	private inspectorId: string | null = null;
	interactive = true;

	constructor(
		root: HTMLElement,
		private readonly h: HudHandlers,
	) {
		this.el = root;
		root.innerHTML = this.template();
		root.addEventListener("click", (ev) => {
			const t = (ev.target as HTMLElement).closest<HTMLElement>(
				"[data-action]",
			);
			if (!t || !this.interactive) return;
			ev.preventDefault();
			t.blur();
			this.h.action(t.dataset.action as HudAction, t.dataset.arg);
		});
		root.addEventListener("input", (ev) => this.onField(ev, false));
		root.addEventListener("change", (ev) => this.onField(ev, true));
		const file = this.q<HTMLInputElement>("#import-file");
		file.addEventListener("change", () => {
			const f = file.files?.[0];
			if (f) this.h.importFile(f);
			file.value = "";
		});
		// Keys typed in a field must not reach the editor shortcuts.
		root.addEventListener("keydown", (ev) => {
			const t = ev.target as HTMLElement;
			if (t.tagName === "INPUT" || t.tagName === "TEXTAREA")
				ev.stopPropagation();
		});
	}

	private template(): string {
		const palette = PIECES.map(
			(p) =>
				`<button class="piece" data-action="piece" data-arg="${p.key}" title="${esc(p.blurb)}"><svg viewBox="0 0 24 24">${GLYPH[p.key] ?? ""}</svg><span class="pl">${esc(p.label)}</span>${p.hotkey ? `<kbd>${p.hotkey}</kbd>` : ""}</button>`,
		).join("");
		const swatches = SWATCHES.map(
			(c) =>
				`<button class="sw" data-action="body" data-arg="color:${c}" style="--c:${c}" title="${c}"></button>`,
		).join("");
		const axis = (f: string, i: number, l: string) =>
			`<label class="ax"><span>${l}</span><input type="number" step="0.05" data-field="${f}" data-axis="${i}"></label>`;
		return `
<div id="title" class="screen">
  <div class="title-card">
    <div class="mark"><svg viewBox="0 0 64 64"><circle cx="32" cy="38" r="13"/><path d="M8 52c10-4 38-4 48 0M12 58c8-3 32-3 40 0"/></svg></div>
    <h1>Pebble Garden</h1>
    <p class="tag">A physics sandbox where every garden is a scene file.<br>Build it, run it, rewind it, share it.</p>
    <div class="menu">
      <button class="big primary" data-action="challenges">Challenges</button>
      <button class="big" data-action="sandbox">Sandbox</button>
      <button class="big ghost" data-action="import">Import a scene&hellip;</button>
    </div>
    <p class="fine">Drop any Pebble3D scene JSON onto the page to open it.</p>
  </div>
</div>

<div id="picker" class="screen hidden">
  <div class="picker-card">
    <h2 id="picker-title">Challenges</h2>
    <p id="picker-sub" class="sub"></p>
    <div id="picker-list" class="cards"></div>
    <button class="link" data-action="title">&larr; Back</button>
  </div>
</div>

<div id="editor" class="hidden">
  <header class="topbar">
    <button class="icon" data-action="menu" title="Menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <div class="gname"><span id="garden-name">Garden</span><span id="garden-mode" class="badge">edit</span></div>
    <div class="spacer"></div>
    <div id="goal-status" class="goal-status"><span id="gs-pieces"></span><span id="gs-goal"><span class="pip"></span><span id="gs-text"></span><span class="meter" id="gs-meter"><i id="gs-fill"></i></span></span></div>
    <button class="tool" data-action="undo" title="Undo (Ctrl+Z)"><svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2"/></svg></button>
    <button class="tool" data-action="redo" title="Redo (Ctrl+Shift+Z)"><svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h2"/></svg></button>
    <button class="tool label" data-action="import" title="Import a scene JSON (I)">Import</button>
    <button class="tool label" data-action="export" title="Export the garden as scene JSON (X)">Export</button>
    <button id="play-btn" class="play" data-action="play" title="Play / Reset (Space)"><svg viewBox="0 0 24 24"><path class="ico-play" d="M8 5v14l11-7z"/><path class="ico-reset" d="M5 12a7 7 0 1 0 2.1-5M5 4v4h4"/></svg><span id="play-label">Play</span></button>
  </header>

  <aside class="palette">
    <div class="ph">Pieces</div>
    ${palette}
  </aside>

  <aside id="inspector" class="inspector hidden">
    <div class="ih"><span id="ins-id"></span><span id="ins-lock" class="lock hidden">locked</span></div>
    <div id="ins-label" class="ilabel"></div>
    <div class="isec">
      <div class="it">Body</div>
      <div class="seg" id="ins-body">
        <button data-action="body" data-arg="static">Static</button>
        <button data-action="body" data-arg="dynamic">Dynamic</button>
        <button data-action="body" data-arg="kinematic">Kinematic</button>
      </div>
      <div id="ins-body-note" class="note"></div>
    </div>
    <div class="isec">
      <div class="it">Material</div>
      <div class="swatches">${swatches}<label class="sw custom" title="Any colour"><input type="color" data-field="color"></label></div>
      <label class="slider"><span>Roughness</span><input type="range" min="0" max="1" step="0.01" data-field="roughness"><output id="out-roughness"></output></label>
      <label class="slider"><span>Metalness</span><input type="range" min="0" max="1" step="0.01" data-field="metalness"><output id="out-metalness"></output></label>
    </div>
    <div class="isec">
      <div class="it">Transform</div>
      <div class="row"><span class="rl">Position</span>${axis("pos", 0, "x")}${axis("pos", 1, "y")}${axis("pos", 2, "z")}</div>
      <div class="row"><span class="rl">Scale</span>${axis("scale", 0, "x")}${axis("scale", 1, "y")}${axis("scale", 2, "z")}</div>
      <label class="slider"><span>Turn</span><input type="range" min="-180" max="180" step="5" data-field="rotY"><output id="out-rotY"></output></label>
      <div class="seg small" id="ins-mode">
        <button data-action="mode" data-arg="translate" title="Move (G)">Move <kbd>G</kbd></button>
        <button data-action="mode" data-arg="rotate" title="Rotate (R)">Rotate <kbd>R</kbd></button>
        <button data-action="mode" data-arg="scale" title="Scale (S)">Scale <kbd>S</kbd></button>
      </div>
    </div>
    <div class="iact">
      <button data-action="duplicate">Duplicate <kbd>Ctrl D</kbd></button>
      <button class="danger" data-action="delete">Delete <kbd>Del</kbd></button>
    </div>
  </aside>

  <footer class="hints" id="hints">Click a piece, then click the sand to place it &middot; drag to orbit &middot; right-drag to pan &middot; <kbd>Space</kbd> play / reset &middot; <kbd>Q</kbd><kbd>E</kbd> turn &middot; <kbd>?</kbd> help</footer>
</div>

<div id="toast" class="toast hidden"></div>
<div id="modal" class="modal hidden">
  <div class="sheet" id="sheet-export">
    <div class="sh"><h3>Export garden</h3><button class="icon" data-action="close" title="Close">&times;</button></div>
    <p class="sub" id="export-status"></p>
    <ul class="notes hidden" id="export-notes"></ul>
    <textarea id="export-text" spellcheck="false" readonly></textarea>
    <div class="sfoot"><span class="fine" id="export-meta"></span><div class="spacer"></div>
      <button data-action="copy" id="copy-btn">Copy to clipboard</button>
      <button class="primary" data-action="download">Download .json</button></div>
  </div>
  <div class="sheet" id="sheet-import">
    <div class="sh"><h3>Import a scene</h3><button class="icon" data-action="close" title="Close">&times;</button></div>
    <p class="sub">Paste scene JSON, choose a file, or drop one anywhere on the page. It is checked against the Pebble3D scene schema before anything changes.</p>
    <textarea id="import-text" spellcheck="false" placeholder='{ "version": 1, "entities": [ ... ] }'></textarea>
    <div id="import-errors" class="errors hidden"></div>
    <div class="sfoot"><label class="filebtn">Choose file&hellip;<input type="file" id="import-file" accept=".json,application/json"></label><div class="spacer"></div>
      <button class="primary" data-action="import-apply">Check &amp; open</button></div>
  </div>
  <div class="sheet" id="sheet-result">
    <div class="result-mark" id="result-mark"></div>
    <h3 id="result-title"></h3>
    <p class="sub" id="result-sub"></p>
    <div class="stars" id="result-stars"></div>
    <div class="stats" id="result-stats"></div>
    <div class="sfoot center">
      <button data-action="menu">Menu</button>
      <button data-action="export">Export</button>
      <button data-action="retry" id="retry-btn">Back to building</button>
      <button class="primary" data-action="next" id="next-btn">Next garden</button>
    </div>
  </div>
  <div class="sheet" id="sheet-help">
    <div class="sh"><h3>Controls</h3><button class="icon" data-action="close" title="Close">&times;</button></div>
    <table class="keys">
      <tr><td>Click piece, click sand</td><td>place (Shift keeps placing)</td></tr>
      <tr><td>Click a piece in the garden</td><td>select it</td></tr>
      <tr><td><kbd>G</kbd> <kbd>R</kbd> <kbd>S</kbd></td><td>move / rotate / scale gizmo</td></tr>
      <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>turn 15&deg;</td></tr>
      <tr><td>Arrow keys, <kbd>PgUp</kbd> <kbd>PgDn</kbd></td><td>nudge 0.25 m</td></tr>
      <tr><td><kbd>1</kbd>&ndash;<kbd>0</kbd></td><td>pick a piece</td></tr>
      <tr><td><kbd>Del</kbd>, <kbd>Ctrl D</kbd></td><td>delete, duplicate</td></tr>
      <tr><td><kbd>Ctrl Z</kbd>, <kbd>Ctrl Shift Z</kbd></td><td>undo, redo</td></tr>
      <tr><td><kbd>Space</kbd></td><td>play / reset (reset rewinds exactly)</td></tr>
      <tr><td><kbd>X</kbd>, <kbd>I</kbd></td><td>export, import</td></tr>
      <tr><td>Drag, right-drag, wheel</td><td>orbit, pan, zoom</td></tr>
    </table>
    <p class="fine">Kinematic pieces are motors: on Play each turns about its own up axis. Challenge gardens need a <code>pebble</code> and a <code>goal</code> entity; their own pieces are locked.</p>
  </div>
</div>

<div id="drop" class="drop hidden"><div>Drop a scene JSON to open it</div></div>
`;
	}

	private onField(ev: Event, commit: boolean): void {
		const t = ev.target as HTMLInputElement;
		const f = t.dataset.field;
		if (!f || !this.interactive) return;
		if (f === "color") this.h.field({ field: "color", value: t.value }, commit);
		else if (f === "pos" || f === "scale") {
			const v = Number(t.value);
			if (!Number.isFinite(v)) return;
			if (!commit) return; // number boxes apply on change
			this.h.field(
				{ field: f, axis: Number(t.dataset.axis) as 0 | 1 | 2, value: v },
				true,
			);
		} else if (f === "roughness" || f === "metalness" || f === "rotY") {
			const v = Number(t.value);
			const out = this.el.querySelector(`#out-${f}`);
			if (out) out.textContent = f === "rotY" ? `${v}°` : v.toFixed(2);
			this.h.field({ field: f, value: v }, commit);
		}
	}

	// --- screens ---------------------------------------------------------------------
	show(screen: "title" | "picker" | "editor"): void {
		this.q("#title").classList.toggle("hidden", screen !== "title");
		this.q("#picker").classList.toggle("hidden", screen !== "picker");
		this.q("#editor").classList.toggle("hidden", screen !== "editor");
		if (screen !== "editor") this.closeModal();
	}

	showPicker(
		kind: "challenges" | "sandbox",
		best: Record<string, number>,
	): void {
		this.q("#picker-title").textContent =
			kind === "challenges" ? "Challenges" : "Sandbox";
		this.q("#picker-sub").textContent =
			kind === "challenges"
				? "Get the vermilion pebble to rest in the moss bowl. The garden's own pieces are locked; add yours."
				: "Open a garden and build freely. Everything is editable.";
		const list = kind === "challenges" ? CHALLENGES : GARDENS;
		let html = list
			.map(
				(g, i) =>
					`<button class="gcard" data-action="open" data-arg="${g.key}${kind === "sandbox" ? ":free" : ""}"><span class="gnum">${kind === "challenges" ? i + 1 : ""}</span><span class="gname2">${esc(g.name)}</span><span class="gblurb">${esc(g.blurb)}</span>${kind === "challenges" ? `<span class="gstars">${stars(best[g.key] ?? 0)}</span><span class="gpar">par ${g.par}</span>` : ""}</button>`,
			)
			.join("");
		if (kind === "sandbox")
			html += `<button class="gcard blank" data-action="blank"><span class="gname2">Blank garden</span><span class="gblurb">Raked sand and nothing else.</span></button>`;
		this.q("#picker-list").innerHTML = html;
		this.show("picker");
	}

	// --- editor chrome ---------------------------------------------------------------
	setGarden(name: string): void {
		this.q("#garden-name").textContent = name;
	}

	setPlaying(playing: boolean): void {
		this.q("#garden-mode").textContent = playing ? "playing" : "edit";
		this.q("#garden-mode").classList.toggle("live", playing);
		this.q("#play-btn").classList.toggle("on", playing);
		this.q("#play-label").textContent = playing ? "Reset" : "Play";
		this.q("#editor").classList.toggle("playing", playing);
	}

	/**
	 * The top bar's goal readout. Fixed elements written with textContent / style only,
	 * so the per-frame play update (called only when a shown value changes) never
	 * re-parses HTML.
	 */
	setGoalStatus(
		pieces: string | null,
		text: string,
		bold: boolean,
		meter: number | null,
	): void {
		const p = this.q("#gs-pieces");
		p.classList.toggle("hidden", pieces === null);
		if (pieces !== null) p.textContent = pieces;
		this.setGoalLive(text, bold, meter);
	}

	setGoalLive(text: string, bold: boolean, meter: number | null): void {
		const t = this.q("#gs-text");
		t.textContent = text;
		t.style.fontWeight = bold ? "600" : "";
		this.q("#gs-meter").classList.toggle("hidden", meter === null);
		if (meter !== null) this.q("#gs-fill").style.width = `${meter}%`;
		this.q("#gs-goal")
			.querySelector(".pip")
			?.classList.toggle("hidden", !this.goalPip);
	}

	/** Whether the garden has a goal (shows the pebble pip). */
	goalPip = true;

	setArmed(piece: string | null): void {
		for (const b of this.el.querySelectorAll<HTMLElement>(".piece"))
			b.classList.toggle("armed", b.dataset.arg === piece);
	}

	setGizmoMode(mode: string): void {
		for (const b of this.el.querySelectorAll<HTMLElement>("#ins-mode button"))
			b.classList.toggle("on", b.dataset.arg === mode);
	}

	setHints(text: string): void {
		this.q("#hints").innerHTML = text;
	}

	inspect(d: InspectorData | null): void {
		const ins = this.q("#inspector");
		ins.classList.toggle("hidden", d === null);
		if (!d) {
			this.inspectorId = null;
			return;
		}
		this.inspectorId = d.id;
		this.q("#ins-id").textContent = d.id;
		this.q("#ins-label").textContent = d.label;
		this.q("#ins-lock").classList.toggle("hidden", !d.locked);
		ins.classList.toggle("locked", !d.editable);
		for (const b of this.el.querySelectorAll<HTMLElement>("#ins-body button"))
			b.classList.toggle("on", b.dataset.arg === d.body);
		this.q("#ins-body-note").textContent =
			d.body === "kinematic"
				? "A motor: turns about its own up axis on Play."
				: d.body === "static"
					? "Fixed in place."
					: d.body === "dynamic"
						? "Falls, rolls and collides."
						: "No body: scenery only.";
		const set = (sel: string, v: string): void => {
			const el = this.el.querySelector<HTMLInputElement>(sel);
			if (el && document.activeElement !== el) el.value = v;
		};
		set('input[data-field="color"]', d.color);
		set('input[data-field="roughness"]', String(d.roughness));
		set('input[data-field="metalness"]', String(d.metalness));
		set('input[data-field="rotY"]', String(Math.round(d.rotY)));
		this.q("#out-roughness").textContent = d.roughness.toFixed(2);
		this.q("#out-metalness").textContent = d.metalness.toFixed(2);
		this.q("#out-rotY").textContent = `${Math.round(d.rotY)}°`;
		for (let i = 0; i < 3; i++) {
			set(
				`input[data-field="pos"][data-axis="${i}"]`,
				d.position[i]?.toFixed(2) ?? "0",
			);
			set(
				`input[data-field="scale"][data-axis="${i}"]`,
				d.scale[i]?.toFixed(2) ?? "1",
			);
		}
		for (const b of this.el.querySelectorAll<HTMLElement>(".sw[data-arg]"))
			b.classList.toggle("on", b.dataset.arg === `color:${d.color}`);
	}

	get inspecting(): string | null {
		return this.inspectorId;
	}

	// --- dialogs ---------------------------------------------------------------------
	private openSheet(id: string): void {
		this.q("#modal").classList.remove("hidden");
		for (const s of this.el.querySelectorAll<HTMLElement>(".sheet"))
			s.classList.toggle("hidden", s.id !== id);
	}

	closeModal(): void {
		this.q("#modal").classList.add("hidden");
	}

	get modalOpen(): string | null {
		if (this.q("#modal").classList.contains("hidden")) return null;
		const s = this.el.querySelector<HTMLElement>(".sheet:not(.hidden)");
		return s?.id.replace("sheet-", "") ?? null;
	}

	showExport(
		text: string,
		status: string,
		meta: string,
		notes: readonly string[] = [],
	): void {
		this.q<HTMLTextAreaElement>("#export-text").value = text;
		this.q("#export-status").innerHTML = status;
		this.q("#export-meta").textContent = meta;
		this.q("#copy-btn").textContent = "Copy to clipboard";
		const ul = this.q("#export-notes");
		ul.replaceChildren(
			...notes.map((n) => {
				const li = document.createElement("li");
				li.textContent = n;
				return li;
			}),
		);
		ul.classList.toggle("hidden", notes.length === 0);
		this.openSheet("sheet-export");
	}

	exportScroll(fraction: number): void {
		const ta = this.q<HTMLTextAreaElement>("#export-text");
		ta.scrollTop = (ta.scrollHeight - ta.clientHeight) * fraction;
	}

	setCopyLabel(text: string): void {
		this.q("#copy-btn").textContent = text;
	}

	showImport(
		text = "",
		issues: readonly ImportIssue[] | null = null,
		title = "",
	): void {
		const ta = this.q<HTMLTextAreaElement>("#import-text");
		if (text) ta.value = text;
		this.renderIssues(issues, title);
		this.openSheet("sheet-import");
	}

	importValue(): string {
		return this.q<HTMLTextAreaElement>("#import-text").value;
	}

	private renderIssues(
		issues: readonly ImportIssue[] | null,
		title: string,
	): void {
		const box = this.q("#import-errors");
		if (!issues || issues.length === 0) {
			box.classList.add("hidden");
			box.innerHTML = "";
			return;
		}
		const max = 12;
		const rows = issues
			.slice(0, max)
			.map(
				(i) =>
					`<li><div class="eh">${i.line !== undefined ? `<span class="ln">line ${i.line}${i.column !== undefined ? `:${i.column}` : ""}</span>` : ""}<code class="path">${esc(i.path || "(scene)")}</code></div><div class="em">${esc(i.message)}</div>${i.hint ? `<div class="hint">${esc(i.hint)}</div>` : ""}</li>`,
			)
			.join("");
		const more =
			issues.length > max
				? `<li class="more">and ${issues.length - max} more</li>`
				: "";
		box.innerHTML = `<div class="etitle">${esc(title)}</div><ul>${rows}${more}</ul>`;
		box.classList.remove("hidden");
	}

	showResult(r: {
		won: boolean;
		title: string;
		sub: string;
		stars: number;
		stats: [string, string][];
		next: boolean;
	}): void {
		this.q("#result-mark").className = `result-mark ${r.won ? "won" : "lost"}`;
		this.q("#result-title").textContent = r.title;
		this.q("#result-sub").textContent = r.sub;
		this.q("#result-stars").innerHTML =
			r.won && r.stars > 0 ? stars(r.stars) : "";
		this.q("#result-stats").innerHTML = r.stats
			.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
			.join("");
		this.q("#next-btn").classList.toggle("hidden", !r.next);
		this.q("#retry-btn").textContent = r.won
			? "Keep building"
			: "Back to building";
		this.openSheet("sheet-result");
	}

	showHelp(): void {
		this.openSheet("sheet-help");
	}

	toast(text: string, kind: "ok" | "warn" | "err" = "ok"): void {
		const t = this.q("#toast");
		t.textContent = text;
		t.className = `toast ${kind}`;
		window.clearTimeout(Number(t.dataset.timer ?? 0));
		t.dataset.timer = String(
			window.setTimeout(() => t.classList.add("hidden"), 3200),
		);
	}

	showDrop(on: boolean): void {
		this.q("#drop").classList.toggle("hidden", !on);
	}
}
