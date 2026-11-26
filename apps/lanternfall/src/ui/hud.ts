import { type PerspectiveCamera, Vector3 } from "three/webgpu";
import { GUARD, type LanternSim, PHASE } from "../game/sim.ts";
import { APRON, COLS, ROWS, X0, X1, Z0, Z1 } from "../gen/generate.ts";

const MAP_W = 216;
const MAP_SCALE = MAP_W / (X1 - X0 + 4);
const MAP_H = Math.round((Z1 - Z0 + APRON + 3) * MAP_SCALE);

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

export interface HudInfo {
	seed: number;
	demo: boolean;
}

function rank(sim: LanternSim): string {
	if (sim.phase === PHASE.CAUGHT) return "Caught in the light";
	if (sim.alerts === 0 && sim.lootCount === sim.layout.loot.length)
		return "Lanternfall Ghost";
	if (sim.alerts === 0) return "Unseen";
	if (sim.alerts === 1) return "Shadow";
	return "Cutpurse";
}

/**
 * DOM HUD over the canvas: title card, objective, light meter (how visible you are), guard
 * suspicion markers, a minimap drawn from the generated layout, and the results card.
 * Text is rewritten only when the shown value changes.
 */
export class Hud {
	private readonly title: HTMLElement;
	private readonly play: HTMLElement;
	private readonly results: HTMLElement;
	private readonly objective: HTMLElement;
	private readonly lootEl: HTMLElement;
	private readonly timeEl: HTMLElement;
	private readonly meterFill: HTMLElement;
	private readonly meterLabel: HTMLElement;
	private readonly dangerFill: HTMLElement;
	private readonly markers: HTMLElement[] = [];
	private readonly map: HTMLCanvasElement;
	private readonly mapCtx: CanvasRenderingContext2D;
	private readonly mapBase: HTMLCanvasElement;
	private readonly resTitle: HTMLElement;
	private readonly resRank: HTMLElement;
	private readonly resStats: HTMLElement;
	private readonly resScore: HTMLElement;
	private readonly v = new Vector3();
	private shown = {
		phase: -1,
		loot: -1,
		secs: -1,
		relic: false,
		label: "",
		meter: -1,
		danger: -1,
	};

	constructor(
		root: HTMLElement,
		private readonly sim: LanternSim,
		info: HudInfo,
	) {
		const L = sim.layout;
		// Title card.
		this.title = el("div", "card title", root);
		el("div", "kicker", this.title, `Keep No. ${info.seed}`);
		el("h1", "logo", this.title, "Lanternfall");
		el("p", "tag", this.title, "Steal the Ember Relic. Stay out of the light.");
		const facts = el("div", "facts", this.title);
		el("span", "", facts, `${COLS * ROWS} halls`);
		el("span", "", facts, `${L.guards.length} wardens`);
		el("span", "", facts, `${L.lanterns.length} lanterns`);
		el("span", "", facts, `${L.loot.length} gold`);
		const keys = el("div", "keys", this.title);
		for (const [k, d] of [
			["WASD", "creep"],
			["Shift", "run (loud)"],
			["Enter", "begin"],
			["N", "new keep"],
		] as const) {
			const row = el("div", "key", keys);
			el("kbd", "", row, k);
			el("span", "", row, d);
		}
		el(
			"div",
			"prompt",
			this.title,
			info.demo ? "Demo: the thief plays itself" : "Press Enter to slip inside",
		);
		el(
			"div",
			"fine",
			this.title,
			"Every keep is generated from its seed as a Pebble3D scene JSON. Add ?dumpScene=1 to export it.",
		);

		// Play HUD.
		this.play = el("div", "playhud", root);
		const tl = el("div", "panel tl", this.play);
		this.objective = el("div", "objective", tl);
		const row = el("div", "row", tl);
		this.lootEl = el("span", "loot", row);
		this.timeEl = el("span", "time", row);
		const meter = el("div", "meter", this.play);
		el("div", "meter-eye", meter, "◉");
		const bar = el("div", "meter-bar", meter);
		this.meterFill = el("div", "meter-fill", bar);
		this.meterLabel = el("div", "meter-label", meter);
		const dbar = el("div", "danger-bar", meter);
		this.dangerFill = el("div", "danger-fill", dbar);
		for (let i = 0; i < sim.guards.length; i++)
			this.markers.push(el("div", "marker", root));

		this.map = el("canvas", "minimap", this.play);
		this.map.width = MAP_W;
		this.map.height = MAP_H;
		const ctx = this.map.getContext("2d");
		if (!ctx) throw new Error("2d canvas unavailable");
		this.mapCtx = ctx;
		this.mapBase = document.createElement("canvas");
		this.mapBase.width = MAP_W;
		this.mapBase.height = MAP_H;

		// Results card.
		this.results = el("div", "card results", root);
		this.resTitle = el("h2", "res-title", this.results);
		this.resRank = el("div", "res-rank", this.results);
		this.resStats = el("div", "res-stats", this.results);
		this.resScore = el("div", "res-score", this.results);
		el(
			"div",
			"prompt",
			this.results,
			info.demo
				? "Demo: trying again shortly"
				: "Enter: try this keep again  ·  N: a new keep",
		);
	}

