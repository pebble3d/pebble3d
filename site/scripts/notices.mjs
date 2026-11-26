// Builds THIRD-PARTY-NOTICES.txt: the licence notices of everything the site and the demos
// redistribute. The minified game bundles drop the original licence comments, and the
// fonts and the Rust crates inside the wasm ship without their licence texts, so the
// texts are collected here and served at the site root (and next to every game).
//   - npm packages bundled into the games (three, zod) and shipped by the site (fonts,
//     Astro, Starlight, Pagefind UI), with their LICENSE files.
//   - every Rust crate compiled into the engine wasm (normal dependencies of engine-core,
//     all features, wasm32 target), from `cargo metadata`, with their licence files.
// Identical licence texts are printed once, with the components that share them.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Licence texts for packages that ship without a licence file, copied from each
 * project's repository (site/notices/<file>; the URL is the copy's source).
 */
const VENDORED = {
	rapier3d: [
		"rapier3d.txt",
		"https://github.com/dimforge/rapier/blob/master/LICENSE",
	],
	parry3d: [
		"parry3d.txt",
		"https://github.com/dimforge/parry/blob/master/LICENSE",
	],
	rstar: [
		"rstar.txt",
		"https://github.com/georust/rstar/blob/master/LICENSE-MIT",
	],
	profiling: [
		"profiling.txt",
		"https://github.com/aclysma/profiling/blob/master/LICENSE-MIT",
	],
	"profiling-procmacros": [
		"profiling.txt",
		"https://github.com/aclysma/profiling/blob/master/LICENSE-MIT",
	],
	pagefind: [
		"pagefind.txt",
		"https://github.com/CloudCannon/pagefind/blob/main/LICENSE",
	],
	"@pagefind/default-ui": [
		"pagefind.txt",
		"https://github.com/CloudCannon/pagefind/blob/main/LICENSE",
	],
};
const NOTICES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../notices");

/** Licence texts for package `name` in `dir`, falling back to the vendored copy. */
function textsFor(name, dir) {
	const own = licenseFiles(dir);
	if (own.length || !VENDORED[name]) return own;
	const [file, url] = VENDORED[name];
	return [
		`(Copied from ${url}; the package does not include it.)\n\n${readFileSync(join(NOTICES_DIR, file), "utf8").trim()}`,
	];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

function licenseFiles(dir) {
	return readdirSync(dir)
		.filter((f) => LICENSE_FILE.test(f) && statSync(join(dir, f)).isFile())
		.sort()
		.map((f) => readFileSync(join(dir, f), "utf8").trim());
}

/** The installed directory of `name` as seen from package directory `from` (pnpm layout). */
function findPackage(name, from) {
	const direct = join(from, "node_modules", name);
	if (existsSync(join(direct, "package.json"))) return realpathSync(direct);
	// pnpm: a package's own dependencies are its siblings in .pnpm/<id>/node_modules/.
	let dir = realpathSync(from);
	while (dir !== dirname(dir)) {
		const sib = join(dir, name);
		if (dir.endsWith("node_modules") && existsSync(join(sib, "package.json")))
			return realpathSync(sib);
		dir = dirname(dir);
	}
	throw new Error(`notices: cannot find npm package ${name} from ${from}`);
}

const NPM = [
	// [package, resolve from (repo-relative), what it is used for]
	["three", "packages/renderer", "rendering; bundled in every demo"],
	["zod", "packages/sdk", "scene schema validation; bundled in every demo"],
	[
		"@fontsource/space-grotesk",
		"site",
		"Space Grotesk font files served by this site",
	],
	[
		"@fontsource/jetbrains-mono",
		"site",
		"JetBrains Mono font files served by this site",
	],
	["astro", "site", "site generator; small client scripts on docs pages"],
	["@astrojs/starlight", "site", "docs theme and its client scripts"],
	[
		"@pagefind/default-ui",
		"site/node_modules/@astrojs/starlight",
		"docs search UI",
	],
	["pagefind", "site/node_modules/@astrojs/starlight", "docs search runtime"],
];

function npmComponents(root) {
	return NPM.map(([name, from, use]) => {
		const dir = findPackage(name, join(root, from));
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		return {
			name: `${pkg.name} ${pkg.version}`,
			license: pkg.license ?? "see text",
			use,
			texts: textsFor(pkg.name, dir),
		};
	});
}

function rustComponents(root) {
	const meta = JSON.parse(
		execFileSync(
			"cargo",
			[
				"metadata",
				"--format-version",
				"1",
				"--all-features",
				"--filter-platform",
				"wasm32-unknown-unknown",
				"--locked",
			],
			{ cwd: root, encoding: "utf8", maxBuffer: 64 << 20 },
		),
	);
	const byId = new Map(meta.packages.map((p) => [p.id, p]));
	const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
	const start = meta.packages.find((p) => p.name === "engine-core");
	if (!start) throw new Error("notices: engine-core not in cargo metadata");
	const seen = new Set();
	const queue = [start.id];
	while (queue.length) {
		const id = queue.shift();
		if (seen.has(id)) continue;
		seen.add(id);
		for (const d of nodes.get(id)?.deps ?? [])
			if (d.dep_kinds.some((k) => k.kind === null)) queue.push(d.pkg);
	}
	seen.delete(start.id);
	return [...seen]
		.map((id) => byId.get(id))
		.filter(Boolean)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((p) => ({
			name: `${p.name} ${p.version}`,
			license: p.license ?? p.license_file ?? "see text",
			use: "Rust crate in the engine's WebAssembly build",
			texts: textsFor(p.name, dirname(p.manifest_path)),
		}));
}

export function buildNotices(root) {
	const npm = npmComponents(root);
	let rust;
	try {
		rust = rustComponents(root);
	} catch (e) {
		throw new Error(
			`notices: cargo metadata failed (Rust toolchain needed for the wasm crate list): ${e.message}`,
		);
	}
	const all = [...npm, ...rust];
	const groups = new Map(); // text -> component names
	for (const c of all)
		for (const t of c.texts) {
			const names = groups.get(t) ?? [];
			names.push(c.name);
			groups.set(t, names);
		}
	const line = "=".repeat(78);
	const out = [
		"Third-party notices: the Pebble3D website and demos",
		"",
		"The Pebble3D engine is under the Pebble3D Engine License (LICENSE). The website and",
		"the playable demos also redistribute the third-party components below, each under",
		"its own licence. This file is generated by site/scripts/notices.mjs at build time.",
		"",
		"Also served with the site:",
		"  - assets/LICENSES.md: the demo assets (CC BY 4.0, CC0 1.0 and MIT works) with",
		"    attribution, and assets/licenses/Microsoft-Rocketbox-MIT.txt",
		"  - basis/LICENSE.txt: the Basis Universal transcoder (Apache-2.0)",
		"",
		line,
		"Components",
		line,
		...all.map(
			(c) =>
				`  ${c.name}  (${c.license})  ${c.use}${c.texts.length ? "" : "  [no licence file shipped in the package]"}`,
		),
		"",
		line,
		"Licence texts",
		line,
	];
	for (const [text, names] of groups) {
		out.push("", `--- ${names.join(", ")} ---`, "", text, "");
	}
	return `${out.join("\n")}\n`;
}
