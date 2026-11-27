// Copies the repo's docs into the site before every build. Everything written here is
// generated and gitignored (see site/.gitignore):
//
//   src/content/docs/docs/**   Starlight pages: docs/*.md (not docs/superpowers) and
//                              AGENTS.md, with a title/description frontmatter added and
//                              repo-relative links rewritten to site pages or GitHub.
//   public/docs/**.md          the raw markdown twin of every docs page (links absolute).
//   public/AGENTS.md, README.md, LICENSE, llms.txt, llms-full.txt, scene.schema.json
//                              served at the site root; llms*.txt are copied unchanged.
//   public/skills/**           the agent skills (skills/**), raw markdown, links absolute.
//   public/THIRD-PARTY-NOTICES.txt  licence texts of everything redistributed (notices.mjs).
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, REPO_BRANCH, REPO_URL, SITE_URL } from "../site.config.mjs";
import { buildNotices } from "./notices.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..");
const CONTENT = join(SITE, "src/content/docs/docs");
const PUBLIC = join(SITE, "public");
const EXCLUDE = new Set(["superpowers"]);

/** Root files served raw at the site root (repo path = site path). */
const ROOT_FILES = [
	"AGENTS.md",
	"README.md",
	"LICENSE",
	"llms.txt",
	"llms-full.txt",
];
const EXTRA_FILES = { "packages/sdk/scene.schema.json": "scene.schema.json" };

/** Repo path (posix, from the repo root) -> Starlight slug under docs/, or null. */
function pageSlugOf(repoPath) {
	if (repoPath === "AGENTS.md") return "docs/agents";
	if (!repoPath.startsWith("docs/") || !repoPath.endsWith(".md")) return null;
	const rest = repoPath.slice("docs/".length, -".md".length);
	if (EXCLUDE.has(rest.split("/")[0])) return null;
	const slug = rest.replace(/(^|\/)README$/, "$1index").replace(/\/index$/, "");
	return `docs/${slug.toLowerCase()}`;
}

/** Repo paths of every docs page, in repo order. */
function docPages() {
	const out = ["AGENTS.md"];
	const walk = (dir) => {
		for (const name of readdirSync(join(REPO, dir)).sort()) {
			const p = posix.join(dir, name);
			if (statSync(join(REPO, p)).isDirectory()) {
				if (!EXCLUDE.has(name)) walk(p);
			} else if (name.endsWith(".md")) out.push(p);
		}
	};
	walk("docs");
	return out;
}

function githubUrl(repoPath) {
	const abs = join(REPO, repoPath);
	const kind = existsSync(abs) && statSync(abs).isDirectory() ? "tree" : "blob";
	return `${REPO_URL}/${kind}/${REPO_BRANCH}/${repoPath.replace(/\/$/, "")}`;
}

/** True for a markdown file of an agent skill (served raw under /skills/). */
const isSkillFile = (repoPath) =>
	repoPath.startsWith("skills/") && repoPath.endsWith(".md");

/** Repo paths of every file under skills/, in repo order. */
function skillFiles() {
	const out = [];
	const walk = (dir) => {
		for (const name of readdirSync(join(REPO, dir)).sort()) {
			const p = posix.join(dir, name);
			if (statSync(join(REPO, p)).isDirectory()) walk(p);
			else if (name.endsWith(".md")) out.push(p);
		}
	};
	walk("skills");
	return out;
}

/** Where a raw file of the repo is served on the site, or null. */
function rawSiteUrl(repoPath) {
	if (ROOT_FILES.includes(repoPath)) return `${SITE_URL}${BASE}${repoPath}`;
	if (isSkillFile(repoPath)) return `${SITE_URL}${BASE}${repoPath}`;
	if (pageSlugOf(repoPath) && repoPath.startsWith("docs/"))
		return `${SITE_URL}${BASE}${repoPath}`;
	return null;
}

/**
 * Rewrites markdown link targets `](target)` in `md` (a file at `fromPath`). `page` mode
 * points docs links at the rendered pages; `raw` mode at the raw .md twins. Anything else in
 * the repo goes to GitHub; external links and in-page anchors are left alone.
 */
function rewriteLinks(md, fromPath, mode) {
	const fromDir = posix.dirname(fromPath);
	return md.replace(
		/\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
		(all, target, title = "") => {
			if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return all;
			const [path, hash = ""] = target.split("#");
			// Starlight's heading ids collapse repeated dashes ("Shot --out" -> "shot-out");
			// GitHub's keep them. Raw twins keep GitHub's form.
			const anchor = hash
				? `#${mode === "page" ? hash.replace(/-{2,}/g, "-") : hash}`
				: "";
			if (!path) return `](${anchor}${title})`;
			const repoPath = posix.normalize(posix.join(fromDir, path));
			if (repoPath.startsWith("..")) return all;
			let url;
			if (mode === "page") {
				const slug = pageSlugOf(repoPath);
				if (slug) url = `${BASE}${slug}/${anchor}`;
				else if (
					repoPath === "llms.txt" ||
					repoPath === "llms-full.txt" ||
					isSkillFile(repoPath)
				)
					url = `${BASE}${repoPath}`;
			} else {
				const raw = rawSiteUrl(repoPath);
				if (raw) url = `${raw}${anchor}`;
			}
			url ??= `${githubUrl(repoPath)}${anchor}`;
			return `](${url}${title})`;
		},
	);
}

