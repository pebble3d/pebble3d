import type { Game } from "@pebble3d/sdk/game";
import type { PerspectiveCamera } from "three/webgpu";
import { Vector3 } from "three/webgpu";
import type { Sfx } from "./audio/sfx.ts";
import { placementError } from "./puzzle/compose.ts";
import {
	type Level,
	type PartKind,
	type Placement,
	starsFor,
} from "./puzzle/level.ts";
import { LEVELS } from "./puzzle/levels.ts";
import { CELL, footprint, PART_DIRS } from "./puzzle/parts.ts";
import { type Engine, PuzzleSim, type SimEvent } from "./puzzle/sim.ts";
import type { Hud } from "./ui/hud.ts";
import { BoardView } from "./view/board.ts";
import { Particles } from "./view/particles.ts";

/**
 * The game flow: title / level select, edit (place parts on the grid), run (the
 * deterministic sim plays out), result. The puzzle sim is rebuilt from the placements on
 * every edit, so the edit view shows exactly the run's starting state.
 */

export type Phase = "title" | "edit" | "run" | "result";

/** Ticks the result waits after the run ends (the celebration plays first). */
const RESULT_DELAY = 50;
const BEST_KEY = "chain-reaction.best";

export interface RunRecord {
	level: string;
	status: string;
	tick: number;
	hash: string;
	expect: string | null;
	agree: boolean | null;
}

export class App {
	phase: Phase = "title";
	levelIndex = 0;
	level: Level = LEVELS[0] as Level;
	placements: Placement[] = [];
	selected: PartKind | null = null;
	dir: Placement["dir"] = "right";
	sim: PuzzleSim;
	readonly board: BoardView;
	/** Completed runs (exposed to automation). */
	readonly runs: RunRecord[] = [];
	/** Ticks since the run ended (-1 while it runs). */
	private endedAt = -1;
	private hover: [number, number] | null = null;
	private best: number[];
	private time = 0;
	private readonly cam: PerspectiveCamera;
	private readonly camPos = new Vector3();
	private readonly camTarget = new Vector3();
	private readonly camGoalPos = new Vector3();
	private readonly camGoalTarget = new Vector3();
	private camSnap = true;
	private readonly particles: Particles;
	private hasFans = false;
	/** Last fan level sent to the audio (avoids an automation event per frame). */
	private fanLevel = 0;
	private readonly ray = new Vector3();

	constructor(
		readonly game: Game,
		readonly engine: Engine,
		readonly hud: Hud,
		readonly sfx: Sfx,
		readonly canvas: HTMLCanvasElement,
		readonly interactive: boolean,
	) {
		this.cam = game.renderer.three.camera;
		this.board = new BoardView(game.renderer.three.scene);
		this.particles = new Particles(game.renderer.three.scene);
		this.best = loadBest();
		this.sim = new PuzzleSim(engine, this.level, []);
		if (interactive) this.bindInput();
	}

	// ---- flow ----------------------------------------------------------------------

	/** Title / level select, with the last level's reference machine running behind it. */
	showTitle(): void {
		this.phase = "title";
		const last = LEVELS[LEVELS.length - 1] as Level;
		this.loadLevel(LEVELS.length - 1, false, last.solution);
		this.hud.showTitle(LEVELS, this.best);
	}

	loadLevel(
		i: number,
		play = true,
		placements: readonly Placement[] = [],
	): void {
		this.levelIndex = i;
		this.level = LEVELS[i] as Level;
		this.placements = [...placements];
		this.board.setLevel(this.level);
		const kinds = Object.keys(this.level.inventory) as PartKind[];
		this.selected = kinds[0] ?? null;
		this.dir = this.selected
			? (PART_DIRS[this.selected][0] as Placement["dir"])
			: "right";
		this.rebuild();
		this.camSnap = true;
		if (play) {
			this.phase = "edit";
			this.hud.showPlay(this.level, i);
			this.hud.setRunning(false);
			this.hud.setStatus("");
			this.refreshTray();
		}
	}

	/** New sim from the current placements (edit preview / run start). */
	private rebuild(): void {
		// Build the new sim first: if it throws, the current one stays valid.
		const next = new PuzzleSim(this.engine, this.level, this.placements);
		this.sim.dispose();
		this.sim = next;
		this.board.setSim(this.sim);
		this.board.fanSpeed = 0;
		this.particles.clear();
		this.hasFans = this.sim.composed.parts.some((p) => p.role?.kind === "fan");
		this.endedAt = -1;
	}

