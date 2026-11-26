import type { LevelDef } from "../levels.ts";

export interface HudCallbacks {
	start(): void;
	next(): void;
	replay(): void;
	restart(): void;
}

export interface LevelSummary {
	level: LevelDef;
	index: number;
	count: number;
	fraction: number;
	stars: number;
	kg: number;
	shots: { kg: number; best: boolean }[];
}

export interface RunSummary {
	totalKg: number;
	levels: { name: string; stars: number; fraction: number }[];
	best: { level: string; index: number; kg: number } | null;
	blocks: number;
}

const t = (kg: number): string => (kg / 1000).toFixed(1);
const stars = (n: number): string =>
	`${"★".repeat(n)}<span class="off">${"★".repeat(3 - n)}</span>`;

/** DOM HUD. Built once; per-frame updates only touch text and widths when values change. */
export class Hud {
	private readonly root: HTMLElement;
	private readonly el: Record<string, HTMLElement> = {};
	private last: Record<string, string> = {};
	private toastTimer = 0;

	constructor(root: HTMLElement, cb: HudCallbacks, blocks: number) {
		this.root = root;
		root.innerHTML = `
<section class="bp-title" data-id="title">
  <div class="bp-kicker">Demolition trials · Rust/WASM physics</div>
  <h1 class="bp-wordmark">Break<span class="crack">/</span>point</h1>
  <p class="bp-tagline">Three stone sites. Three iron balls each. Find the weak point, bring it down, and knock the most mass below the line.</p>
  <div class="bp-cta-row">
    <button class="bp-btn" data-id="start">Start demolition</button>
    <span class="bp-hint">or press space</span>
  </div>
  <div class="bp-specs">
    <div><b data-id="specBlocks">${blocks.toLocaleString("en-US")}</b>rigid bodies</div>
    <div><b>60 Hz</b>fixed-step Rapier</div>
    <div><b>1:1</b>deterministic replays</div>
  </div>
</section>
<section class="bp-settle hidden" data-id="settle">
  <div class="bp-site" data-id="settleSite">Site 1 / 3</div>
  <div class="bp-site-name" data-id="settleName"></div>
  <p data-id="settleSub"></p>
</section>
<section class="bp-top hidden" data-id="top">
  <div>
    <div class="bp-site" data-id="siteIdx"></div>
    <div class="bp-site-name" data-id="siteName"></div>
  </div>
  <div class="bp-meter">
    <div class="bp-meter-head"><span>Below the line</span><b data-id="meterVal"></b></div>
    <div class="bp-bar">
      <div class="bp-bar-fill" data-id="fill"></div>
      <div class="bp-tick" data-id="tickPar"><span>★</span></div>
      <div class="bp-tick" style="left:60%"><span>★★</span></div>
      <div class="bp-tick" style="left:85%"><span>★★★</span></div>
    </div>
  </div>
  <div class="bp-shots">
    <div class="bp-site">Shots</div>
    <div class="bp-pips" data-id="pips"></div>
  </div>
</section>
<section class="bp-power hidden" data-id="power">
  <div class="bp-power-bar"><div class="bp-power-fill" data-id="powerFill"></div></div>
  <div class="bp-hint" data-id="hint">Point at a weak spot · hold to charge · release to fire</div>
</section>
<section class="bp-toast" data-id="toast">
  <div class="bp-toast-big" data-id="toastBig"></div>
  <div class="bp-toast-sub" data-id="toastSub"></div>
</section>
<section class="bp-card hidden" data-id="card"></section>
<section class="bp-letterbox hidden" data-id="replay">
  <div class="bp-replay-tag"><span class="bp-rec"></span><span data-id="replayTag">Replay</span></div>
  <div class="bp-replay-info">
    <div data-id="replayInfo"></div>
    <div class="bp-verify" data-id="verify">Re-simulating…</div>
  </div>
</section>
<section class="bp-perf" data-id="perf"></section>`;
		for (const n of root.querySelectorAll<HTMLElement>("[data-id]"))
			this.el[n.dataset.id as string] = n;
		this.on("start", cb.start);
		root.addEventListener("click", (e) => {
			const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
			if (!b) return;
			const act = b.dataset.act;
			if (act === "next") cb.next();
			else if (act === "replay") cb.replay();
			else if (act === "restart") cb.restart();
		});
	}

	private on(id: string, f: () => void): void {
		this.el[id]?.addEventListener("click", (e) => {
			e.stopPropagation();
			f();
		});
	}

	private text(id: string, s: string): void {
		if (this.last[id] === s) return;
		this.last[id] = s;
		const e = this.el[id];
		if (e) e.textContent = s;
	}

	private html(id: string, s: string): void {
		if (this.last[id] === s) return;
		this.last[id] = s;
		const e = this.el[id];
		if (e) e.innerHTML = s;
	}

	show(id: string, v: boolean): void {
		this.el[id]?.classList.toggle("hidden", !v);
	}

