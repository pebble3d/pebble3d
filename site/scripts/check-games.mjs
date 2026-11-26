// Loads every game from the built site (served by serve.mjs) in Chromium and checks that
// it renders with no console errors and no failed requests.
//   node site/scripts/check-games.mjs [baseUrl] [--fallback]
// Default: WebGPU, with the flags `pnpm shot` uses. `--fallback` launches Chromium with
// WebGPU switched off (hardware WebGL still on) and checks the WebGL fallback ran and
// showed its notice.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const fallback = args.includes("--fallback");
const base =
	args.find((a) => !a.startsWith("--")) ?? "http://127.0.0.1:5320/pebble3d/";
const out = join(ROOT, "artifacts/site/games");
mkdirSync(out, { recursive: true });
const { games } = JSON.parse(
	readFileSync(join(ROOT, "site/src/data/games.json"), "utf8"),
);
const only = process.env.GAMES?.split(",");

const browser = await chromium.launch({
	// Fallback mode keeps hardware WebGL and hides navigator.gpu (below), like a browser
	// without WebGPU.
	args: [
		...(fallback ? [] : ["--enable-unsafe-webgpu"]),
		"--enable-features=Vulkan",
		"--use-angle=vulkan",
		"--ignore-gpu-blocklist",
	],
});
let failures = 0;
for (const g of games) {
	if (only && !only.includes(g.id)) continue;
	const page = await browser.newPage({
		viewport: { width: 1280, height: 720 },
	});
	if (fallback)
		await page.addInitScript(() => {
			Object.defineProperty(Navigator.prototype, "gpu", {
				get: () => undefined,
			});
		});
	const problems = [];
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning")
			problems.push(`console ${m.type()}: ${m.text()}`);
	});
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("response", (r) => {
		if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
	});
	page.on("requestfailed", (r) =>
		problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`),
	);
	const url = `${base}play/${g.id}/`;
	await page.goto(url, { waitUntil: "load" });
	let ready = false;
	try {
		await page.waitForFunction(() => window.__pebble3d?.ready === true, null, {
			timeout: 60_000,
		});
		ready = true;
	} catch {
		problems.push("window.__pebble3d.ready never became true");
	}
	// Let it run (title orbit, attract mode) and load lazy assets.
	await page.waitForTimeout(6000);
	const info = await page.evaluate(() => ({
		backend: window.__pebble3d?.adapterInfo?.backend ?? null,
		error: window.__pebble3d?.error ?? null,
		notice: document.getElementById("pebble3d-webgl-notice") !== null,
	}));
	const want = fallback ? "webgl" : "webgpu";
	if (info.backend !== want)
		problems.push(`backend ${info.backend}, wanted ${want}`);
	if (info.error) problems.push(`__pebble3d.error: ${info.error}`);
	if (fallback !== info.notice)
		problems.push(`fallback notice ${info.notice ? "shown" : "missing"}`);
	// Expected in fallback mode: three's own message that it switched backends.
	const real = problems.filter(
		(p) =>
			!(
				fallback &&
				/WebGPU is not available|WebGL 2 backend|GL Driver Message \(OpenGL, Performance/i.test(
					p,
				)
			),
	);
	await page.screenshot({
		path: join(out, `${g.id}-${fallback ? "webgl" : "webgpu"}.png`),
	});
	console.log(
		`${real.length ? "FAIL" : "ok  "} ${g.id.padEnd(15)} ready=${ready} backend=${info.backend} notice=${info.notice}`,
	);
	for (const p of real) console.log(`     ${p}`);
	if (real.length) failures++;
	const skipped = problems.length - real.length;
	if (skipped)
		console.log(`     (${skipped} expected fallback message(s) ignored)`);
	await page.close();
}
await browser.close();
process.exit(failures ? 1 : 0);