	private mx(x: number): number {
		return (x - X0 + 2) * MAP_SCALE;
	}
	private mz(z: number): number {
		return (z - Z0 + 2) * MAP_SCALE;
	}

	private drawMapBase(): void {
		const ctx = this.mapBase.getContext("2d");
		if (!ctx) return;
		const s = this.sim;
		const g = s.grid;
		const img = ctx.createImageData(MAP_W, MAP_H);
		for (let y = 0; y < MAP_H; y++)
			for (let x = 0; x < MAP_W; x++) {
				const wx = x / MAP_SCALE + X0 - 2;
				const wz = y / MAP_SCALE + Z0 - 2;
				const t = g.index(wx, wz);
				const o = (y * MAP_W + x) * 4;
				if (t < 0) continue;
				if (g.blocked[t]) {
					img.data[o] = 120;
					img.data[o + 1] = 124;
					img.data[o + 2] = 140;
					img.data[o + 3] =
						wx > X0 - 0.5 && wx < X1 + 0.5 && wz > Z0 - 0.5 && wz < Z1 + 0.6
							? 230
							: 0;
				} else {
					const l = s.light[t] as number;
					img.data[o] = 14 + 220 * l;
					img.data[o + 1] = 15 + 140 * l;
					img.data[o + 2] = 22 + 40 * l;
					img.data[o + 3] = 200;
				}
			}
		ctx.putImageData(img, 0, 0);
	}

