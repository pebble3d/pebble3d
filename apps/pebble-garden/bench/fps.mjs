// In-browser frame rate: serves the built app with `vite preview` (port 5294), opens
// ?demo=1 in realtime mode (the autoplayer builds a contraption, plays it, rewinds and
// exports it) and samples requestAnimationFrame intervals. `full` instead opens the Rock
// Garden and presses Play (the busiest scene). BENCH_VSYNC=1 keeps the normal 60 Hz cap.
// Run after `pnpm --filter pebble-garden build`: node bench/fps.mjs [seconds=25] [demo|full]
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5294;
const SECONDS = Number(process.argv[2] ?? 25);
const MODE = process.argv[3] ?? "demo";
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
			...(process.env.BENCH_VSYNC
				? []
				: ["--disable-frame-rate-limit", "--disable-gpu-vsync"]),
		],
	});
	const page = await browser.newPage({
		viewport: { width: 1280, height: 720 },
	});
	const errors = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") errors.push(m.text());
	});
	await page.goto(
		MODE === "full"
			? `http://127.0.0.1:${PORT}/?garden=rock-garden&play=1&mute=1`
			: `http://127.0.0.1:${PORT}/?demo=1&mute=1`,
	);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 60000,
	});
	const out = await page.evaluate(async (secs) => {
		const v = window.__pebble3d;
		const samples = [];
		const levels = new Set();
		let last = performance.now();
		const t0 = last;
		await new Promise((res) => {
			const f = (now) => {
				if (now - t0 > 1000) samples.push(now - last);
				levels.add(v.game.phase());
				last = now;
				if (now - t0 < secs * 1000) requestAnimationFrame(f);
				else res();
			};
			requestAnimationFrame(f);
		});
		samples.sort((a, b) => a - b);
		const mean =
			samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
		const s = v.stats();
		return {
			frames: samples.length,
			meanMs: mean,
			fps: 1000 / mean,
			p50Ms: samples[Math.floor(samples.length * 0.5)] ?? 0,
			p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 0,
			p99Ms: samples[Math.floor(samples.length * 0.99)] ?? 0,
			cpu: v.game.cpu(),
			renderFrameMs: s.frameMs,
			drawCalls: s.drawCalls,
			triangles: s.triangles,
			phasesSeen: [...levels],
			runs: v.game.runs(),
			adapter: `${v.adapterInfo.vendor}/${v.adapterInfo.architecture}`,
		};
	}, SECONDS);
	out.consoleErrors = errors;
	console.log(JSON.stringify(out, null, 2));
	await browser.close();
} finally {
	stop();
}
