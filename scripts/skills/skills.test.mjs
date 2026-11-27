// Guard for the agent skills in skills/<name>/SKILL.md: format, links, privacy,
// number sourcing and discovery. The checks are small pure functions (unit-tested
// below with inline strings) applied to whatever skill files exist.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectedCopies } from "./sync.mjs";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const SKILLS = path.join(ROOT, "skills");
const COPIES = path.join(ROOT, ".claude", "skills");

const EXPECTED = [
	"make-a-game",
	"game-interview",
	"start-a-game",
	"verify-your-work",
	"engine-pitfalls",
	"game-feel",
	"art-direction",
	"complete-game-loop",
	"genre-playbooks",
];

const PRIVATE = [
	"docs/superpowers",
	"artifacts/",
	".superpowers",
	".claude/worktrees",
	"apps/spike-",
];

// ---- pure checks ----

function parseFrontmatter(md) {
	const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!m) return null;
	const data = {};
	for (const line of m[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		if (kv) data[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
	}
	return data;
}

function frontmatterProblems(md, folder) {
	const fm = parseFrontmatter(md);
	if (!fm) return ["missing leading --- frontmatter block"];
	const out = [];
	const keys = Object.keys(fm).sort().join(",");
	if (keys !== "description,name")
		out.push(`keys must be exactly name, description (got ${keys})`);
	if (fm.name !== folder)
		out.push(`name "${fm.name}" must equal folder "${folder}"`);
	if (!/^Use when/.test(fm.description ?? ""))
		out.push('description must start with "Use when"');
	return out;
}

const stripFences = (md) => md.replace(/^```[\s\S]*?^```/gm, "");

const REF_DEF = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?/gm;
const HREF = /\bhref\s*=\s*["']([^"']+)["']/gi;

/** Every link target outside fenced code: inline, reference definitions and href attributes. */
function linkTargets(md) {
	const t = stripFences(md);
	return [
		...[...t.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]),
		...[...t.matchAll(REF_DEF)].map((m) => m[1]),
		...[...t.matchAll(HREF)].map((m) => m[1]),
	];
}

