// Checks every internal link in the built site (site/dist): href/src in every HTML page,
// markdown links in the raw .md twins, and links in llms.txt. A link is internal when it
// is relative, starts with the base path, or starts with the site URL plus the base.
// Fragments (#id) on HTML pages must match an id in the target page.
//   node site/scripts/check-links.mjs        exits 1 on any broken link
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, SITE_URL } from "../site.config.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const ORIGIN = "http://site.local";

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

/** dist file for a site path under BASE, or null. */
function fileFor(pathname) {
	if (!pathname.startsWith(BASE)) return null;
	let rel = decodeURIComponent(pathname.slice(BASE.length));
	if (rel === "" || rel.endsWith("/")) rel += "index.html";
	const f = join(DIST, rel);
	if (existsSync(f) && statSync(f).isFile()) return f;
	return null;
}

const idCache = new Map();
function idsOf(file) {
	let ids = idCache.get(file);
	if (!ids) {
		const html = readFileSync(file, "utf8");
		ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
		idCache.set(file, ids);
	}
	return ids;
}

const files = walk(DIST);
// The games' own bundles are not part of the site's link graph.
const isGameFile = (f) => relative(DIST, f).startsWith("play/");
const pageUrl = (f) => {
	const rel = relative(DIST, f).split("\\").join("/");
	return `${ORIGIN}${BASE}${rel.replace(/index\.html$/, "")}`;
};

const broken = [];
let checked = 0;
let external = 0;

function check(from, raw) {
	const link = raw.trim().replace(/&amp;/g, "&");
	if (!link || /^(mailto|tel|data|javascript):/i.test(link)) return;
	let url;
	if (link.startsWith(`${SITE_URL}${BASE}`))
		url = new URL(link.slice(SITE_URL.length), ORIGIN);
	else if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//")) {
		external++;
		return;
	} else url = new URL(link, pageUrl(from));
	if (url.origin !== ORIGIN) {
		external++;
		return;
	}
	checked++;
	const target = fileFor(url.pathname);
	const where = relative(DIST, from);
	if (!target) {
		broken.push(`${where}: ${raw} -> ${url.pathname} (missing)`);
		return;
	}
	if (url.hash && target.endsWith(".html")) {
		const id = decodeURIComponent(url.hash.slice(1));
		if (!idsOf(target).has(id))
			broken.push(
				`${where}: ${raw} -> #${id} not found in ${relative(DIST, target)}`,
			);
	}
}

let pages = 0;
for (const f of files) {
	// The games' bundles are not site pages; 404.html's canonical names a page that
	// intentionally does not exist.
	if (isGameFile(f) || relative(DIST, f) === "404.html") continue;
	if (f.endsWith(".html")) {
		pages++;
		const html = readFileSync(f, "utf8")
			// Code samples are text, not links.
			.replace(/<pre[\s\S]*?<\/pre>/g, "")
			.replace(/<code[\s\S]*?<\/code>/g, "");
		for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) check(f, m[1]);
		for (const m of html.matchAll(/\ssrcset="([^"]*)"/g))
			for (const part of m[1].split(",")) check(f, part.trim().split(/\s+/)[0]);
	} else if (f.endsWith(".md") || f.endsWith("llms.txt")) {
		const text = readFileSync(f, "utf8").replace(/```[\s\S]*?```/g, "");
		for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) check(f, m[1]);
	}
}

// Every game in the list must have a playable index.html.
const { games } = JSON.parse(
	readFileSync(join(DIST, "../src/data/games.json"), "utf8"),
);
for (const g of games)
	if (!fileFor(`${BASE}play/${g.id}/`))
		broken.push(`play/${g.id}/: game not built`);

console.log(
	`check-links: ${pages} pages, ${checked} internal links checked, ${external} external skipped, ${broken.length} broken`,
);
for (const b of broken) console.log(`  BROKEN ${b}`);
process.exit(broken.length ? 1 : 0);