/** Plain text of the first paragraph after the H1, for the page description. */
function firstParagraph(body) {
	for (const block of body.split(/\n\s*\n/)) {
		const b = block.trim();
		if (!b || /^(#|\||```|-|\*|>|<|\d+\.)/.test(b)) continue;
		const text = b
			.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
			.replace(/[`*]/g, "")
			.replace(/\s+/g, " ")
			.trim();
		if (text.length > 158)
			return `${text.slice(0, 155).replace(/\s+\S*$/, "")}...`;
		return text;
	}
	return "";
}

const yamlString = (s) => JSON.stringify(s);

function toPage(repoPath) {
	const src = readFileSync(join(REPO, repoPath), "utf8");
	const m = src.match(/^# (.+)\n/m);
	if (!m) throw new Error(`${repoPath}: no H1 title`);
	const title = m[1].replace(/`/g, "").trim();
	const body = src.slice((m.index ?? 0) + m[0].length);
	const description = firstParagraph(body) || title;
	const rawUrl = `${BASE}${repoPath}`;
	const front = [
		"---",
		`title: ${yamlString(title === "AGENTS.md" ? "AGENTS.md: rules for coding agents" : title)}`,
		`description: ${yamlString(description)}`,
		`rawMarkdown: ${yamlString(rawUrl)}`,
		`sourcePath: ${yamlString(repoPath)}`,
		"head:",
		"  - tag: link",
		"    attrs:",
		"      rel: alternate",
		"      type: text/markdown",
		`      href: ${yamlString(rawUrl)}`,
		"---",
		"",
	].join("\n");
	return front + rewriteLinks(body, repoPath, "page");
}

const INDEX_PAGE = `---
title: Pebble3D docs
description: Everything you need to build a browser 3D game with Pebble3D, written so a coding agent can follow it as well as a person.
rawMarkdown: ${yamlString(`${BASE}llms.txt`)}
---

Pebble3D is a browser 3D game engine: scenes are JSON files validated by a zod schema, rendered with the three.js WebGPU renderer and simulated by Rapier physics compiled from Rust to WebAssembly.

Every page here also exists as plain markdown (add \`.md\` to the path, or use the link under each title), and [llms.txt](${BASE}llms.txt) indexes them all. [llms-full.txt](${BASE}llms-full.txt) is every page in one file.

## Start here

- [Getting started](${BASE}docs/getting-started/): from nothing to a JSON scene in the playground, then a minimal game app.
- [AGENTS.md](${BASE}docs/agents/): working rules for coding agents: layout, commands, invariants and the before-you-finish checklist.

## Reference

- [Scene reference](${BASE}docs/scene-reference/): every scene JSON field with its type, default and meaning.
- [API reference](${BASE}docs/api-reference/): \`createGame\`, the \`Game\` object, state buffers, raycasts and the package exports.
- [Examples map](${BASE}docs/examples/): where each engine feature is used in the showcase games, by file and line range.

## Verify and debug

- [Verification](${BASE}docs/verification/): \`pnpm shot\`, determinism hashes, demo bots and fps benches.
- [Troubleshooting](${BASE}docs/troubleshooting/): error messages and symptoms, each with cause and fix.

## Cookbook

Short recipes, each pointing at a game that uses it: [browse the cookbook](${BASE}docs/cookbook/).
`;

function main() {
	rmSync(CONTENT, { recursive: true, force: true });
	rmSync(join(PUBLIC, "docs"), { recursive: true, force: true });
	rmSync(join(PUBLIC, "skills"), { recursive: true, force: true });
	const pages = docPages();
	for (const repoPath of pages) {
		const slug = pageSlugOf(repoPath);
		if (!slug) continue;
		const rel = slug === "docs/agents" ? "agents" : slug.slice("docs/".length);
		const out = join(
			CONTENT,
			repoPath.endsWith("README.md") ? `${rel}/index.md` : `${rel}.md`,
		);
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, toPage(repoPath));
		if (repoPath.startsWith("docs/")) {
			const raw = join(PUBLIC, repoPath);
			mkdirSync(dirname(raw), { recursive: true });
			const src = readFileSync(join(REPO, repoPath), "utf8");
			writeFileSync(raw, rewriteLinks(src, repoPath, "raw"));
		}
	}
	writeFileSync(join(CONTENT, "index.md"), INDEX_PAGE);

	for (const f of ROOT_FILES) {
		const src = readFileSync(join(REPO, f), "utf8");
		// llms.txt and llms-full.txt are served exactly as committed.
		const out = f.endsWith(".md") ? rewriteLinks(src, f, "raw") : src;
		writeFileSync(join(PUBLIC, f), out);
	}
	const skills = skillFiles();
	for (const repoPath of skills) {
		const out = join(PUBLIC, repoPath);
		mkdirSync(dirname(out), { recursive: true });
		const src = readFileSync(join(REPO, repoPath), "utf8");
		writeFileSync(out, rewriteLinks(src, repoPath, "raw"));
	}
	for (const [from, to] of Object.entries(EXTRA_FILES))
		cpSync(join(REPO, from), join(PUBLIC, to));
	writeFileSync(join(PUBLIC, "THIRD-PARTY-NOTICES.txt"), buildNotices(REPO));
	console.log(
		`sync: ${pages.length} docs pages -> ${relative(REPO, CONTENT)}, ${skills.length} skill files, raw twins and root files -> ${relative(REPO, PUBLIC)}`,
	);
}

main();
