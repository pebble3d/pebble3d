import { MAX_PLAYERS } from "../constants.ts";
import type { SlotKind } from "../match.ts";
import { LOOKS } from "../view/orbs.ts";

export type Screen = "title" | "play" | "replay" | "results";

export interface HudActions {
	onSeat(slot: number): void;
	onRounds(): void;
	onStart(): void;
	onRematch(): void;
	onMenu(): void;
	onSkip(): void;
}

export interface ResultRow {
	slot: number;
	kind: SlotKind;
	wins: number;
	kos: number;
	dashes: number;
	bestHit: number;
}

export interface ResultData {
	champion: number;
	rows: ResultRow[];
	rounds: {
		winner: number;
		seconds: number;
		hash: string;
		verified: boolean | null;
	}[];
}

const KIND_LABEL: Record<SlotKind, string> = {
	p1: "Player 1",
	p2: "Player 2",
	bot: "Bot",
	off: "Empty",
};
const KIND_KEYS: Record<SlotKind, string> = {
	p1: "WASD · Space to dash",
	p2: "Arrows · Enter to dash",
	bot: "AI fills the seat",
	off: "",
};
const CTL: Record<SlotKind, string> = {
	p1: "WASD",
	p2: "ARROWS",
	bot: "BOT",
	off: "",
};

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	cls: string,
	parent: HTMLElement,
	text = "",
): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text) e.textContent = text;
	parent.append(e);
	return e;
}

function setText(e: HTMLElement, t: string): void {
	if (e.textContent !== t) e.textContent = t;
}

interface SeatEls {
	root: HTMLElement;
	name: HTMLElement;
	ctl: HTMLElement;
	pips: HTMLElement;
	dash: HTMLElement;
	tag: HTMLElement;
	out: boolean;
	dashFrac: number;
}

interface CardEls {
	root: HTMLElement;
	kind: HTMLElement;
	keys: HTMLElement;
}

/** The DOM HUD. Built once; per-frame updates only touch what changed. */
export class Hud {
	private readonly title: HTMLElement;
	private readonly play: HTMLElement;
	private readonly replay: HTMLElement;
	private readonly results: HTMLElement;
	private readonly cards: CardEls[] = [];
	private readonly roundsLabel: HTMLElement;
	private readonly goBtn: HTMLElement;
	private readonly seatsRoot: HTMLElement;
	private readonly seats: SeatEls[] = [];
	private readonly labels: HTMLElement[] = [];
	private readonly roundEl: HTMLElement;
	private readonly clockEl: HTMLElement;
	private readonly statusK: HTMLElement;
	private readonly statusV: HTMLElement;
	private readonly banner: HTMLElement;
	private readonly bannerBig: HTMLElement;
	private readonly bannerSub: HTMLElement;
	private readonly toastEl: HTMLElement;
	private toastT = 0;
	private readonly speedEl: HTMLElement;
	private readonly proofLine: HTMLElement;
	private readonly proofHash: HTMLElement;
	private readonly verdict: HTMLElement;
	private readonly resInner: HTMLElement;
	private lastClock = -1;
	private readonly labelX = new Int32Array(MAX_PLAYERS).fill(-99999);
	private readonly labelY = new Int32Array(MAX_PLAYERS);
	private screen: Screen | null = null;