	run(): void {
		if (this.phase !== "edit") return;
		this.rebuild();
		this.phase = "run";
		this.board.setGhost(null, false);
		this.hud.setRunning(true);
		this.hud.setStatus("Running");
		this.sfx.run();
	}

	reset(): void {
		if (this.phase !== "run" && this.phase !== "result") return;
		this.phase = "edit";
		this.rebuild();
		this.hud.hideResult();
		this.hud.setRunning(false);
		this.hud.setStatus("");
		this.sfx.fan(0);
		this.fanLevel = 0;
		this.refreshTray();
	}

	clear(): void {
		if (this.phase !== "edit") return;
		this.placements = [];
		this.rebuild();
		this.refreshTray();
		this.sfx.place(true);
	}

	selectPart(kind: PartKind): void {
		if (!this.level.inventory[kind]) return;
		this.selected = kind;
		const dirs = PART_DIRS[kind];
		if (!dirs.includes(this.dir)) this.dir = dirs[0] as Placement["dir"];
		this.refreshTray();
		this.refreshGhost();
		this.sfx.ui();
	}

	rotate(step = 1): void {
		if (!this.selected) return;
		const dirs = PART_DIRS[this.selected];
		const i = dirs.indexOf(this.dir);
		this.dir = dirs[(i + step + dirs.length) % dirs.length] as Placement["dir"];
		this.refreshGhost();
		this.sfx.ui();
	}

	/** Places the selected part at a cell, or explains why not. Returns success. */
	place(c: number, r: number, part = this.selected, dir = this.dir): boolean {
		if (this.phase !== "edit" || !part) return false;
		const p: Placement = { part, cell: [c, r], dir };
		const err = placementError(this.level, [...this.placements, p]);
		if (err) {
			this.hud.flash(err.replace(/^[a-z]+ at [\d,]+ /, ""));
			return false;
		}
		this.placements.push(p);
		this.rebuild();
		this.refreshTray();
		this.sfx.place();
		return true;
	}

	/** Removes the placed part covering a cell. Returns success. */
	remove(c: number, r: number): boolean {
		if (this.phase !== "edit") return false;
		const i = this.placements.findIndex((p) =>
			footprint(p).some(([x, y]) => x === c && y === r),
		);
		if (i < 0) return false;
		this.placements.splice(i, 1);
		this.rebuild();
		this.refreshTray();
		this.sfx.place(true);
		return true;
	}

	private refreshTray(): void {
		const used: Partial<Record<PartKind, number>> = {};
		for (const p of this.placements) used[p.part] = (used[p.part] ?? 0) + 1;
		this.hud.updateTray(
			this.level,
			used,
			this.selected,
			this.placements.length,
		);
	}

	private refreshGhost(): void {
		if (this.phase !== "edit" || !this.hover || !this.selected) {
			this.board.setGhost(null, false);
			return;
		}
		const p: Placement = {
			part: this.selected,
			cell: this.hover,
			dir: this.dir,
		};
		const ok = !placementError(this.level, [...this.placements, p]);
		this.board.setGhost(p, ok);
	}

	/** Shows a ghost at a cell (the demo uses this to preview its next placement). */
	ghostAt(p: Placement | null): void {
		this.board.setGhost(p, p !== null);
	}

	// ---- per tick / frame ------------------------------------------------------------

	tick(): void {
		if (this.phase === "title") {
			// Attract mode: the machine runs on a loop behind the menu (silently).
			const sim = this.sim;
			if (sim.status === "running") {
				sim.step();
				sim.drain(this.onTitleEvent);
			} else if (++this.endedAt > 150) this.rebuild();
			return;
		}
		if (this.phase !== "run" && this.phase !== "result") return;
		const sim = this.sim;
		if (sim.status === "running") {
			sim.step();
			sim.drain(this.onEvent);
			if (sim.status !== "running") this.endedAt = 0;
		} else if (this.phase === "run" && ++this.endedAt >= RESULT_DELAY) {
			this.finish();
		}
	}

	private readonly onTitleEvent = (e: SimEvent): void => {
		if (e.kind === "spring") this.board.springFired(e.x);
		else if (e.kind === "solved") {
			this.board.celebrate();
			this.particles.confetti(e.x, e.y + 0.3);
		}
	};

