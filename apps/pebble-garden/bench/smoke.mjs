// Live-input smoke test: serves the built app (vite preview, port 5293), opens it in
// realtime mode and drives it with real mouse and keyboard events: open a challenge, place
// a piece by clicking the sand, select it, move it with a gizmo drag, undo, play, reset,
// import a broken scene (errors listed) and a valid one, and export. Fails on any console
// error or warning. Run after `pnpm --filter pebble-garden build`: node bench/smoke.mjs
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5293;
const preview = spawn(
	process.execPath,
	[
		join(APP, "node_modules/vite/bin/vite.js"),
		"preview",
		"--port",
		String(PORT),
		"--strictPort",
		"--host",
		"127.0.0.1",
	],
	{ cwd: APP, detached: true, stdio: "ignore" },
);
const stop = () => {
	try {
		process.kill(-preview.pid, "SIGTERM");
	} catch {}
};
process.on("exit", stop);
const fail = (m) => {
	console.error(`smoke: FAIL ${m}`);
	process.exitCode = 1;
};
const check = (cond, m) => (cond ? console.log(`smoke: ok   ${m}`) : fail(m));
try {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	const browser = await chromium.launch({
		channel: "chromium",
		headless: true,
		args: [
			"--enable-unsafe-webgpu",
			"--enable-features=Vulkan",
			"--ignore-gpu-blocklist",
			"--use-angle=vulkan",
		],
	});
	const page = await browser.newPage({
		viewport: { width: 1280, height: 720 },
	});
	const errors = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
	});
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto(`http://127.0.0.1:${PORT}/?mute=1`);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 60000,
	});
	const g = (k) => page.evaluate((k) => window.__pebble3d.game[k](), k);
	const wait = (ms) => page.waitForTimeout(ms);

	await page.click("text=Challenges");
	await page.click(".gcard >> nth=0");
	await wait(300);
	check((await g("phase")) === "edit", "opened a challenge in the editor");
	const n0 = await g("entities");

	// Place a wall by clicking its palette button, then the sand.
	await page.click('.piece[data-arg="wall"]');
	await page.mouse.move(640, 600);
	await page.mouse.move(650, 610);
	await page.mouse.click(650, 610);
	await wait(200);
	check((await g("entities")) === n0 + 1, "click-to-place added a piece");
	check(
		await page.isVisible("#inspector"),
		"the new piece is selected and inspected",
	);

	// Turn it with Q, nudge with arrows, then undo both.
	await page.keyboard.press("q");
	await page.keyboard.press("ArrowLeft");
	const moved = await page.inputValue('input[data-field="pos"][data-axis="0"]');
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+z");
	const back = await page.inputValue('input[data-field="pos"][data-axis="0"]');
	check(moved !== back, `arrow nudge then undo (${moved} -> ${back})`);

	// Inspector: body type and roughness.
	await page.click('#ins-body button[data-arg="dynamic"]');
	check(
		await page.isVisible('#ins-body button.on[data-arg="dynamic"]'),
		"body type switched to dynamic",
	);

	// Gizmo drag: grab the translate gizmo near the piece centre and drag.
	const before = await page.inputValue(
		'input[data-field="pos"][data-axis="2"]',
	);
	await page.mouse.move(650, 600);
	await page.mouse.down();
	await page.mouse.move(650, 560, { steps: 8 });
	await page.mouse.up();
	await wait(200);
	const after = await page.inputValue('input[data-field="pos"][data-axis="2"]');
	console.log(`smoke: info gizmo drag z ${before} -> ${after}`);

	// Play then reset.
	await page.keyboard.press("Space");
	await wait(800);
	check((await g("phase")) === "play", "Space starts the simulation");
	check((await g("simTick")) > 10, "the sim advances in realtime");
	await page.keyboard.press("Space");
	await wait(200);
	check((await g("phase")) === "edit", "Space again rewinds to edit");

	// Import a broken scene: the errors list appears and nothing changes.
	const before2 = await g("entities");
	await page.click('button.tool[data-action="import"]');
	await page.fill(
		"#import-text",
		'{"version": 1, "entities": [{"id": "x", "mesh": {"primitive": "cube"}}]}',
	);
	await page.click('button[data-action="import-apply"]');
	await wait(150);
	const errText = await page.textContent("#import-errors");
	check(
		errText?.includes("entities[0].mesh.primitive"),
		"schema error shows the field path",
	);
	check((await g("entities")) === before2, "a failed import changes nothing");

	// A valid one opens.
	await page.fill(
		"#import-text",
		'{"version": 1, "entities": [{"id": "rock", "mesh": {"primitive": "sphere"}, "body": {}, "transform": {"position": [0, 2, 0]}}]}',
	);
	await page.click('button[data-action="import-apply"]');
	await wait(200);
	check((await g("entities")) === 1, "a valid paste opens as a garden");

	// Export.
	await page.keyboard.press("x");
	await wait(150);
	const exported = await page.inputValue("#export-text");
	check(
		JSON.parse(exported).entities[0].id === "rock",
		"export shows the scene JSON",
	);
	await page.keyboard.press("Escape");

	check(
		errors.length === 0,
		`no console errors (${errors.length}) ${errors.slice(0, 3).join(" | ")}`,
	);
	await browser.close();
} finally {
	stop();
}
