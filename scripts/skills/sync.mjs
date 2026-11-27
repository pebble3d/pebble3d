// Copies every skill folder (skills/<name>/SKILL.md and its sibling files) into
// .claude/skills/<name>/, where Claude Code, Cursor and Copilot discover project skills.
// Copies, not symlinks, so Windows clones and exported trees work.
//
// The copies sit one directory deeper than the originals, so relative link targets are
// rewritten to resolve from the new location: links to a copied skill file point at its
// copy, everything else (docs/, apps/, ...) gets the extra ../ it needs.
//
//   node scripts/skills/sync.mjs          (pnpm skills:sync)
//   node scripts/skills/sync.mjs --check  exits 1 if the copies are stale
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
export const SKILLS = path.join(ROOT, "skills");
export const COPIES = path.join(ROOT, ".claude", "skills");

/** Skill folder names under skills/ (folders that hold a SKILL.md). */
export function skillNames() {
	return readdirSync(SKILLS, { withFileTypes: true })
		.filter(
			(e) =>
				e.isDirectory() && existsSync(path.join(SKILLS, e.name, "SKILL.md")),
		)
		.map((e) => e.name)
		.sort();
}

/** Every file of one skill folder, as paths relative to the folder (posix). */
export function skillFilesOf(name) {
	const out = [];
	const walk = (dir, rel) => {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			const r = rel ? `${rel}/${ent.name}` : ent.name;
			if (ent.isDirectory()) walk(path.join(dir, ent.name), r);
			else out.push(r);
		}
	};
	walk(path.join(SKILLS, name), "");
	return out.sort();
}

const isRelative = (t) =>
	!/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("#") && !t.startsWith("/");

/** Where a skill file's copy lives, or null when `abs` is not inside a skill folder. */
function copyOf(abs) {
	const rel = path.relative(SKILLS, abs);
	if (rel.startsWith("..") || !rel.includes(path.sep)) return null;
	return path.join(COPIES, rel);
}

/**
 * Rewrites relative link targets in markdown `md` (the file at `srcFile`) so they resolve
 * from `dstFile`. Inline links, reference definitions and href attributes; fenced code
 * is left alone.
 */
export function rewriteLinks(md, srcFile, dstFile) {
	const fix = (target) => {
		if (!isRelative(target)) return target;
		const [p, ...hash] = target.split("#");
		if (!p) return target;
		const abs = path.resolve(path.dirname(srcFile), p);
		const to = copyOf(abs) ?? abs;
		let rel = path
			.relative(path.dirname(dstFile), to)
			.split(path.sep)
			.join("/");
		if (p.endsWith("/") && !rel.endsWith("/")) rel += "/";
		return [rel, ...hash].join("#");
	};
	return md
		.split(/(^```[\s\S]*?^```)/m)
		.map((part, i) =>
			i % 2
				? part
				: part
						.replace(/\]\(([^)\s]+)/g, (_, t) => `](${fix(t)}`)
						.replace(
							/^([ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?)([^\s>]+)/gm,
							(_, pre, t) => `${pre}${fix(t)}`,
						)
						.replace(
							/(\bhref\s*=\s*["'])([^"']+)/gi,
							(_, pre, t) => `${pre}${fix(t)}`,
						),
		)
		.join("");
}

/** The expected copy for every skill file: [destination path, contents]. */
export function expectedCopies() {
	const out = [];
	for (const name of skillNames())
		for (const rel of skillFilesOf(name)) {
			const src = path.join(SKILLS, name, rel);
			const dst = path.join(COPIES, name, rel);
			const text = readFileSync(src, "utf8");
			out.push([
				dst,
				rel.endsWith(".md") ? rewriteLinks(text, src, dst) : text,
			]);
		}
	return out;
}

function main() {
	const check = process.argv.includes("--check");
	const want = expectedCopies();
	if (check) {
		const stale = want.filter(
			([dst, text]) => !existsSync(dst) || readFileSync(dst, "utf8") !== text,
		);
		for (const [dst] of stale)
			console.log(`stale: ${path.relative(ROOT, dst)}`);
		process.exit(stale.length ? 1 : 0);
	}
	// Only the folders this script owns: other skills a developer keeps here survive.
	for (const name of skillNames())
		rmSync(path.join(COPIES, name), { recursive: true, force: true });
	for (const [dst, text] of want) {
		mkdirSync(path.dirname(dst), { recursive: true });
		writeFileSync(dst, text);
	}
	console.log(
		`skills:sync: ${want.length} files -> ${path.relative(ROOT, COPIES)}`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main();
