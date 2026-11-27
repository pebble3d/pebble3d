// The agent skills in the repo's skills/<name>/SKILL.md, read at build time. Name and
// description come from each file's frontmatter, so the page never drifts from the files.

export interface Skill {
	name: string;
	description: string;
	/** Repo path, also the site path of the raw markdown (synced by scripts/sync.mjs). */
	path: string;
	/** Sibling files (genre playbooks, techniques, templates), as repo paths. */
	extras: string[];
}

/**
 * The order make-a-game runs them in (its sequence table, skills/make-a-game/SKILL.md);
 * a guard test in scripts/skills/skills.test.mjs keeps the two in step. Anything new goes
 * at the end.
 */
const ORDER = [
	"make-a-game",
	"game-interview",
	"start-a-game",
	"engine-pitfalls",
	"genre-playbooks",
	"game-feel",
	"art-direction",
	"complete-game-loop",
	"verify-your-work",
];

const files = import.meta.glob("../../../skills/*/*.md", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

function frontmatter(md: string): Record<string, string> {
	const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const out: Record<string, string> = {};
	for (const line of m?.[1].split(/\r?\n/) ?? []) {
		const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
		if (kv) out[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
	}
	return out;
}

const repoPath = (key: string) => key.replace(/^(\.\.\/)+/, "");

export const skills: Skill[] = Object.entries(files)
	.filter(([key]) => key.endsWith("/SKILL.md"))
	.map(([key, md]) => {
		const fm = frontmatter(md);
		const path = repoPath(key);
		const dir = path.slice(0, -"SKILL.md".length);
		if (!fm.name || !fm.description)
			throw new Error(`${path}: frontmatter needs name and description`);
		return {
			name: fm.name,
			description: fm.description,
			path,
			extras: Object.keys(files)
				.map(repoPath)
				.filter((p) => p.startsWith(dir) && p !== path)
				.sort(),
		};
	})
	.sort((a, b) => {
		const ia = ORDER.indexOf(a.name);
		const ib = ORDER.indexOf(b.name);
		return (
			(ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name)
		);
	});

const WORDS = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
];
/** "nine", from the number of SKILL.md files, so copy never drifts from the repo. */
export const skillCount = (): string =>
	WORDS[skills.length] ?? String(skills.length);
/** "Nine", for the start of a sentence. */
export const SkillCount = (): string =>
	skillCount().charAt(0).toUpperCase() + skillCount().slice(1);
