import type { Game } from "@pebble3d/sdk/game";

const UPDATE_HZ = 4;
const ROWS = [
	"fps",
	"frame",
	"draw calls (all passes)",
	"triangles (all passes)",
	"bodies active/asleep",
	"splats",
	"physics",
	"build",
	"backend",
	"tick",
] as const;

function isEditable(t: EventTarget | null): boolean {
	if (!(t instanceof HTMLElement)) return false;
	return (
		t.isContentEditable ||
		t.tagName === "INPUT" ||
		t.tagName === "TEXTAREA" ||
		t.tagName === "SELECT"
	);
}

/**
 * Stats overlay. Backtick toggles it. It reads `game.stats()` (wall-clock fps/frame ms),
 * updates at 4 Hz by writing `textContent` into nodes created once, and shows
 * `stats().errors` in red. Hidden at first in fixed mode unless `startVisible` is true.
 * Returns an unmount function.
 */
export function mountOverlay(
	game: Game,
	el?: HTMLElement,
	opts: { startVisible?: boolean } = {},
): () => void {
	const root = el ?? document.createElement("div");
	const owned = el === undefined;
	root.setAttribute("data-pebble3d-overlay", "");
	Object.assign(root.style, {
		position: "fixed",
		top: "8px",
		left: "8px",
		zIndex: "10",
		padding: "6px 10px",
		font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		color: "#e8f0e8",
		background: "rgba(8, 10, 12, 0.72)",
		borderRadius: "4px",
		pointerEvents: "none",
		whiteSpace: "pre",
		display: opts.startVisible === false ? "none" : "block",
	});
	const table = document.createElement("div");
	const values: HTMLSpanElement[] = [];
	for (const label of ROWS) {
		const row = document.createElement("div");
		const k = document.createElement("span");
		k.textContent = `${label.padEnd(26)}`;
		k.style.opacity = "0.65";
		const v = document.createElement("span");
		row.append(k, v);
		table.append(row);
		values.push(v);
	}
	const err = document.createElement("div");
	err.style.color = "#ff5a5a";
	err.style.maxWidth = "60ch";
	err.style.whiteSpace = "pre-wrap";
	root.append(table, err);
	if (owned) document.body.append(root);

	const set = (i: number, s: string): void => {
		const v = values[i];
		if (v && v.textContent !== s) v.textContent = s;
	};
	let lastErr = "";
	const update = (): void => {
		if (root.style.display === "none") return;
		const s = game.stats();
		set(0, s.fps.toFixed(0));
		set(1, `${s.frameMs.toFixed(2)} ms`);
		set(2, String(s.drawCalls));
		set(3, String(s.triangles));
		set(4, `${s.activeBodies} / ${s.sleepingBodies}`);
		set(5, String(s.splats));
		set(6, `${s.physicsMs.toFixed(2)} ms`);
		set(7, s.build);
		set(8, s.backend);
		set(9, String(s.tick));
		// errors rarely change; only rebuild the string when the count differs
		const n = s.errors.length;
		const key = n === 0 ? "" : `${n}:${s.errors[n - 1]}`;
		if (key !== lastErr) {
			lastErr = key;
			err.textContent = n === 0 ? "" : s.errors.join("\n");
		}
	};
	const onKey = (e: KeyboardEvent): void => {
		if (e.key !== "`" || e.repeat || isEditable(e.target)) return;
		root.style.display = root.style.display === "none" ? "block" : "none";
		update();
	};
	window.addEventListener("keydown", onKey);
	update();
	const timer = setInterval(update, 1000 / UPDATE_HZ);
	return () => {
		clearInterval(timer);
		window.removeEventListener("keydown", onKey);
		if (owned) root.remove();
		else root.replaceChildren();
	};
}