	private readonly onEvent = (e: SimEvent): void => {
		switch (e.kind) {
			case "impact":
				this.sfx.clack(e.strength);
				if (e.strength > 2.2) this.particles.impact(e.x, e.y, e.strength);
				break;
			case "domino":
				this.sfx.clack(e.strength * 2, "domino");
				this.particles.impact(e.x, e.y + 0.6, 1.5);
				break;
			case "spring":
				this.sfx.boing();
				this.board.springFired(e.x);
				this.particles.impact(e.x, e.y, 3);
				break;
			case "fan":
				this.sfx.whoosh();
				break;
			case "solved":
				this.sfx.chime();
				this.board.celebrate();
				this.particles.confetti(e.x, e.y + 0.3);
				this.hud.setStatus("Goal!");
				break;
			case "failed":
				this.sfx.fail();
				this.hud.setStatus("");
				break;
			default:
				break;
		}
	};

	private finish(): void {
		this.phase = "result";
		this.sfx.fan(0);
		this.fanLevel = 0;
		const sim = this.sim;
		const r = sim.result();
		const solved = r.status === "solved";
		const stars = starsFor(this.placements.length, this.level.par);
		const isRef = sameSolution(this.placements, this.level.solution);
		const expect = isRef ? (this.level.expect?.hash ?? null) : null;
		const agree = expect === null ? null : expect === r.hash;
		this.runs.push({
			level: this.level.id,
			status: r.status,
			tick: r.tick,
			hash: r.hash,
			expect,
			agree,
		});
		if (solved && stars > (this.best[this.levelIndex] ?? 0)) {
			this.best[this.levelIndex] = stars;
			saveBest(this.best);
		}
		this.hud.setStatus("");
		this.hud.showResult({
			solved,
			reason: r.reason,
			stars,
			parts: this.placements.length,
			par: this.level.par,
			seconds: r.tick / 60,
			hash: r.hash,
			verified: agree,
			last: this.levelIndex >= LEVELS.length - 1,
			placementsJson: JSON.stringify(this.placements),
			levelId: this.level.id,
		});
	}

	next(): void {
		const i = this.levelIndex + 1;
		if (i < LEVELS.length) this.loadLevel(i);
		else this.showTitle();
	}

	retry(): void {
		this.reset();
	}

	/** Per rendered frame: interpolation, animation, camera. */
	frame(dt: number, alpha: number): void {
		this.time += dt;
		const running =
			this.phase === "run" || this.phase === "result" || this.phase === "title";
		const target =
			running && this.hasFans && this.sim.status === "running" ? 1 : 0;
		this.board.fanSpeed += (target - this.board.fanSpeed) * Math.min(1, dt * 3);
		const fanLevel = this.phase === "title" ? 0 : this.board.fanSpeed;
		if (
			Math.abs(fanLevel - this.fanLevel) > 0.02 ||
			(fanLevel === 0 && this.fanLevel !== 0)
		) {
			this.fanLevel = fanLevel;
			this.sfx.fan(fanLevel);
		}
		this.board.update(this.sim, running ? alpha : 1, dt, this.time);
		this.particles.update(dt);
		this.updateCamera(dt);
	}

	private updateCamera(dt: number): void {
		const f = this.board.frame();
		const aspect = this.cam.aspect || 16 / 9;
		const tanY = Math.tan((this.cam.fov * Math.PI) / 360);
		const title = this.phase === "title";
		// Leave room for the HUD bars (top and bottom) in play; frame wider on the title.
		const needH = f.h + (title ? 1.2 : 4.2);
		const needW = f.w + (title ? 1.0 : 1.4);
		const d = Math.max(needH / 2 / tanY, needW / 2 / (tanY * aspect));
		const yaw = (title ? -0.32 : 0.1) + 0.025 * Math.sin(this.time * 0.25);
		const pitch = title ? 0.12 : 0.07;
		const tx = f.cx + (title ? -f.w * 0.27 : 0);
		const ty = f.cy - (title ? 0 : 0.75);
		this.camGoalTarget.set(tx, ty, 0);
		this.camGoalPos.set(
			tx + Math.sin(yaw) * d,
			ty + Math.sin(pitch) * d,
			Math.cos(yaw) * d,
		);
		if (this.camSnap) {
			this.camPos.copy(this.camGoalPos);
			this.camTarget.copy(this.camGoalTarget);
			this.camSnap = false;
		} else {
			const k = Math.min(1, dt * 2.5);
			this.camPos.lerp(this.camGoalPos, k);
			this.camTarget.lerp(this.camGoalTarget, k);
		}
		this.cam.position.copy(this.camPos);
		this.cam.lookAt(this.camTarget);
	}

