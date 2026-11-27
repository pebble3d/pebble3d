// In-browser frame rate during the ?demo=1 CPU-vs-CPU roll at 1600x900 (seed 1: grips, guard,
// passes, then a kimura with depth of field and the desaturating vignette, then the replay).
// Serves the built app on port 5391 (the capture port: do not run both at once) and samples
// rAF intervals from the start of live play. Uncapped by default (BENCH_VSYNC=1 keeps the cap).
// Backend: BENCH_BACKEND=webgpu (default) or webgl. Prints the adapter so a SwiftShader run
// is obvious; never trust those numbers.
// Run after `pnpm --filter flowroll build`: node apps/flowroll/bench/fps.mjs [seconds=25]
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5391;
const SECONDS = Number(process.argv[2] ?? 25);
const BACKEND = process.env.BENCH_BACKEND ?? "webgpu";
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
		viewport: { width: 1600, height: 900 },
	});
	await page.goto(`http://127.0.0.1:${PORT}/?demo=1&mute=1&backend=${BACKEND}`);
	await page.waitForFunction(
		() => window.__pebble3d?.game?.probe().phase === "live",
		null,
		{ timeout: 60000 },
	);
	const out = await page.evaluate(async (secs) => {
		const samples = [];
		const subMs = [];
		const restMs = [];
		const screens = new Set();
		let sub = 0;
		let inSub = false;
		let last = performance.now();
		const t0 = last;
		await new Promise((res) => {
			const f = (now) => {
				samples.push(now - last);
				(inSub ? subMs : restMs).push(now - last);
				last = now;
				const g = window.__pebble3d.game.probe();
				screens.add(g.screen);
				inSub =
					["armbar", "triangle", "kimura", "rnc"].includes(g.position) ||
					g.screen === "replay";
				if (inSub) sub++;
				if (now - t0 < secs * 1000) requestAnimationFrame(f);
				else res();
			};
			requestAnimationFrame(f);
		});
		samples.sort((a, b) => a - b);
		const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
		const p = (q) => samples[Math.floor(samples.length * q)];
		const g = window.__pebble3d.game.probe();
		const st = window.__pebble3d.stats?.();
		const avgOf = (a) =>
			a.length
				? +(1000 / (a.reduce((x, y) => x + y, 0) / a.length)).toFixed(1)
				: null;
		const p95Of = (a) =>
			a.length
				? +[...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)].toFixed(2)
				: null;
		return {
			subFps: avgOf(subMs),
			subP95: p95Of(subMs),
			restFps: avgOf(restMs),
			restP95: p95Of(restMs),
			frames: samples.length,
			fps: +(1000 / avg).toFixed(1),
			p50ms: +p(0.5).toFixed(2),
			p95ms: +p(0.95).toFixed(2),
			p99ms: +p(0.99).toFixed(2),
			subFrames: sub,
			screens: [...screens],
			cpu: g.cpu,
			draws: st?.drawCalls,
			tris: st?.triangles,
			adapter: window.__pebble3d.adapterInfo,
		};
	}, SECONDS);
	console.log(JSON.stringify(out, null, 1));
	await browser.close();
} finally {
	stop();
}