	constructor(root: HTMLElement, a: HudActions) {
		// title
		this.title = el("div", "title", root);
		const logo = el("div", "logo", this.title);
		el("h1", "display", logo, "Ringout");
		el("p", "", logo, "Heavy-orb sumo on a falling island");
		const setup = el("div", "setup", this.title);
		const cards = el("div", "cards", setup);
		for (let s = 0; s < MAX_PLAYERS; s++) {
			const look = LOOKS[s] as (typeof LOOKS)[number];
			const c = el("div", "card panel", cards);
			c.style.setProperty("--team", look.color);
			el("div", "label", c, `Seat ${s + 1} · key ${s + 1}`);
			el("div", "name display", c, look.name);
			const kind = el("div", "kind", c);
			const keys = el("div", "keys", c);
			c.addEventListener("click", () => a.onSeat(s));
			this.cards.push({ root: c, kind, keys });
		}
		const opts = el("div", "opts", setup);
		const rounds = el("span", "", opts);
		rounds.style.cursor = "pointer";
		rounds.addEventListener("click", () => a.onRounds());
		this.roundsLabel = rounds;
		el("span", "", opts).innerHTML =
			'<span class="keycap">1</span>–<span class="keycap">4</span> change seats';
		this.goBtn = el("div", "go display", setup, "Shove off");
		this.goBtn.addEventListener("click", () => a.onStart());
		const hint = el("div", "opts", setup);
		hint.innerHTML =
			'<span><span class="keycap">Enter</span> start &nbsp;·&nbsp; <span class="keycap">Esc</span> leave a match</span>';

		// play
		this.play = el("div", "play", root);
		const top = el("div", "topbar panel", this.play);
		this.roundEl = el("div", "round display", top);
		this.clockEl = el("div", "clock num", top);
		const st = el("div", "status", top);
		this.statusK = el("div", "label", st);
		this.statusV = el("div", "v", st);
		this.seatsRoot = el("div", "seats", this.play);
		for (let s = 0; s < MAX_PLAYERS; s++) {
			const look = LOOKS[s] as (typeof LOOKS)[number];
			const r = el("div", "seat panel", this.seatsRoot);
			r.style.setProperty("--team", look.color);
			const row = el("div", "row", r);
			const name = el("div", "name display", row, look.name);
			const ctl = el("div", "ctl", row);
			const pips = el("div", "pips", r);
			const dash = el("div", "dash", r);
			const bar = el("i", "", dash);
			const tag = el("div", "tag display", r, "");
			this.seats.push({
				root: r,
				name,
				ctl,
				pips,
				dash: bar,
				tag,
				out: false,
				dashFrac: -1,
			});
			const lab = el("div", "orb-label display", this.play);
			lab.style.setProperty("--team", look.color);
			this.labels.push(lab);
		}
		this.toastEl = el("div", "toast display", this.play);
		this.toastEl.style.opacity = "0";

		this.banner = el("div", "banner", root);
		this.bannerBig = el("div", "big display", this.banner);
		this.bannerSub = el("div", "sub", this.banner);

		// replay
		this.replay = el("div", "replay", root);
		el("div", "bar t", this.replay);
		el("div", "bar b", this.replay);
		const badge = el("div", "badge display", this.replay);
		el("span", "dot", badge);
		el("span", "", badge, "Instant replay");
		this.speedEl = el("span", "speed num", badge);
		const skip = el("div", "skip label", this.replay);
		skip.innerHTML = '<span class="keycap">Enter</span> skip';
		const proof = el("div", "proof panel", this.replay);
		this.proofLine = el("div", "", proof);
		this.proofHash = el("div", "h", proof);
		this.verdict = el("div", "verdict", proof);

		// results
		this.results = el("div", "results", root);
		this.resInner = el("div", "inner", this.results);
		this.results.addEventListener("click", (e) => {
			const t = e.target as HTMLElement;
			if (t.dataset.act === "rematch") a.onRematch();
			else if (t.dataset.act === "menu") a.onMenu();
		});
		this.show("title");
	}

	show(s: Screen): void {
		if (s === this.screen) return;
		this.screen = s;
		this.title.classList.toggle("hidden", s !== "title");
		this.play.classList.toggle("hidden", s !== "play");
		this.replay.classList.toggle("hidden", s !== "replay");
		this.results.classList.toggle("hidden", s !== "results");
		if (s !== "play") this.hideBanner();
	}

	/** Title cards and the in-match seat cards for a seat config. */
	setSetup(slots: readonly SlotKind[], toWin: number): void {
		let n = 0;
		for (let s = 0; s < MAX_PLAYERS; s++) {
			const k = slots[s] ?? "off";
			const c = this.cards[s] as CardEls;
			c.root.classList.toggle("off", k === "off");
			setText(c.kind, KIND_LABEL[k]);
			setText(c.keys, KIND_KEYS[k]);
			const seat = this.seats[s] as SeatEls;
			seat.root.classList.toggle("hidden", k === "off");
			setText(seat.ctl, CTL[k]);
			setText(
				this.labels[s] as HTMLElement,
				k === "p1" ? "P1" : k === "p2" ? "P2" : "BOT",
			);
			if (k !== "off") n++;
		}
		this.roundsLabel.innerHTML = `<span class="keycap">R</span> Best of <b class="em">${toWin * 2 - 1}</b> (first to ${toWin})`;
		this.goBtn.classList.toggle("disabled", n < 2);
		this.seatPips(new Int32Array(MAX_PLAYERS), toWin);
	}

	seatPips(wins: Int32Array, toWin: number): void {
		for (let s = 0; s < MAX_PLAYERS; s++) {
			const p = (this.seats[s] as SeatEls).pips;
			while (p.children.length < toWin) el("div", "pip", p);
			while (p.children.length > toWin) p.lastElementChild?.remove();
			for (let k = 0; k < toWin; k++)
				(p.children[k] as HTMLElement).classList.toggle(
					"on",
					k < (wins[s] as number),
				);
		}
	}

	setRound(index: number, toWin: number): void {
		this.roundEl.innerHTML = `Round ${index + 1}<small>First to ${toWin}</small>`;
	}

	setClock(seconds: number): void {
		const t = Math.floor(seconds * 10);
		if (t === this.lastClock) return;
		this.lastClock = t;
		setText(this.clockEl, (t / 10).toFixed(1));
	}

	setStatus(k: string, v: string, hot: boolean): void {
		setText(this.statusK, k);
		setText(this.statusV, v);
		this.statusV.classList.toggle("hot", hot);
	}

