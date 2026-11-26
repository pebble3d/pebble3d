// Live-input smoke test in realtime mode (sim in the Web Worker): begin, choose Spark with
// the 1 key, sweep the cursor until the worker's raycast pick reports a buildable pad, click
// to place, click the tower to select it, press U to upgrade, then Enter to call the wave.
// Run after `pnpm --filter swarm-siege build`: node apps/swarm-siege/bench/smoke.mjs
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5303;
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
	const issues = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") issues.push(m.text());
	});
	page.on("pageerror", (e) => issues.push(String(e)));
	await page.goto(`http://127.0.0.1:${PORT}/?mute=1&seed=7`);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 120000,
	});
	const g = (k, ...a) =>
		page.evaluate(([k, a]) => window.__pebble3d.game[k](...a), [k, a]);
	if ((await g("host")) !== "worker") fail("sim is not in the worker");
	await page.click("text=BEGIN THE SIEGE");
	await page.waitForFunction(
		() => window.__pebble3d.game.phase() === "build",
		null,
		{ timeout: 10000 },
	);
	await page.keyboard.press("Digit1");
	// Sweep the board until the worker's pick says "buildable pad".
	let spot = null;
	for (let y = 200; y < 600 && !spot; y += 24)
		for (let x = 360; x < 920 && !spot; x += 24) {
			await page.mouse.move(x, y);
			await page.waitForTimeout(40);
			const [kind, , ok] = await g("pick");
			if (kind === 1 && ok) spot = [x, y];
		}
	if (!spot) fail("no buildable pad found by picking");
	else {
		await page.mouse.click(spot[0], spot[1]);
		await page
			.waitForFunction(() => window.__pebble3d.game.towers() === 1, null, {
				timeout: 5000,
			})
			.catch(() => fail("click did not place a tower"));
		await page.keyboard.press("Escape");
		await page.waitForTimeout(150);
		await page.mouse.move(spot[0], spot[1] - 8);
		await page.waitForTimeout(150);
		await page.mouse.click(spot[0], spot[1] - 8);
		await page.waitForTimeout(150);
		const sel = await g("selected");
		if (sel < 0) fail("clicking the tower did not select it");
		await page.keyboard.press("KeyU");
		await page
			.waitForFunction(() => window.__pebble3d.game.level() === 2, null, {
				timeout: 5000,
			})
			.catch(() => fail("U did not upgrade"));
	}
	await page.keyboard.press("Enter");
	await page
		.waitForFunction(() => window.__pebble3d.game.phase() === "wave", null, {
			timeout: 5000,
		})
		.catch(() => fail("Enter did not call the wave"));
	await page
		.waitForFunction(() => window.__pebble3d.game.alive() > 20, null, {
			timeout: 20000,
		})
		.catch(() => fail("no enemies spawned"));
	const out = {
		host: await g("host"),
		towers: await g("towers"),
		level: await g("level", 0),
		phase: await g("phase"),
		alive: await g("alive"),
		gold: await g("gold"),
		issues,
	};
	console.log(JSON.stringify(out));
	if (issues.length) fail("console issues");
	if (!process.exitCode) console.log("smoke: ok");
	await browser.close();
} finally {
	stop();
}