	// ---- input ---------------------------------------------------------------------

	/** The grid cell under a canvas pixel, or null. */
	cellAt(px: number, py: number): [number, number] | null {
		const rect = this.canvas.getBoundingClientRect();
		const nx = ((px - rect.left) / rect.width) * 2 - 1;
		const ny = -((py - rect.top) / rect.height) * 2 + 1;
		this.ray.set(nx, ny, 0.5).unproject(this.cam).sub(this.cam.position);
		if (Math.abs(this.ray.z) < 1e-6) return null;
		const t = -this.cam.position.z / this.ray.z;
		if (t <= 0) return null;
		const x = this.cam.position.x + this.ray.x * t;
		const y = this.cam.position.y + this.ray.y * t;
		const c = Math.floor((x - this.level.grid.origin[0]) / CELL);
		const r = Math.floor((y - this.level.grid.origin[1]) / CELL);
		if (
			c < 0 ||
			r < 0 ||
			c >= this.level.grid.cols ||
			r >= this.level.grid.rows
		)
			return null;
		return [c, r];
	}

	private bindInput(): void {
		const cv = this.canvas;
		cv.addEventListener("contextmenu", (e) => e.preventDefault());
		cv.addEventListener("pointermove", (e) => {
			const cell = this.cellAt(e.clientX, e.clientY);
			const same =
				cell && this.hover
					? cell[0] === this.hover[0] && cell[1] === this.hover[1]
					: cell === this.hover;
			if (same) return;
			this.hover = cell;
			this.refreshGhost();
		});
		cv.addEventListener("pointerleave", () => {
			this.hover = null;
			this.refreshGhost();
		});
		cv.addEventListener("pointerdown", (e) => {
			if (this.phase !== "edit") return;
			const cell = this.cellAt(e.clientX, e.clientY);
			if (!cell) return;
			if (e.button === 2) this.remove(cell[0], cell[1]);
			else if (e.button === 0 && !this.remove(cell[0], cell[1]))
				this.place(cell[0], cell[1]);
			this.refreshGhost();
		});
		cv.addEventListener(
			"wheel",
			(e) => {
				if (this.phase !== "edit") return;
				e.preventDefault();
				this.rotate(e.deltaY > 0 ? 1 : -1);
			},
			{ passive: false },
		);
		window.addEventListener("keydown", (e) => {
			if (e.repeat) return;
			if (e.code === "Space") {
				e.preventDefault();
				// A focused button would also fire on keyup (Firefox): drop its focus first.
				if (e.target instanceof HTMLButtonElement) e.target.blur();
				if (this.phase === "edit") this.run();
				else if (this.phase === "run" || this.phase === "result") this.reset();
			} else if (e.code === "KeyR" && this.phase === "edit") this.rotate();
			else if (e.code === "Escape") {
				if (this.phase === "run" || this.phase === "result") this.reset();
				else if (this.phase === "edit") this.showTitle();
			} else if (/^Digit[1-5]$/.test(e.code) && this.phase === "edit") {
				const kinds = (Object.keys(this.level.inventory) as PartKind[]).sort(
					(a, b) => ORDER.indexOf(a) - ORDER.indexOf(b),
				);
				const k = kinds[Number(e.code.slice(5)) - 1];
				if (k) this.selectPart(k);
			}
		});
	}
}

const ORDER: PartKind[] = ["ramp", "domino", "spring", "fan", "seesaw"];

export function sameSolution(
	a: readonly Placement[],
	b: readonly Placement[],
): boolean {
	if (a.length !== b.length) return false;
	const key = (p: Placement): string =>
		`${p.part}|${p.cell[0]},${p.cell[1]}|${p.dir}`;
	const sa = a.map(key).sort();
	const sb = b.map(key).sort();
	return sa.every((k, i) => k === sb[i]);
}

function loadBest(): number[] {
	try {
		const v = JSON.parse(localStorage.getItem(BEST_KEY) ?? "[]") as unknown;
		return Array.isArray(v)
			? v.map((n) => (typeof n === "number" ? n : 0))
			: [];
	} catch {
		return [];
	}
}

function saveBest(best: number[]): void {
	try {
		localStorage.setItem(BEST_KEY, JSON.stringify(best));
	} catch {
		// storage blocked: stars just are not remembered
	}
}