	seat(s: number, out: boolean, dashFrac: number, tag: string): void {
		const e = this.seats[s] as SeatEls;
		if (e.out !== out) {
			e.out = out;
			e.root.classList.toggle("out", out);
		}
		const q = Math.round(dashFrac * 40) / 40;
		if (q !== e.dashFrac) {
			e.dashFrac = q;
			e.dash.style.transform = `scaleX(${q})`;
		}
		setText(e.tag, tag);
	}

	label(s: number, x: number, y: number, visible: boolean): void {
		const l = this.labels[s] as HTMLElement;
		if (!visible) {
			if (l.style.display !== "none") l.style.display = "none";
			return;
		}
		if (l.style.display !== "") l.style.display = "";
		// rewrite the transform (a string) only when the whole-pixel position moved
		const xi = Math.round(x);
		const yi = Math.round(y);
		if (xi === this.labelX[s] && yi === this.labelY[s]) return;
		this.labelX[s] = xi;
		this.labelY[s] = yi;
		l.style.transform = `translate(${xi}px, ${yi}px) translate(-50%, -100%)`;
	}

	showBanner(big: string, sub: string, team: string | null, scale = 1): void {
		this.banner.classList.remove("hidden");
		setText(this.bannerBig, big);
		setText(this.bannerSub, sub);
		if (team) this.banner.style.setProperty("--team", team);
		else this.banner.style.removeProperty("--team");
		this.bannerBig.style.transform =
			scale === 1 ? "" : `scale(${scale.toFixed(3)})`;
	}

	hideBanner(): void {
		this.banner.classList.add("hidden");
	}

	toast(text: string, team: string): void {
		setText(this.toastEl, text);
		this.toastEl.style.setProperty("--team", team);
		this.toastEl.style.opacity = "1";
		this.toastT = 1.8;
	}

	tick(dt: number): void {
		if (this.toastT > 0) {
			this.toastT -= dt;
			if (this.toastT <= 0) this.toastEl.style.opacity = "0";
		}
	}

	replaySpeed(speed: number, tick: number, total: number): void {
		setText(
			this.speedEl,
			`${speed < 1 ? speed.toFixed(2) : speed.toFixed(0)}× · tick ${tick}/${total}`,
		);
	}

	replayProof(
		ticks: number,
		bytes: number,
		live: string,
		replay: string | null,
	): void {
		setText(
			this.proofLine,
			`Re-simulated live from seed + ${ticks.toLocaleString("en-US")} lockstep input frames (${(bytes / 1024).toFixed(1)} KB)`,
		);
		this.proofHash.innerHTML = `live <b>${live}</b>&nbsp;&nbsp;replay <b>${replay ?? "························"}</b>`;
		if (replay === null) {
			setText(this.verdict, "simulating…");
			this.verdict.className = "verdict";
		} else if (replay === live) {
			setText(this.verdict, "✓ bit-exact: same state hash");
			this.verdict.className = "verdict ok";
		} else {
			setText(this.verdict, "✗ diverged");
			this.verdict.className = "verdict bad";
		}
	}

	showResults(d: ResultData): void {
		const champ = LOOKS[d.champion] ?? { name: "Nobody", color: "#fff" };
		this.results.style.setProperty("--team", champ.color);
		const rows = d.rows
			.slice()
			.sort((a, b) => b.wins - a.wins || b.kos - a.kos)
			.map((r) => {
				const l = LOOKS[r.slot] as (typeof LOOKS)[number];
				return `<tr style="--team:${l.color}"><td><span class="sw"></span>${l.name} <span class="label">${CTL[r.kind]}</span></td><td>${r.wins}</td><td>${r.kos}</td><td>${r.dashes}</td><td>${r.bestHit.toFixed(1)}</td></tr>`;
			})
			.join("");
		const rounds = d.rounds
			.map((r, i) => {
				const w =
					r.winner >= 0
						? (LOOKS[r.winner] as (typeof LOOKS)[number]).name
						: "draw";
				const v =
					r.verified === true
						? '<span class="ok">replay ✓</span>'
						: r.verified === false
							? "replay ✗"
							: "";
				return `R${i + 1} ${w.padEnd(6, " ")} ${r.seconds.toFixed(1).padStart(5, " ")}s  ${r.hash.slice(0, 12)} ${v}`;
			})
			.join("<br>");
		this.resInner.innerHTML = `<div class="crown">Champion of the ring</div><div class="champ display">${champ.name}</div><table><tr><th></th><th>ROUNDS</th><th>KOS</th><th>DASHES</th><th>HARDEST HIT m/s</th></tr>${rows}</table><div class="rounds">${rounds}</div><div class="actions"><span class="btn display" data-act="rematch">Rematch</span><span class="btn ghost display" data-act="menu">Seats</span><span><span class="keycap">Enter</span> rematch · <span class="keycap">Esc</span> seats</span></div>`;
	}
}