	setVisible(v: boolean): void {
		this.root.style.display = v ? "" : "none";
	}

	settle(level: LevelDef, index: number, count: number): void {
		this.text("settleSite", `Site ${index + 1} / ${count}`);
		this.text("settleName", level.name);
		this.text("settleSub", level.subtitle);
	}

	/** Top bar. Strings are only rebuilt when an input changes (no per-frame garbage). */
	top(
		level: LevelDef,
		index: number,
		count: number,
		shotsLeft: number,
		fraction: number,
		kg: number,
	): void {
		const tenths = Math.round(kg / 100);
		const pct = Math.round(fraction * 1000);
		const k = this.topKey;
		if (
			k[0] === level.shots &&
			k[1] === index &&
			k[2] === shotsLeft &&
			k[3] === tenths &&
			k[4] === pct
		)
			return;
		k[0] = level.shots;
		k[1] = index;
		k[2] = shotsLeft;
		k[3] = tenths;
		k[4] = pct;
		this.text("siteIdx", `Site ${index + 1} / ${count}`);
		this.text("siteName", level.name);
		this.text("meterVal", `${t(kg)} t · ${Math.round(fraction * 100)}%`);
		(this.el.fill as HTMLElement).style.width =
			`${Math.min(100, fraction * 100).toFixed(1)}%`;
		(this.el.tickPar as HTMLElement).style.left = `${level.par * 100}%`;
		let pips = "";
		for (let i = 0; i < level.shots; i++)
			pips += `<div class="bp-pip${i < level.shots - shotsLeft ? " spent" : ""}"></div>`;
		this.html("pips", pips);
	}
	private readonly topKey = [-1, -1, -1, -1, -1];

	power(k: number, reachable: boolean, hint: string): void {
		const pct = Math.round(k * 100);
		if (pct !== this.powerPct) {
			this.powerPct = pct;
			(this.el.powerFill as HTMLElement).style.width = `${pct}%`;
		}
		if (reachable !== this.powerOk) {
			this.powerOk = reachable;
			(this.el.powerFill as HTMLElement).style.filter = reachable
				? ""
				: "hue-rotate(-25deg) saturate(1.6)";
		}
		this.text("hint", hint);
	}
	private powerPct = -1;
	private powerOk = true;

	toast(big: string, sub: string, ms = 1800): void {
		this.text("toastBig", big);
		this.text("toastSub", sub);
		this.el.toast?.classList.add("on");
		clearTimeout(this.toastTimer);
		this.toastTimer = window.setTimeout(
			() => this.el.toast?.classList.remove("on"),
			ms,
		);
	}

	hideToast(): void {
		clearTimeout(this.toastTimer);
		this.el.toast?.classList.remove("on");
	}

	levelCard(s: LevelSummary): void {
		const rows = s.shots
			.map(
				(sh, i) =>
					`<div class="k">Shot ${i + 1}</div><div class="v${sh.best ? " best" : ""}">${t(sh.kg)} t${sh.best ? " · best" : ""}</div>`,
			)
			.join("");
		this.html(
			"card",
			`<div class="bp-site">Site ${s.index + 1} / ${s.count} · ${s.stars > 0 ? "par beaten" : "below par"}</div>
<h2>${s.level.name}</h2>
<div class="bp-stars">${stars(s.stars)}</div>
<div class="bp-big-number">${Math.round(s.fraction * 100)}%<small>${t(s.kg)} t below the line</small></div>
<div class="bp-rows" style="margin-top:18px">${rows}</div>
<button class="bp-btn" data-act="next">Next site</button>`,
		);
		this.show("card", true);
	}

	runCard(r: RunSummary): void {
		const lv = r.levels
			.map(
				(l) =>
					`<div class="k">${l.name}</div><div class="v"><span style="color:var(--good)">${"★".repeat(l.stars)}</span> ${Math.round(l.fraction * 100)}%</div>`,
			)
			.join("");
		const best = r.best
			? `<div class="k best">Best shot</div><div class="v best">${r.best.level} #${r.best.index + 1} · ${t(r.best.kg)} t</div>`
			: "";
		this.html(
			"card",
			`<div class="bp-site">Demolition report</div>
<div class="bp-big-number">${t(r.totalKg)}<small>tonnes below the line</small></div>
<div class="bp-rows" style="margin-top:22px">${lv}${best}</div>
<div class="bp-cta-row">
  ${r.best ? '<button class="bp-btn" data-act="replay">Replay best shot</button>' : ""}
  <button class="bp-btn ghost" data-act="restart">Play again</button>
</div>`,
		);
		this.show("card", true);
	}

	replay(on: boolean, tag = "", info = ""): void {
		this.show("replay", on);
		if (on) {
			this.text("replayTag", tag);
			this.html("replayInfo", info);
		}
	}

	verify(text: string, ok: boolean): void {
		this.text("verify", text);
		this.el.verify?.classList.toggle("ok", ok);
	}

	perf(s: string): void {
		this.html("perf", s);
	}
}
