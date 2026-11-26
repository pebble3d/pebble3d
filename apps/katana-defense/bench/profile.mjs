// CPU profile of the 40-zombie horde (as bench/fps.mjs): self time per function over 6 s.
// Run after `pnpm --filter katana-defense build`: node bench/profile.mjs
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const APP = new URL("..", import.meta.url).pathname;
const PORT = 5188;
const preview = spawn(
	process.execPath,
	[
		APP + "/node_modules/vite/bin/vite.js",
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
		"--disable-frame-rate-limit",
		"--disable-gpu-vsync",
	],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(
	`http://127.0.0.1:${PORT}/?demo=1&wave=8&demoWaves=7&stress=1&mute=1&seed=3`,
);
await page.waitForFunction(
	() => window.__pebble3d?.ready && window.__pebble3d.game.alive() >= 36,
	null,
	{ timeout: 90000 },
);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await new Promise((r) => setTimeout(r, 6000));
const { profile } = await cdp.send("Profiler.stop");
const total = profile.samples.length;
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const counts = new Map();
for (const s of profile.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
for (const [id, c] of counts) {
	const n = byId.get(id);
	const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
	self.set(k, (self.get(k) ?? 0) + c);
}
console.log(
	"idle%",
	(
		(100 *
			(self.get([...self.keys()].find((k) => k.startsWith("(idle)")) ?? "") ??
				0)) /
		total
	).toFixed(1),
);
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, c] of top)
	console.log(((100 * c) / total).toFixed(1).padStart(5) + "% " + k);
await browser.close();
stop();
