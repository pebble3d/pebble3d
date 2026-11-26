// In-browser frame rate with a full arena: serves the built app with `vite preview` (port
// 5242), opens ?demo=1&start=1&wave=7&rubble=1400&god=1 in realtime mode for each engine
// build and samples requestAnimationFrame intervals once the pit is near its rock cap (1,350+).
// Run after `pnpm --filter rockfall build`: node bench/fps.mjs [seconds=20] [full|empty]
// BENCH_UNCAPPED=1 disables vsync / the frame-rate limit (headroom instead of the 60 Hz cap).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5242;
const SECONDS = Number(process.argv[2] ?? 20);
/** "full" (rock cap reached) or "empty" (countdown, no rocks: the render baseline). */
const SCENARIO = process.argv[3] ?? "full";
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
	for (const build of ["deterministic", "fast"]) {
		const page = await browser.newPage({
			viewport: { width: 1280, height: 720 },
		});
		const errors = [];
		page.on("console", (m) => {
			if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
		});
		await page.goto(
			SCENARIO === "empty"
				? `http://127.0.0.1:${PORT}/?demo=1&mute=1&seed=7&build=${build}`
				: `http://127.0.0.1:${PORT}/?demo=1&start=1&wave=7&rubble=1400&god=1&mute=1&seed=7&build=${build}`,
		);
		await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
			timeout: 60000,
		});
		await page.waitForFunction(
			(empty) => empty || window.__pebble3d.game.rocks() >= 1350,
			SCENARIO === "empty",
			{ timeout: 120000, polling: 250 },
		);
		const out = await page.evaluate(async (secs) => {
			const v = window.__pebble3d;
			const samples = [];
			let last = performance.now();
			const t0 = last;
			let minRocks = 1e9;
			let maxRocks = 0;
			await new Promise((res) => {
				const f = (now) => {
					samples.push(now - last);
					last = now;
					const r = v.game.rocks();
					minRocks = Math.min(minRocks, r);
					maxRocks = Math.max(maxRocks, r);
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
			const [awake, asleep] = v.game.bodies();
			return {
				frames: samples.length,
				fps: 1000 / mean,
				meanMs: mean,
				p50Ms: samples[Math.floor(samples.length * 0.5)] ?? 0,
				p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 0,
				p99Ms: samples[Math.floor(samples.length * 0.99)] ?? 0,
				over20ms:
					samples.filter((x) => x > 20).length / Math.max(1, samples.length),
				rocks: [minRocks, maxRocks],
				awake,
				asleep,
				simMsPerTick: v.game.simMs(),
				drawCalls: s.drawCalls,
				triangles: s.triangles,
				adapter: `${v.adapterInfo.vendor}/${v.adapterInfo.architecture}`,
			};
		}, SECONDS);
		out.consoleIssues = errors;
		results[build] = out;
		await page.close();
	}
	console.log(JSON.stringify(results, null, 2));
	await browser.close();
} finally {
	stop();
}
