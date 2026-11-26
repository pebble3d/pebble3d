import { parseScene } from "@pebble3d/sdk/schema";
import type { Keep } from "./gen/generate.ts";

/**
 * `?dumpScene=1`: show the generated keep's scene JSON instead of playing it, validated by the
 * schema, with a download link. `&layout=1` exports the game metadata alongside it.
 */
export function showDump(keep: Keep, seed: number, withLayout: boolean): void {
	parseScene(keep.scene); // throws SceneError (with the field path) if the generator broke
	const data = withLayout
		? { scene: keep.scene, layout: keep.layout }
		: keep.scene;
	const text = JSON.stringify(data, null, "\t");
	const name = `lanternfall-keep-${seed}${withLayout ? "-full" : ""}.json`;
	document.body.innerHTML = "";
	document.body.style.cssText =
		"margin:0;overflow:auto;background:#07080c;color:#efe6d6;font:14px ui-sans-serif,system-ui,sans-serif";
	const head = document.createElement("header");
	head.style.cssText =
		"position:sticky;top:0;display:flex;gap:16px;align-items:center;padding:14px 20px;background:#0e1016;border-bottom:1px solid #2a2418";
	const h = document.createElement("strong");
	h.textContent = `Keep No. ${seed}: ${keep.scene.entities?.length ?? 0} entities, schema-valid`;
	const a = document.createElement("a");
	a.textContent = `Download ${name}`;
	a.download = name;
	a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	a.style.color = "#ffb45c";
	const play = document.createElement("a");
	const q = new URLSearchParams(location.search);
	q.delete("dumpScene");
	q.delete("layout");
	q.set("seed", String(seed));
	play.href = `?${q.toString()}`;
	play.textContent = "Play this keep";
	play.style.color = "#7de8ff";
	head.append(h, a, play);
	const pre = document.createElement("pre");
	pre.id = "scene-json";
	pre.style.cssText =
		"margin:0;padding:16px 20px;font:12px/1.45 ui-monospace,monospace;white-space:pre";
	pre.textContent = text;
	document.body.append(head, pre);
	Object.assign(window, { __lanternfallScene: data });
}
