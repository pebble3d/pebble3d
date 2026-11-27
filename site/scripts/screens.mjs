// Full-page screenshots of the key pages at desktop and phone widths, for design review.
//   node site/scripts/screens.mjs [baseUrl] [outDir]
// Defaults: http://127.0.0.1:5320/pebble3d/ and artifacts/site/ (relative to the repo root).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const base = process.argv[2] ?? "http://127.0.0.1:5320/pebble3d/";
const out = process.argv[3] ?? join(ROOT, "artifacts/site");
mkdirSync(out, { recursive: true });

const PAGES = [
	["home", ""],
	["demos", "demos/"],
	["demo-breakpoint", "demos/breakpoint/"],
	["demo-swarm-siege", "demos/swarm-siege/"],
	["demo-skyrun", "demos/skyrun/"],
	["docs-getting-started", "docs/getting-started/"],
	["build-with-ai", "build-with-ai/"],
	["build-with-ai-claude-code", "build-with-ai/claude-code/"],
	["build-with-ai-skills", "build-with-ai/skills/"],
	["compare", "compare/"],
	["license", "license/"],
	["credits", "credits/"],
];
const WIDTHS = [
	[1440, 900],
	[390, 844],
];
const only = process.env.PAGES?.split(",");

const browser = await chromium.launch();
let failed = 0;
for (const [w, h] of WIDTHS) {
	const page = await browser.newPage({
		viewport: { width: w, height: h },
		deviceScaleFactor: 1,
	});
	page.on("console", (m) => {
		if (m.type() === "error" || m.type() === "warning") {
			failed++;
			console.log(`console ${m.type()} on ${page.url()}: ${m.text()}`);
		}
	});
	for (const [name, path] of PAGES) {
		if (only && !only.includes(name)) continue;
		const res = await page.goto(base + path, { waitUntil: "networkidle" });
		if (!res?.ok()) {
			failed++;
			console.log(`HTTP ${res?.status()} ${path}`);
		}
		// Lazy images below the fold: scroll through once so the full-page shot has them.
		await page.evaluate(async () => {
			for (let y = 0; y < document.body.scrollHeight; y += 600) {
				window.scrollTo(0, y);
				await new Promise((r) => setTimeout(r, 40));
			}
			window.scrollTo(0, 0);
		});
		await page.waitForLoadState("networkidle");
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		if (overflow > 0) {
			failed++;
			console.log(`horizontal overflow ${overflow}px on ${path} at ${w}`);
		}
		const file = join(out, `${name}-${w}.png`);
		await page.screenshot({ path: file, fullPage: true });
		console.log(`wrote ${file}`);
	}
	await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
