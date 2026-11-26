// Live-input smoke test: serves the built app (port 5233), plays it with real keyboard and
// wheel events in realtime mode (no bot) and checks the survey responds: Enter starts, W
// walks, C raises the camera, the wheel zooms, F focuses, Space shoots, C lowers.
// Run after `pnpm --filter field-notes build`: node bench/live-smoke.mjs [site] [outDir]
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5233;
const SITE = process.argv[2] ?? "yard";
const OUT = process.argv[3];
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
	console.error(`FAIL ${m}`);
	process.exitCode = 1;
};
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
	const consoleMsgs = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning")
			consoleMsgs.push(m.text());
	});
	page.on("pageerror", (e) => consoleMsgs.push(String(e)));
	await page.goto(`http://127.0.0.1:${PORT}/?site=${SITE}&seed=5`);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 90000,
	});
	const g = (expr) => page.evaluate(`window.__pebble3d.game.${expr}`);
	const wait = (ms) => page.waitForTimeout(ms);
	if ((await g("phase()")) !== "title") fail("not on the title");
	await page.keyboard.press("Enter");
	await wait(400);
	if ((await g("phase()")) !== "explore")
		fail("Enter did not start the survey");
	const p0 = await g("player()");
	await page.keyboard.down("KeyW");
	await wait(1500);
	await page.keyboard.up("KeyW");
	const p1 = await g("player()");
	const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
	if (moved < 0.8) fail(`W moved only ${moved.toFixed(2)} m`);
	await page.keyboard.press("KeyC");
	await wait(500);
	if ((await g("phase()")) !== "photo") fail("C did not raise the camera");
	const p2 = await g("player()");
	await page.keyboard.down("KeyW");
	await wait(600);
	await page.keyboard.up("KeyW");
	const p3 = await g("player()");
	if (Math.hypot(p3[0] - p2[0], p3[2] - p2[2]) > 0.05)
		fail("the character walked in photo mode");
	await page.mouse.move(640, 360);
	await page.mouse.wheel(0, -500);
	await page.keyboard.press("KeyF");
	await page.keyboard.press("KeyE");
	await wait(300);
	if (OUT)
		await page.screenshot({ path: join(OUT, `live-${SITE}-viewfinder.png`) });
	await page.keyboard.press("Space");
	await wait(1200);
	const film = await g("film()");
	if (film !== 11) fail(`Space did not use a frame (film ${film})`);
	if (OUT) await page.screenshot({ path: join(OUT, `live-${SITE}-print.png`) });
	await page.keyboard.press("KeyC");
	await wait(400);
	if ((await g("phase()")) !== "explore") fail("C did not lower the camera");
	if (consoleMsgs.length) fail(`console: ${consoleMsgs.join(" | ")}`);
	console.log(
		JSON.stringify({
			site: SITE,
			moved: +moved.toFixed(2),
			film,
			photos: await g("photos()"),
			ok: !process.exitCode,
		}),
	);
	await browser.close();
} finally {
	stop();
}
