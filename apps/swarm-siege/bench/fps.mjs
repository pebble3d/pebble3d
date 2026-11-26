// In-browser frame rate, realtime mode (sim in the Web Worker, fast wasm build).
// Serves the built app with `vite preview` (port 5302) and runs two scenarios:
//
//   demo  ?demo=1&wave=12&gold=3000&start=1 : the bot defending the final wave (towers, VFX,
//         thousands of agents). Samples requestAnimationFrame intervals for N seconds.
//   ramp  ?stress=1&rate=<r>               : an endless stream of looping mites (no deaths),
//         so the live count climbs by r per second until the 32,768-slot pool is full.
//         Every 1 s window records the live agent count and the window's mean fps; the
//         "max sustained" count is the last window before two consecutive windows under 58 fps
//         (at the 60 Hz vsync cap) or 55 fps uncapped. Isolated dips are reported separately.
//
// Run after `pnpm --filter swarm-siege build`:
//   node apps/swarm-siege/bench/fps.mjs [demo|ramp|both=both] [seconds=20] [rate=400]
// BENCH_VSYNC=1 measures under the 60 Hz cap (default uncapped: headroom).
// Optional extra query for both pages: BENCH_QUERY="worker=0" (inline sim) etc.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5302;
const WHICH = process.argv[2] ?? "both";
const SECONDS = Number(process.argv[3] ?? 20);
const RATE = Number(process.argv[4] ?? 400);
const VSYNC = !!process.env.BENCH_VSYNC;
const EXTRA = process.env.BENCH_QUERY ? `&${process.env.BENCH_QUERY}` : "";

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

async function open(browser, query) {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 720 },
	});
	const issues = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") issues.push(m.text());
	});
	page.on("pageerror", (e) => issues.push(String(e)));
	await page.goto(`http://127.0.0.1:${PORT}/?${query}${EXTRA}&mute=1`);
	await page.waitForFunction(
		() => window.__pebble3d?.ready === true || window.__pebble3d?.error,
		null,
		{ timeout: 120000 },
	);
	const err = await page.evaluate(() => window.__pebble3d.error);
	if (err) throw new Error(err);
	return { page, issues };
}

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
			...(VSYNC ? [] : ["--disable-frame-rate-limit", "--disable-gpu-vsync"]),
		],
	});
	const results = { vsync: VSYNC };
	if (WHICH === "demo" || WHICH === "both") {
		const { page, issues } = await open(
			browser,
			"demo=1&wave=12&gold=3000&start=1&seed=7",
		);
		// Let the final wave build up (the bot calls it a few seconds into the build phase).
		await page.waitForFunction(
			() => window.__pebble3d.game.alive() >= 1500,
			null,
			{ timeout: 180000, polling: 250 },
		);
		results.demo = await page.evaluate(async (secs) => {
			const v = window.__pebble3d;
			const samples = [];
			let minA = 1e9;
			let maxA = 0;
			let last = performance.now();
			const t0 = last;
			await new Promise((res) => {
				const f = (now) => {
					samples.push(now - last);
					last = now;
					const a = v.game.alive();
					minA = Math.min(minA, a);
					maxA = Math.max(maxA, a);
					if (now - t0 < secs * 1000) requestAnimationFrame(f);
					else res();
				};
				requestAnimationFrame(f);
			});
			samples.shift();
			samples.sort((a, b) => a - b);
			const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
			const s = v.stats();
			return {
				frames: samples.length,
				fps: Math.round((1000 / mean) * 10) / 10,
				meanMs: Math.round(mean * 100) / 100,
				p95Ms:
					Math.round(samples[Math.floor(samples.length * 0.95)] * 100) / 100,
				p99Ms:
					Math.round(samples[Math.floor(samples.length * 0.99)] * 100) / 100,
				agents: [minA, maxA],
				simMsPerTick: v.game.simMs(),
				mainCpuMs: v.game.cpuMs(),
				profMs: v.game.prof(),
				host: v.game.host(),
				build: v.game.build(),
				drawCalls: s.drawCalls,
				triangles: s.triangles,
				adapter: `${v.adapterInfo.vendor}/${v.adapterInfo.architecture}`,
			};
		}, SECONDS);
		results.demo.consoleIssues = issues;
		await page.close();
	}
	if (WHICH === "ramp" || WHICH === "both") {
		const { page, issues } = await open(
			browser,
			`stress=1&rate=${RATE}&seed=7`,
		);
		results.ramp = await page.evaluate(async (vsync) => {
			const v = window.__pebble3d;
			const floor = vsync ? 58 : 55;
			const windows = [];
			let frames = 0;
			let ws = performance.now();
			await new Promise((res) => {
				const f = (now) => {
					frames++;
					if (now - ws >= 1000) {
						const alive = v.game.alive();
						windows.push({
							alive,
							fps: Math.round(((frames * 1000) / (now - ws)) * 10) / 10,
							simMs: v.game.simMs(),
							cpuMs: v.game.cpuMs(),
						});
						frames = 0;
						ws = now;
						const n = windows.length;
						// Stop once the pool is full (three equal windows), after two slow
						// windows in a row, or after 120 s.
						if (n > 3 && windows[n - 3].alive === alive) return res();
						if (
							n > 2 &&
							windows[n - 1].fps < floor &&
							windows[n - 2].fps < floor
						)
							return res();
						if (n > 120) return res();
					}
					requestAnimationFrame(f);
				};
				requestAnimationFrame(f);
			});
			// Skip the first window (shader warm-up). Sustained = the last count before two slow
			// windows in a row (an isolated dip is a hitch, not a ceiling). Dips are listed.
			let sustained = 0;
			const dips = [];
			for (let i = 1; i < windows.length; i++) {
				const slow = windows[i].fps < floor;
				if (slow && i + 1 < windows.length && windows[i + 1].fps < floor) break;
				if (slow) dips.push(windows[i]);
				else sustained = windows[i].alive;
			}
			return {
				floorFps: floor,
				maxSustained: sustained,
				dips,
				host: v.game.host(),
				build: v.game.build(),
				windows,
			};
		}, VSYNC);
		results.ramp.consoleIssues = issues;
		await page.close();
	}
	console.log(JSON.stringify(results, null, 2));
	await browser.close();
} finally {
	stop();
}
