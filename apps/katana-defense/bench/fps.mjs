// In-browser frame rate with a full horde: serves the built app with `vite preview` (port
// 5187), opens ?demo=1&wave=8&demoWaves=7&stress=1 in realtime mode (the bot stands down so
// the wave fills to maxAlive 40 zombies) and samples requestAnimationFrame intervals.
// Run after `pnpm --filter katana-defense build`: [PORT=<n>] node bench/fps.mjs [seconds=25]
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 5187);
const SECONDS = Number(process.argv[2] ?? 25);
/** "horde" (40 zombies) or "empty" (pre-wave, no zombies) for a baseline. */
const SCENARIO = process.argv[3] ?? "horde";
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
			// BENCH_VSYNC=1 measures under the normal 60 Hz frame cap instead of uncapped
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
		SCENARIO === "empty"
			? `http://127.0.0.1:${PORT}/?demo=1&pre=1000000&mute=1&seed=3`
			: `http://127.0.0.1:${PORT}/?demo=1&wave=8&demoWaves=7&stress=1&mute=1&seed=3&dbg=${process.argv[4] ?? ""}`,
	);
	await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
		timeout: 60000,
	});
	const out = await page.evaluate(
		async ([secs, scenario]) => {
			const v = window.__pebble3d;
			const samples = [];
			let last = performance.now();
			const t0 = last;
			let maxAlive = 0;
			await new Promise((res) => {
				const f = (now) => {
					const alive = v.game.alive();
					if (alive > maxAlive) maxAlive = alive;
					// measure only once the horde is near full
					if (scenario === "empty" || alive >= 36) samples.push(now - last);
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
				maxAlive,
				meanMs: mean,
				fps: 1000 / mean,
				p50Ms: samples[Math.floor(samples.length * 0.5)] ?? 0,
				p95Ms: samples[Math.floor(samples.length * 0.95)] ?? 0,
				over20ms:
					samples.filter((x) => x > 20).length / Math.max(1, samples.length),
				p99Ms: samples[Math.floor(samples.length * 0.99)] ?? 0,
				drawCalls: s.drawCalls,
				triangles: s.triangles,
				adapter: `${v.adapterInfo.vendor}/${v.adapterInfo.architecture}`,
				cpu: v.game.cpu(),
				physicsMs: s.physicsMs,
				zombies: v.game.zombies?.(),
			};
		},
		[SECONDS, SCENARIO],
	);
	console.log(JSON.stringify(out, null, 2));
	await browser.close();
} finally {
	stop();
}
