// Live-input smoke test in realtime mode: title -> Enter -> hold W + Shift after GO ->
// tap Space -> R restarts -> Esc back to the title. Fails on any console error/warning.
// Run after `pnpm --filter skyrun build`: node bench/live-smoke.mjs
// SKYRUN_URL=<url> skips the preview server and tests an already-served build (the site).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5285;
const BASE = process.env.SKYRUN_BASE ?? "/";
const external = process.env.SKYRUN_URL;
const preview = external
	? null
	: spawn(
			process.execPath,
			[
				join(APP, "node_modules/vite/bin/vite.js"),
				"preview",
				"--port",
				String(PORT),
				"--strictPort",
				"--host",
				"127.0.0.1",
				"--base",
				BASE,
			],
			{ cwd: APP, detached: true, stdio: "ignore" },
		);
const stop = () => {
	try {
		if (preview) process.kill(-preview.pid, "SIGTERM");
	} catch {}
};
process.on("exit", stop);
const url = external ?? `http://127.0.0.1:${PORT}${BASE}`;
const fail = (m) => {
	console.error(`FAIL: ${m}`);
	process.exitCode = 1;
};
try {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(url)).ok) break;
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
	const issues = [];
	const failed = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") issues.push(m.text());
	});
	page.on("pageerror", (e) => issues.push(String(e)));
	page.on("requestfailed", (r) => failed.push(r.url()));
	page.on("response", (r) => {
		if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
	});
	await page.goto(url);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 90000,
	});
	const g = (k) => page.evaluate((key) => window.__pebble3d.game[key](), k);
	if ((await g("screen")) !== "title") fail("not on title");
	await page.keyboard.press("ArrowRight");
	if ((await g("course")) !== "gale-spires")
		fail("ArrowRight did not select the next course");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("Enter");
	await page.waitForFunction(
		() => window.__pebble3d.game.screen() === "run",
		null,
		{ timeout: 10000 },
	);
	await page.waitForFunction(() => window.__pebble3d.game.phase() === 1, null, {
		timeout: 20000,
		polling: 100,
	});
	const p0 = await g("player");
	await page.keyboard.down("KeyW");
	await page.keyboard.down("ShiftLeft");
	await page.waitForTimeout(700);
	await page.keyboard.press("Space");
	await page.waitForTimeout(500);
	await page.keyboard.up("KeyW");
	await page.keyboard.up("ShiftLeft");
	const p1 = await g("player");
	const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
	const jumps = await g("jumps");
	console.log(
		`moved ${moved.toFixed(2)} m, jumps ${jumps}, time ${await g("time")}`,
	);
	if (moved < 3) fail(`runner barely moved (${moved})`);
	if (jumps < 1) fail("Space did not jump");
	await page.keyboard.press("KeyR");
	await page.waitForTimeout(300);
	if ((await g("time")) !== 0) fail("R did not restart");
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
	if ((await g("screen")) !== "title") fail("Esc did not return to the title");
	if (issues.length) fail(`console: ${issues.join(" | ")}`);
	if (failed.length) fail(`requests: ${failed.join(" | ")}`);
	await browser.close();
	if (!process.exitCode) console.log("live smoke OK");
} finally {
	stop();
}
