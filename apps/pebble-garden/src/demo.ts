import type { App } from "./app.ts";
import { DEMO_STEPS } from "./garden/demo-script.ts";

/**
 * `?demo=1` autoplayer, driven by ticks so fixed-mode captures are reproducible: title,
 * then a blank garden where it builds the demo contraption step by step (ghost preview,
 * place, inspector edits), presses Play, shows the result, rewinds with Reset and finally
 * exports the garden as scene JSON. Every action goes through the same App methods the
 * HUD and keyboard use.
 */
const TITLE_TICKS = 100;
const GHOST_AT = 12;
const STEP_TICKS = 30;
const EDIT_TICKS = 16;
const BEFORE_PLAY = 50;
const SHOW_RESULT = 150;
const BEFORE_EXPORT = 45;
const SCROLL_TICKS = 160;

export type DemoStage =
	| "title"
	| "build"
	| "ready"
	| "run"
	| "result"
	| "rewind"
	| "export"
	| "done";

export class DemoDriver {
	stage: DemoStage = "title";
	private t = 0;
	private step = 0;
	current = "title";

	constructor(private readonly app: App) {
		app.showTitle();
	}

	/** One tick of the script (before the app's own tick). */
	tick(): void {
		const app = this.app;
		this.t++;
		switch (this.stage) {
			case "title":
				if (this.t >= TITLE_TICKS) {
					app.openBlank();
					app.glideCamera([6.5, 8.5, 12.5], [-0.8, 0.4, 1.4]);
					this.go("build");
				}
				break;
			case "build": {
				const s = DEMO_STEPS[this.step];
				if (!s) {
					app.selectEntity(null);
					this.go("ready");
					break;
				}
				this.current = s.label;
				if (s.kind === "place") {
					if (this.t === GHOST_AT) app.ghostAt(s.piece, s.at);
					if (this.t >= STEP_TICKS) {
						app.ghostAt(null);
						app.arm(null);
						app.place(s.piece, s.at, s.rot);
						this.next();
					}
				} else if (this.t >= EDIT_TICKS) {
					if (s.kind === "scale") app.scaleSelected(s.scale);
					else app.setColor(s.color);
					this.next();
				}
				break;
			}
			case "ready":
				this.current = "ready";
				if (this.t >= BEFORE_PLAY) {
					app.play();
					this.go("run");
				}
				break;
			case "run":
				this.current = "running";
				if (app.phase === "result") this.go("result");
				break;
			case "result":
				this.current = "result";
				if (this.t >= SHOW_RESULT) {
					app.reset();
					this.go("rewind");
				}
				break;
			case "rewind":
				this.current = "rewound";
				if (this.t >= BEFORE_EXPORT) {
					app.exportGarden();
					this.go("export");
				}
				break;
			case "export":
				this.current = "export";
				app.hud.exportScroll(Math.min(1, this.t / SCROLL_TICKS));
				if (this.t >= SCROLL_TICKS + 60) this.go("done");
				break;
			case "done":
				break;
		}
	}

	private next(): void {
		this.step++;
		this.t = 0;
	}

	private go(s: DemoStage): void {
		this.stage = s;
		this.t = 0;
	}
}
