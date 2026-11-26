// In-browser frame rate of a Lanternfall demo heist: serves the built app with `vite preview` (port
// 5263), opens ?demo=1 (keep 64) in realtime mode and samples requestAnimationFrame intervals, split
// by game phase (title = whole-keep flyover with 10 pooled lights; play = follow camera).
// Run after `pnpm --filter lanternfall build`: node bench/fps.mjs [seconds=30] [extra query]
// BENCH_VSYNC=1 measures under the normal 60 Hz cap instead of uncapped.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5263;
const SECONDS = Number(process.argv[2] ?? 30);
const EXTRA = process.argv[3] ?? "";
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
		viewport: {
			width: Number(process.env.BENCH_W ?? 1280),
			height: Number(process.env.BENCH_H ?? 720),
		},
	});
	await page.goto(
		`http://127.0.0.1:${PORT}/?demo=1&mute=1&seed=64${EXTRA ? `&${EXTRA}` : ""}`,
	);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 90000,
	});
	const out = await page.evaluate(async (secs) => {
		const v = window.__pebble3d;
		const by = {};
		let last = performance.now();
		const t0 = last;
		await new Promise((res) => {
			const f = (now) => {
				const ph = v.game?.phase() ?? "boot";
				if (now - t0 > 1500) {
					by[ph] ??= [];
					by[ph].push(now - last);
				}
				last = now;
				if (now - t0 < secs * 1000 && ph !== "escaped" && ph !== "caught")
					requestAnimationFrame(f);
				else res();
			};
			requestAnimationFrame(f);
		});
		const sum = (xs) => {
			xs.sort((a, b) => a - b);
			const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
			return {
				frames: xs.length,
				fps: Math.round(10000 / mean) / 10,
				p50Ms: xs[Math.floor(xs.length * 0.5)] ?? 0,
				p95Ms: xs[Math.floor(xs.length * 0.95)] ?? 0,
				p99Ms: xs[Math.floor(xs.length * 0.99)] ?? 0,
			};
		};
		const s = v.stats();
		const res = {
			adapter: `${v.adapterInfo.vendor}/${v.adapterInfo.architecture}`,
		};
		for (const k of Object.keys(by)) res[k] = sum(by[k]);
		res.drawCalls = s.drawCalls;
		res.triangles = s.triangles;
		res.cpuMs = v.game?.cpuMs();
		return res;
	}, SECONDS);
	console.log(JSON.stringify(out, null, 2));
	await browser.close();
} finally {
	stop();
}
