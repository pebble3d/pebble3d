import type { App } from "./app.ts";
import { LEVELS } from "./puzzle/levels.ts";

/**
 * `?demo=1` autoplayer: for each level it places the stored reference solution part by
 * part (a ghost preview, then the placement), presses Run, lets the deterministic chain
 * play out, shows the result card and moves on. Driven by ticks, so fixed-mode captures
 * are reproducible.
 */
const GHOST_TICKS = 16;
const PLACE_EVERY = 30;
const BEFORE_RUN = 40;
const SHOW_RESULT = 170;

export class DemoDriver {
	private t = 0;
	private placed = 0;
	private stage: "place" | "pre" | "run" | "show" = "place";
	current = "";

	constructor(
		private readonly app: App,
		private levelIndex: number,
		private readonly loop: boolean,
	) {
		app.loadLevel(levelIndex);
	}

	/** One tick of the script (before the app's own tick). */
	step(): void {
		const app = this.app;
		const sol = app.level.solution;
		this.t++;
		switch (this.stage) {
			case "place": {
				const p = sol[this.placed];
				if (!p) {
					app.ghostAt(null);
					this.stage = "pre";
					this.t = 0;
					break;
				}
				this.current = `place ${p.part} ${p.cell}`;
				if (this.t === PLACE_EVERY - GHOST_TICKS) {
					app.selectPart(p.part);
					app.dir = p.dir;
					app.ghostAt(p);
				}
				if (this.t >= PLACE_EVERY) {
					app.ghostAt(null);
					app.place(p.cell[0], p.cell[1], p.part, p.dir);
					this.placed++;
					this.t = 0;
				}
				break;
			}
			case "pre":
				this.current = "ready";
				if (this.t >= BEFORE_RUN) {
					app.run();
					this.stage = "run";
					this.t = 0;
				}
				break;
			case "run":
				this.current = "running";
				if (app.phase === "result") {
					this.stage = "show";
					this.t = 0;
				}
				break;
			case "show":
				this.current = "result";
				if (this.t >= SHOW_RESULT) {
					const next = this.levelIndex + 1;
					if (next >= LEVELS.length && !this.loop) {
						this.stage = "show";
						this.t = -1e9;
						break;
					}
					this.levelIndex = next % LEVELS.length;
					app.loadLevel(this.levelIndex);
					this.placed = 0;
					this.stage = "place";
					this.t = 0;
				}
				break;
		}
	}
}
