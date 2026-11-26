#!/usr/bin/env node
// End-to-end browser smoke test of the human paths (realtime, real GPU):
//  1. title -> Enter -> race with held keys -> R restart -> Esc back to title
//  2. a demo run that saves a best ghost (save=1), then a reload that races that best ghost:
//     the in-browser ghost must finish with the exact hash and time it was saved with.
// Fails on any console warning/error. Usage: node apps/ghostline/bench/smoke.mjs [port]
// (build first: pnpm --filter ghostline build). Only kills the preview process it started.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] ?? 5222);
const ARGS = [
	"--enable-unsafe-webgpu",
	"--enable-features=Vulkan",
	"--ignore-gpu-blocklist",
	"--use-angle=vulkan",
];

const server = spawn(
	"npx",
	["vite", "preview", "--port", String(PORT), "--strictPort"],
	{
		cwd: APP,
		detached: true,
		stdio: "ignore",
	},
);
const stop = () => {
	try {
		process.kill(-server.pid, "SIGTERM");
	} catch {}
};
process.on("exit", stop);

const fail = (m) => {
	console.error(`smoke: FAIL ${m}`);
	process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
	try {
		const r = await fetch(`http://localhost:${PORT}/`);
		if (r.ok) break;
	} catch {}
	await sleep(250);
}

const browser = await chromium.launch({ headless: true, args: ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleBad = [];
page.on("console", (m) => {
	if (m.type() === "error" || m.type() === "warning")
		consoleBad.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => consoleBad.push(`pageerror: ${e.message}`));
const probe = () => page.evaluate(() => window.__pebble3d?.game?.probe());
const waitFor = async (pred, what, ms = 60000) => {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		const p = await probe().catch(() => null);
		if (p && pred(p)) return p;
		await sleep(200);
	}
	fail(`timed out waiting for ${what}`);
};
const base = `http://localhost:${PORT}/`;

// 1. human path
await page.goto(`${base}?course=sunfold&ghost=par`); // audio on: the first key press starts WebAudio
await waitFor((p) => p.screen === "title", "title");
await page.keyboard.press("Enter");
await waitFor((p) => p.screen === "race" && p.phase === "run", "race start");
await page.keyboard.down("KeyW");
await sleep(1500);
await page.keyboard.down("KeyA");
await sleep(400);
await page.keyboard.up("KeyA");
await page.keyboard.press("Space");
await sleep(1500);
await page.keyboard.up("KeyW");
let p = await probe();
if (!(p.speed > 3 && p.progress > 20))
	fail(`marble did not roll under keyboard control: ${JSON.stringify(p)}`);
console.log(
	`smoke: keyboard run ok (progress ${p.progress}, ${p.speed.toFixed(1)} m/s, ghost tick ${p.ghost?.tick})`,
);
// I1: keys pressed during the race must not act on the title after Esc
await page.keyboard.press("Escape");
await sleep(600);
p = await probe();
if (p.screen !== "title" || p.course !== "sunfold")
	fail(`race keys leaked into the title: ${p.screen} / ${p.course}`);
await page.keyboard.press("Enter");
await waitFor((p) => p.screen === "race" && p.phase === "run", "second race");
await page.keyboard.press("KeyR");
await waitFor((p) => p.screen === "race" && p.tick < 60, "restart");
await page.keyboard.press("Escape");
await waitFor((p) => p.screen === "title", "back to title");
console.log("smoke: restart + menu ok");

// 2. save a best, then race it
await page.goto(
	`${base}?course=lacquer&mute=1&demo=1&ghost=off&save=1&bot=fast`,
);
p = await waitFor((p) => p.screen === "results", "demo finish", 120000);
if (!p.verify?.ok)
	fail("in-browser re-simulation of the finished run did not match");
const saved = await page.evaluate(() =>
	JSON.parse(localStorage.getItem("ghostline.v1.best.lacquer") ?? "null"),
);
if (!saved?.hash) fail("best ghost was not saved");
console.log(
	`smoke: saved best ${saved.finishTime.toFixed(3)} s hash ${saved.hash} (verify ${p.verify.ms.toFixed(0)} ms)`,
);
await page.goto(`${base}?course=lacquer&mute=1&demo=1&ghost=best&bot=slow`);
p = await waitFor(
	(p) => p.ghost && p.ghost.tick >= saved.ticks,
	"best ghost to finish",
	120000,
);
if (p.ghost.by !== "you") fail(`expected your best ghost, got ${p.ghost.by}`);
if (p.ghost.hash !== saved.hash)
	fail(`ghost diverged: ${p.ghost.hash} != saved ${saved.hash}`);
if (p.ghost.finishTime !== saved.finishTime) fail("ghost finish time differs");
if (p.ghost.verdict !== true)
	fail(`runtime ghost verdict was ${p.ghost.verdict}`);
console.log(
	`smoke: raced best ghost, re-simulated hash matches (${p.ghost.hash})`,
);

// I2: a corrupt stored best must fall back to the par ghost (and be removed), not block racing
await page.evaluate(() =>
	localStorage.setItem(
		"ghostline.v1.best.lacquer",
		JSON.stringify({ v: 2, inputs: "%%%", ticks: 5 }),
	),
);
await page.goto(`${base}?course=lacquer&mute=1&demo=1&ghost=best`);
p = await waitFor(
	(p) => p.screen === "race" && p.phase === "run",
	"race with a corrupt best",
);
if (p.ghost?.by !== "par")
	fail(`corrupt best not replaced by par: ${JSON.stringify(p.ghost)}`);
const left = await page.evaluate(() =>
	localStorage.getItem("ghostline.v1.best.lacquer"),
);
if (left !== null) fail("corrupt best was not removed");
console.log("smoke: corrupt best -> par ghost fallback ok");

await browser.close();
if (consoleBad.length) fail(`console:\n${consoleBad.join("\n")}`);
console.log("smoke: PASS (console clean)");
stop();
process.exit(0);