	update(
		cam: PerspectiveCamera,
		guardPos: { x: number; z: number }[],
		w: number,
		h: number,
	): void {
		const s = this.sim;
		const sh = this.shown;
		if (sh.phase !== s.phase) {
			sh.phase = s.phase;
			this.title.classList.toggle("on", s.phase === PHASE.TITLE);
			this.play.classList.toggle("on", s.phase === PHASE.PLAY);
			const end = s.phase === PHASE.CAUGHT || s.phase === PHASE.ESCAPED;
			this.results.classList.toggle("on", end);
			this.results.classList.toggle("caught", s.phase === PHASE.CAUGHT);
			if (end) {
				this.resTitle.textContent =
					s.phase === PHASE.ESCAPED ? "Escaped" : "Caught";
				this.resRank.textContent = rank(s);
				const secs = Math.floor(s.playT / 60);
				this.resStats.replaceChildren();
				for (const [k, v] of [
					[
						"Relic",
						s.phase === PHASE.ESCAPED
							? "taken"
							: s.hasRelic
								? "dropped"
								: "untouched",
					],
					["Gold", `${s.lootCount} / ${s.layout.loot.length}`],
					["Alarms raised", String(s.alerts)],
					[
						"Time",
						`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`,
					],
				]) {
					const r = el("div", "stat", this.resStats);
					el("span", "", r, k);
					el("b", "", r, v);
				}
				this.resScore.textContent = `${s.score}`;
			}
		}
		if (s.phase === PHASE.PLAY) {
			if (sh.relic !== s.hasRelic || sh.loot < 0) {
				sh.relic = s.hasRelic;
				this.objective.textContent = s.hasRelic
					? "Escape through the gate"
					: "Find the Ember Relic";
				this.objective.classList.toggle("hot", s.hasRelic);
			}
			if (sh.loot !== s.lootCount) {
				sh.loot = s.lootCount;
				this.lootEl.textContent = `◆ ${s.lootCount}/${s.layout.loot.length}`;
			}
			const secs = Math.floor(s.playT / 60);
			if (sh.secs !== secs) {
				sh.secs = secs;
				this.timeEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
			}
			const m = Math.round(s.playerLight * 100);
			if (sh.meter !== m) {
				sh.meter = m;
				this.meterFill.style.width = `${m}%`;
				const label = m < 22 ? "Hidden" : m < 50 ? "Dim" : "Exposed";
				if (sh.label !== label) {
					sh.label = label;
					this.meterLabel.textContent = label;
					this.meterLabel.dataset.level = label.toLowerCase();
				}
			}
			const d = Math.round(s.danger * 100);
			if (sh.danger !== d) {
				sh.danger = d;
				this.dangerFill.style.width = `${d}%`;
			}
			this.drawMap();
		}
		// Suspicion markers over guards.
		for (let i = 0; i < this.markers.length; i++) {
			const g = s.guards[i];
			const m = this.markers[i] as HTMLElement;
			const p = guardPos[i];
			if (!g || !p) continue;
			const show =
				s.phase === PHASE.PLAY &&
				(g.state === GUARD.ALERT ||
					g.state === GUARD.SUSPICIOUS ||
					g.state === GUARD.SEARCH ||
					g.suspicion > 0.05);
			if (!show) {
				if (m.style.display !== "none") m.style.display = "none";
				continue;
			}
			this.v.set(p.x, 2.35, p.z).project(cam);
			m.style.display = "block";
			m.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%)`;
			const txt = g.state === GUARD.ALERT ? "!" : "?";
			if (m.textContent !== txt) m.textContent = txt;
			m.dataset.state =
				g.state === GUARD.ALERT
					? "alert"
					: g.state === GUARD.SUSPICIOUS
						? "sus"
						: "calm";
			m.style.setProperty("--fill", `${Math.round(g.suspicion * 100)}%`);
		}
	}

	private baseDrawn = false;

	private drawMap(): void {
		const ctx = this.mapCtx;
		const s = this.sim;
		if (!this.baseDrawn) {
			// After the first tick: the sim bakes its light map then (it needs the broad phase).
			this.drawMapBase();
			this.baseDrawn = true;
		}
		ctx.clearRect(0, 0, MAP_W, MAP_H);
		ctx.drawImage(this.mapBase, 0, 0);
		// Gate and relic.
		ctx.fillStyle = s.hasRelic ? "#7de8ff" : "#ffb45c";
		ctx.fillRect(
			this.mx(s.layout.gate[0]) - 5,
			this.mz(s.layout.gate[1]) - 1,
			10,
			3,
		);
		if (!s.hasRelic) {
			ctx.fillStyle = "#7de8ff";
			ctx.beginPath();
			ctx.arc(
				this.mx(s.layout.relic[0]),
				this.mz(s.layout.relic[1]),
				3.2,
				0,
				Math.PI * 2,
			);
			ctx.fill();
		}
		ctx.fillStyle = "#f2c14e";
		for (let k = 0; k < s.layout.loot.length; k++) {
			if (s.lootMask & (1 << k)) continue;
			const [x, z] = s.layout.loot[k] as [number, number];
			ctx.fillRect(this.mx(x) - 1.5, this.mz(z) - 1.5, 3, 3);
		}
		// Alerted guards are heard, so they show.
		ctx.fillStyle = "#ff3b3b";
		for (const g of s.guards) {
			if (g.state !== GUARD.ALERT) continue;
			ctx.beginPath();
			ctx.arc(this.mx(g.x), this.mz(g.z), 3, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.fillStyle = "#ffffff";
		ctx.beginPath();
		ctx.arc(this.mx(s.px), this.mz(s.pz), 3, 0, Math.PI * 2);
		ctx.fill();
	}
}
