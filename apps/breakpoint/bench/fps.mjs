// Real-time frame rate of the demo run: serves the built app with `vite preview` (port 5212),
// opens ?demo=1 in realtime mode and samples requestAnimationFrame intervals plus the game
// probe (awake bodies, Rapier ms/tick, time scale) for N seconds.
// Run after `pnpm --filter breakpoint build`: node bench/fps.mjs [seconds=60] [level=0]
// BENCH_VSYNC=1 keeps the normal 60 Hz cap (default: uncapped, to show headroom).
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5212;
const SECONDS = Number(process.argv[2] ?? 60);
const LEVEL = Number(process.argv[3] ?? 0);
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
		`http://127.0.0.1:${PORT}/?demo=1&mute=1&level=${LEVEL}${process.env.BENCH_BUILD ? `&build=${process.env.BENCH_BUILD}` : ""}${process.env.BENCH_WORKER === "0" ? "&worker=0" : ""}`,
	);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 60000,
	});
	const out = await page.evaluate(async (secs) => {
		const v = window.__pebble3d;
		const frames = [];
		const idle = [];
		const sim = [];
		let last = performance.now();
		const t0 = last;
		await new Promise((res) => {
			const f = (now) => {
				frames.push(now - last);
				const p = v.game.probe();
				if (p.state !== "title" && p.awake < 5) idle.push(now - last);
				last = now;
				if (p.state !== "title" && p.awake > 100)
					sim.push([p.awake, p.tickMs, p.timeScale]);
				if (now - t0 < secs * 1000) requestAnimationFrame(f);
				else res();
			};
			requestAnimationFrame(f);
		});
		frames.sort((a, b) => a - b);
		const q = (k) => frames[Math.floor((frames.length - 1) * k)];
		const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
		const heavy = sim.length
			? {
					samples: sim.length,
					meanAwake: sim.reduce((a, s) => a + s[0], 0) / sim.length,
					peakAwake: Math.max(...sim.map((s) => s[0])),
					meanTickMs: sim.reduce((a, s) => a + s[1], 0) / sim.length,
				}
			: null;
		idle.sort((a, b) => a - b);
		const idleMean = idle.length
			? idle.reduce((a, b) => a + b, 0) / idle.length
			: 0;
		return {
			idle: idle.length
				? {
						frames: idle.length,
						fps: 1000 / idleMean,
						p95ms: idle[Math.floor((idle.length - 1) * 0.95)],
					}
				: null,
			frames: frames.length,
			fps: 1000 / mean,
			p50ms: q(0.5),
			p95ms: q(0.95),
			p99ms: q(0.99),
			heavy,
			probe: v.game.probe(),
		};
	}, SECONDS);
	console.log(JSON.stringify({ ...out, consoleErrors: errors }, null, 2));
	await browser.close();
} finally {
	stop();
}
