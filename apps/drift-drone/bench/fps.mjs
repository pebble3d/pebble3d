// In-browser frame rate during a demo race over the yard splat (live drone plus, from lap 2,
// the best-lap ghost: two Rapier worlds in lockstep): serves the built app on port 5314 and
// samples requestAnimationFrame intervals from GO for `seconds`. Uncapped by default (BENCH_VSYNC=1 keeps the 60 Hz cap).
// Run after `pnpm --filter drift-drone build`: node bench/fps.mjs [track=hall-circuit] [seconds=20] (realtime, demo bot, chase cam)
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5314;
const TRACK = process.argv[2] ?? "hall-circuit";
const SECONDS = Number(process.argv[3] ?? 20);
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
	await page.goto(`http://127.0.0.1:${PORT}/?demo=1&mute=1&track=${TRACK}`);
	await page.waitForFunction(
		() => window.__pebble3d?.game?.probe().phase === "race",
		null,
		{ timeout: 60000 },
	);
	const out = await page.evaluate(async (secs) => {
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
		samples.sort((a, b) => a - b);
		const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
		const p = (q) => samples[Math.floor(samples.length * q)];
		const g = window.__pebble3d.game.probe();
		const st = window.__pebble3d.stats();
		return {
			frames: samples.length,
			fps: 1000 / avg,
			p50ms: p(0.5),
			p95ms: p(0.95),
			p99ms: p(0.99),
			cpu: g.cpu,
			draws: st.drawCalls,
			tris: st.triangles,
			adapter: window.__pebble3d.adapterInfo,
		};
	}, SECONDS);
	console.log(JSON.stringify(out, null, 1));
	await browser.close();
} finally {
	stop();
}