const isRelative = (t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("#");

/** Anywhere in the raw text (fences and prose included) these must not appear. */
const PRIVATE_ANYWHERE = PRIVATE.filter((p) => p !== "artifacts/");

/** Private paths: the four internal ones anywhere; artifacts/ in link targets and inline code. */
function privacyProblems(md) {
	const out = [];
	for (const p of PRIVATE_ANYWHERE) if (md.includes(p)) out.push(p);
	const hits = [...linkTargets(md)];
	for (const m of stripFences(md).matchAll(/`([^`\n]*)`/g)) hits.push(m[1]);
	for (const h of hits)
		if (
			h.includes("artifacts/") &&
			!PRIVATE_ANYWHERE.some((p) => h.includes(p))
		)
			out.push(`${h} (artifacts/)`);
	return out;
}

/** Numbers in prose: outside frontmatter, fences and link targets, minus list markers and "Step N". */
function numbersIn(md) {
	const text = stripFences(md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""))
		.replace(/\]\([^)\s]*\)/g, "]")
		.replace(REF_DEF, "")
		.replace(HREF, "")
		.replace(/^\s*\d+[.)]\s/gm, "")
		.replace(/\bStep\s+\d+/gi, "Step");
	const nums = new Set();
	for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g))
		nums.add(m[0].replace(/,+$/, ""));
	return [...nums];
}

const noCommas = (n) => n.replace(/,/g, "");

/** True when `n` appears in `text` as a whole number (digit boundaries, commas ignored). */
function containsNumber(text, n) {
	const re = new RegExp(
		`(?<![\\d.,])${noCommas(n).replace(/\./g, "\\.")}(?![\\d]|[.,]\\d)`,
	);
	return re.test(noCommas(text).replace(/(\d),(?=\d{3}\b)/g, "$1"));
}

function unsourcedNumbers(md, sources) {
	return numbersIn(md).filter(
		(n) => !sources.some((s) => containsNumber(s, n)),
	);
}

/** make-a-game's step names, from its "a → b → c" sequence line. */
function sequenceSteps(md) {
	const m = md.match(/^([a-z][a-z ]*(?: → [a-z][a-z ]*)+)$/m);
	return m ? m[1].split(" → ").map((x) => x.trim()) : null;
}

/** Skill names in the order make-a-game's sequence table loads them (first mention wins). */
function sequenceSkills(md) {
	const rows = md.split("\n").filter((l) => /^\|\s*[A-Z]/.test(l));
	const out = ["make-a-game"];
	for (const r of rows)
		for (const m of r.matchAll(/\]\(\.\.\/([a-z-]+)\/SKILL\.md\)/g))
			if (!out.includes(m[1])) out.push(m[1]);
	return out;
}

/** Every comma list starting with "interview" that has three or more steps. */
function sequencePhrases(text) {
	return [...text.matchAll(/\binterview(?:, [a-z][a-z ]*[a-z])+/g)]
		.map((m) => m[0].split(", "))
		.filter((l) => l.length >= 3);
}

/** The string entries of `const ORDER = [...]` in a TS source. */
function orderArray(ts) {
	const m = ts.match(/const ORDER = \[([\s\S]*?)\]/);
	return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
}

// ---- filesystem helpers ----

function mdFiles(dir) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const ent of readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...mdFiles(p));
		else if (ent.name.endsWith(".md")) out.push(p);
	}
	return out.sort();
}

const skillFiles = () =>
	existsSync(SKILLS)
		? readdirSync(SKILLS, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => ({
					name: e.name,
					file: path.join(SKILLS, e.name, "SKILL.md"),
				}))
				.filter((s) => existsSync(s.file))
		: [];

const rel = (f) => path.relative(ROOT, f);
const read = (f) => readFileSync(f, "utf8");

function resolveTarget(file, target) {
	return path.resolve(path.dirname(file), target.split("#")[0]);
}

function linkedFiles(file) {
	const files = new Set();
	const own = [file];
	const skill = path.join(
		SKILLS,
		path.relative(SKILLS, file).split(path.sep)[0],
		"SKILL.md",
	);
	if (skill !== file && existsSync(skill)) own.push(skill);
	for (const f of own)
		for (const t of linkTargets(read(f))) {
			if (!isRelative(t)) continue;
			const p = resolveTarget(f, t);
			if (existsSync(p) && statSync(p).isFile()) files.add(p);
		}
	return [...files];
}

const gitIgnored = (p) =>
	spawnSync("git", ["check-ignore", "-q", p], { cwd: ROOT }).status === 0;

// ---- tests ----

describe("skill check helpers", () => {
	const good = "---\nname: x\ndescription: Use when testing\n---\n# X\n";
	it("frontmatter accepts a valid block and flags each violation", () => {
		expect(frontmatterProblems(good, "x")).toEqual([]);
		expect(frontmatterProblems(good, "y")[0]).toMatch(/must equal folder/);
		expect(frontmatterProblems("# no fm", "x")[0]).toMatch(/missing/);
		expect(
			frontmatterProblems(
				"---\nname: x\ndescription: Use when a\ntags: b\n---\n",
				"x",
			)[0],
		).toMatch(/exactly/);
		expect(
			frontmatterProblems("---\nname: x\ndescription: Helps\n---\n", "x")[0],
		).toMatch(/Use when/);
	});
	it("linkTargets ignores fenced code", () => {
		expect(
			linkTargets("[a](b.md#c) [d](https://e)\n```\n[f](g.md)\n```"),
		).toEqual(["b.md#c", "https://e"]);
		expect(isRelative("b.md")).toBe(true);
		expect(isRelative("https://e")).toBe(false);
		expect(isRelative("#top")).toBe(false);
	});
	it("privacy flags private link targets and inline-code paths", () => {
		expect(privacyProblems("[a](../../docs/superpowers/x.md)")).toHaveLength(1);
		expect(privacyProblems("see `apps/spike-foo/main.ts`")).toHaveLength(1);
		expect(privacyProblems("see `.claude/worktrees/x`")).toHaveLength(1);
		expect(
			privacyProblems("see [d](../../docs/a.md) and `apps/rockfall`"),
		).toEqual([]);
	});
	it("numbersIn skips fences, link targets, list markers, Step N, frontmatter", () => {
		const md =
			"---\nname: a1\ndescription: Use when\n---\n## Step 3\n1. one\n2) two\nLimit 1,200 and 0.5 and 42.\n[x](a2.md)\n```\n99\n```\n";
		expect(numbersIn(md).sort()).toEqual(["0.5", "1,200", "42"]);
	});
	it("numbers match on digit boundaries and ignore thousands commas", () => {
		expect(
			unsourcedNumbers("Use 6.", ["60 and 1600 and 2026 and 6.5"]),
		).toEqual(["6"]);
		expect(unsourcedNumbers("Use 6.", ["a 6 b"])).toEqual([]);
		expect(unsourcedNumbers("Use 1,200.", ["limit 1200"])).toEqual([]);
		expect(unsourcedNumbers("Use 1200.", ["limit 1,200"])).toEqual([]);
		expect(unsourcedNumbers("Use 0.5.", ["x 10.55"])).toEqual(["0.5"]);
	});
	it("privacy scans fences and prose for the four internal paths", () => {
		expect(privacyProblems("```\ncat docs/superpowers/x\n```")).toHaveLength(1);
		expect(privacyProblems("plan lives in .superpowers dir")).toHaveLength(1);
		expect(
			privacyProblems("see apps/spike-a and .claude/worktrees"),
		).toHaveLength(2);
		expect(privacyProblems("the artifacts/ word in prose")).toEqual([]);
		expect(privacyProblems("`artifacts/x.png`")).toHaveLength(1);
		expect(privacyProblems("[a](artifacts/x.png)")).toHaveLength(1);
	});
	it("linkTargets finds reference definitions and href attributes", () => {
		expect(linkTargets('[x]: ./a.md\n[y]: <b.md> "t"')).toEqual([
			"./a.md",
			"b.md",
		]);
		expect(linkTargets('<a href="c.md#z">c</a>')).toEqual(["c.md#z"]);
		expect(
			privacyProblems("[x]: ../docs/a.md\n<a href='artifacts/q'>q</a>"),
		).toHaveLength(1);
	});
	it("unsourcedNumbers reports numbers absent from every source", () => {
		expect(unsourcedNumbers("Use 60 and 77.", ["fps 60"])).toEqual(["77"]);
	});
	it("sequence helpers read the steps, the skill order, the phrases and ORDER", () => {
		const md =
			"## The sequence\n\ninterview → brief → art pass\n\n| Step | Load |\n| --- | --- |\n| Interview | [a](../game-interview/SKILL.md) |\n| Brief | [a](../game-interview/SKILL.md) |\n| Art pass | [b](../art-direction/SKILL.md) |\n";
		expect(sequenceSteps(md)).toEqual(["interview", "brief", "art pass"]);
		expect(sequenceSkills(md)).toEqual([
			"make-a-game",
			"game-interview",
			"art-direction",
		]);
		expect(
			sequencePhrases("runs: interview, brief, art pass. Also interview, x."),
		).toEqual([["interview", "brief", "art pass"]]);
		expect(orderArray('const ORDER = [\n\t"a",\n\t"b",\n];')).toEqual([
			"a",
			"b",
		]);
	});
});

describe("skills", () => {
	it("every expected skill exists", () => {
		const missing = EXPECTED.filter(
			(n) => !existsSync(path.join(SKILLS, n, "SKILL.md")),
		);
		expect(missing).toEqual([]);
	});

	it("frontmatter is name + description", () => {
		const bad = skillFiles().flatMap((s) =>
			frontmatterProblems(read(s.file), s.name).map(
				(p) => `${rel(s.file)}: ${p}`,
			),
		);
		expect(bad).toEqual([]);
	});

	it("SKILL.md starts with ---, then name: on the next line", () => {
		const bad = skillFiles()
			.filter((s) => !/^---\r?\nname:/.test(read(s.file)))
			.map((s) => rel(s.file));
		expect(bad).toEqual([]);
	});

	it("SKILL.md is under 300 lines", () => {
		const bad = skillFiles()
			.map((s) => [rel(s.file), read(s.file).split("\n").length])
			.filter(([, n]) => n >= 300)
			.map(([f, n]) => `${f}: ${n} lines`);
		expect(bad).toEqual([]);
	});

	it("relative links resolve", () => {
		const broken = [];
		for (const f of [...mdFiles(SKILLS), ...mdFiles(COPIES)])
			for (const t of linkTargets(read(f))) {
				if (!isRelative(t) || !t.split("#")[0]) continue;
				if (!existsSync(resolveTarget(f, t))) broken.push(`${rel(f)} -> ${t}`);
			}
		expect(broken).toEqual([]);
	});

	it("links stay public", () => {
		const bad = [];
		for (const f of [...mdFiles(SKILLS), ...mdFiles(COPIES)]) {
			const md = read(f);
			for (const p of privacyProblems(md)) bad.push(`${rel(f)}: ${p}`);
			for (const t of linkTargets(md)) {
				if (!isRelative(t) || !t.split("#")[0]) continue;
				const p = resolveTarget(f, t);
				if (existsSync(p) && gitIgnored(p))
					bad.push(`${rel(f)}: ${t} is gitignored`);
			}
		}
		expect(bad).toEqual([]);
	});

	it("numbers are sourced", () => {
		const bad = [];
		for (const f of mdFiles(SKILLS)) {
			const sources = linkedFiles(f).map(read);
			for (const n of unsourcedNumbers(read(f), sources))
				bad.push(`${rel(f)}: ${n} not found in any linked file`);
		}
		expect(bad).toEqual([]);
	});

	it("make-a-game names every other skill", () => {
		const f = path.join(SKILLS, "make-a-game", "SKILL.md");
		if (!existsSync(f)) return;
		const md = read(f);
		const missing = EXPECTED.filter(
			(n) => n !== "make-a-game" && !md.includes(n),
		);
		expect(missing).toEqual([]);
	});

	it("interview has the fallback", () => {
		const f = path.join(SKILLS, "game-interview", "SKILL.md");
		if (!existsSync(f)) return;
		expect(read(f)).toMatch(/^#+ .*(non-interactive|just build it)/im);
	});

	it("discoverable from .claude/skills (pnpm skills:sync)", () => {
		// Every file of every skill folder has a copy whose only difference is link
		// targets rewritten to resolve from one directory deeper.
		const want = expectedCopies();
		const bad = want
			.filter(([dst, text]) => !existsSync(dst) || read(dst) !== text)
			.map(([dst]) => `${rel(dst)} is missing or stale: run pnpm skills:sync`);
		expect(bad).toEqual([]);
		const names = EXPECTED.filter(
			(n) => !existsSync(path.join(COPIES, n, "SKILL.md")),
		);
		expect(names).toEqual([]);
		const sibling = want.filter(([dst]) => !dst.endsWith("SKILL.md"));
		expect(sibling.length).toBeGreaterThan(0);
	});

	it("the sequence in AGENTS.md, llms.txt, skills/README.md and the site matches make-a-game", () => {
		const md = read(path.join(SKILLS, "make-a-game", "SKILL.md"));
		const steps = sequenceSteps(md);
		expect(steps).not.toBeNull();
		const bad = [];
		for (const f of [
			"AGENTS.md",
			"llms.txt",
			"skills/README.md",
			"README.md",
			"site/src/pages/build-with-ai/skills.astro",
		]) {
			const phrases = sequencePhrases(read(path.join(ROOT, f)));
			if (phrases.length === 0) bad.push(`${f}: no "interview, ..." sequence`);
			for (const p of phrases)
				if (p.join(",") !== steps.join(","))
					bad.push(`${f}: "${p.join(", ")}" is not "${steps.join(", ")}"`);
		}
		expect(bad).toEqual([]);
		const order = orderArray(
			read(path.join(ROOT, "site", "src", "data", "skills.ts")),
		);
		expect(order).toEqual(sequenceSkills(md));
	});
});
