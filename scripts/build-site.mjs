// `pnpm build:site`: the public site as one static folder, site/dist/.
//
//   1. Astro + Starlight build of site/ (marketing pages, docs, search, sitemap).
//   2. Every game in site/src/data/games.json, built from apps/<app> with
//      `vite build --base <BASE>play/<id>/` into site/dist/play/<id>/, with the engine's
//      opt-in asset base (VITE_PEBBLE3D_ASSET_BASE=<BASE>) and WebGL fallback
//      (VITE_PEBBLE3D_WEBGL_FALLBACK=1) switched on.
//   3. The shared assets (apps/playground/public/assets) and the Basis transcoder, copied
//      once to <BASE>assets/ and <BASE>basis/ instead of once per game.
//
// The base path comes from site/site.config.mjs (PEBBLE3D_SITE_BASE / PEBBLE3D_SITE_URL
// override it). Run `pnpm build:wasm` and `pnpm fetch-assets` first.
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE } from "../site/site.config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(ROOT, "site");
const DIST = join(SITE, "dist");
const PUBLIC_ASSETS = join(ROOT, "apps/playground/public/assets");

const { games } = JSON.parse(
	readFileSync(join(SITE, "src/data/games.json"), "utf8"),
);

function run(cmd, args, opts = {}) {
	console.log(
		`\n$ ${cmd} ${args.join(" ")}${opts.cwd ? `   (in ${relative(ROOT, opts.cwd)})` : ""}`,
	);
	execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir) {
	const out = [];
	const walk = (d) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else out.push(relative(dir, p));
		}
	};
	if (existsSync(dir)) walk(dir);
	return out;
}

/** Removes `dir` and its now-empty parents up to (not including) `stop`. */
function pruneEmpty(dir, stop) {
	while (dir.startsWith(stop) && dir !== stop && existsSync(dir)) {
		if (readdirSync(dir).length > 0) return;
		rmSync(dir, { recursive: true });
		dir = dirname(dir);
	}
}

if (!existsSync(join(ROOT, "packages/sdk/wasm"))) {
	console.error(
		"build-site: packages/sdk/wasm is missing; run pnpm build:wasm first",
	);
	process.exit(1);
}

// 1. The site itself (it empties dist/).
run("pnpm", ["--filter", "site", "build"]);

// 2. The games.
const shared = filesUnder(PUBLIC_ASSETS);
for (const game of games) {
	const appDir = join(ROOT, "apps", game.app);
	if (!existsSync(join(appDir, "package.json"))) {
		console.error(`build-site: ${game.id}: apps/${game.app} does not exist`);
		process.exit(1);
	}
	const out = join(DIST, "play", game.id);
	run(
		"pnpm",
		[
			"exec",
			"vite",
			"build",
			"--base",
			`${BASE}play/${game.id}/`,
			"--outDir",
			out,
			"--emptyOutDir",
			"--logLevel",
			"warn",
		],
		{
			cwd: appDir,
			env: {
				...process.env,
				VITE_PEBBLE3D_ASSET_BASE: BASE,
				VITE_PEBBLE3D_WEBGL_FALLBACK: "1",
			},
		},
	);
	// Vite copied the shared public dir into this game; those files are served once from
	// <BASE>assets/ instead. Only exact public-dir paths are removed: the game's own
	// hashed bundles also live in its assets/ folder.
	for (const rel of shared) rmSync(join(out, "assets", rel), { force: true });
	for (const rel of shared) pruneEmpty(dirname(join(out, "assets", rel)), out);
	// The minified bundle drops licence comments: ship the notices next to the game.
	cpSync(
		join(DIST, "THIRD-PARTY-NOTICES.txt"),
		join(out, "THIRD-PARTY-NOTICES.txt"),
	);
	// The transcoder resolves to <BASE>basis/ through the asset base: keep one copy.
	if (existsSync(join(out, "basis"))) {
		if (!existsSync(join(DIST, "basis")))
			cpSync(join(out, "basis"), join(DIST, "basis"), { recursive: true });
		rmSync(join(out, "basis"), { recursive: true });
	}
}

// 3. Shared assets, once.
const BIG = shared.filter((f) => !f.endsWith(".md") && !f.endsWith(".txt"));
if (BIG.length === 0)
	console.warn(
		"build-site: warning: no downloaded assets in apps/playground/public/assets; run pnpm fetch-assets",
	);
cpSync(PUBLIC_ASSETS, join(DIST, "assets"), { recursive: true });
const basisLicense = join(
	ROOT,
	"apps/playground/licenses/Basis-Apache-2.0.txt",
);
if (existsSync(join(DIST, "basis")) && existsSync(basisLicense))
	cpSync(basisLicense, join(DIST, "basis/LICENSE.txt"));

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const total = filesUnder(DIST).reduce(
	(s, f) => s + statSync(join(DIST, f)).size,
	0,
);
console.log(
	`\nbuild-site: ${games.length} games + site in ${relative(ROOT, DIST)}/ (${mb(total)}), base ${BASE}`,
);
