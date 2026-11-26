// In-browser frame rate of a real demo run: serves the built app with `vite preview`
// (port 5284), opens ?demo=1&course=<id> in realtime mode, waits for the run to start and
// samples requestAnimationFrame intervals while the bot runs the course (live sim + ghost
// sim stepping, movers, shadows, bloom, AO).
// Run after `pnpm --filter skyrun build`: node bench/fps.mjs [seconds=20]
// BENCH_UNCAPPED=1 disables vsync / the frame-rate limit (headroom instead of the 60 Hz cap).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5284;
const SECONDS = Number(process.argv[2] ?? 20);
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
			...(process.env.BENCH_UNCAPPED
				? ["--disable-frame-rate-limit", "--disable-gpu-vsync"]
				: []),
		],
	});
	const results = {};
	for (const course of ["dawnsteps", "gale-spires"]) {
		const page = await browser.newPage({
			viewport: { width: 1280, height: 720 },
		});
		const errors = [];
		page.on("console", (m) => {
			if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
		});
		page.on("pageerror", (e) => errors.push(String(e)));
		await page.goto(`http://127.0.0.1:${PORT}/?demo=1&mute=1&course=${course}`);
		await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
			timeout: 60000,
		});
		await page.waitForFunction(
			() =>
				window.__pebble3d.game.screen() === "run" &&
				window.__pebble3d.game.time() > 1,
			null,
			{
				timeout: 60000,
				polling: 250,
			},
		);
		const out = await page.evaluate(async (secs) => {
			const v = window.__pebble3d;
			const samples = [];
			let last = performance.now();
			const t0 = last;
			await new Promise((res) => {
				const f = (now) => {
					samples.push(now - last);
					last = now;
					if (now - t0 < secs * 1000) requestAnimationFrame(f);
					else res();
				};
				requestAnimationFrame(f);
			});
			samples.shift();
			samples.sort((a, b) => a - b);
			const mean =
				samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
			const s = v.stats();
			return {
				frames: samples.length,
				fps: 1000 / mean,
				meanMs: mean,
				p50Ms: samples[Math.floor(samples.length * 0.5)] ?? 0,
				p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 0,
				p99Ms: samples[Math.floor(samples.length * 0.99)] ?? 0,
				over20ms:
					samples.filter((x) => x > 20).length / Math.max(1, samples.length),
				runTime: v.game.time(),
				checkpoints: v.game.checkpoints(),
				drawCalls: s.drawCalls,
				triangles: s.triangles,
				adapter: `${v.adapterInfo.vendor}/${v.adapterInfo.architecture}`,
			};
		}, SECONDS);
		out.consoleIssues = errors;
		results[course] = out;
		await page.close();
	}
	console.log(JSON.stringify(results, null, 2));
	await browser.close();
} finally {
	stop();
}
