// Every number the site says about a game must appear in that game's committed README
// (apps/<app>/README.md), so public, LLM-indexed copy cannot drift from its source.
//   node site/scripts/check-claims.mjs        exits 1 on a missing README or an unsourced number
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { games } = JSON.parse(
	readFileSync(join(ROOT, "site/src/data/games.json"), "utf8"),
);

/** Every string value in `v`, recursively. */
const strings = (v) =>
	typeof v === "string"
		? [v]
		: Array.isArray(v)
			? v.flatMap(strings)
			: v && typeof v === "object"
				? Object.values(v).flatMap(strings)
				: [];

// Fields that are not claims: ids, paths and file names.
const SKIP = new Set(["id", "app", "file", "href"]);
const problems = [];
let checked = 0;
for (const g of games) {
	const readme = join(ROOT, "apps", g.app, "README.md");
	if (!existsSync(readme)) {
		problems.push(`${g.id}: apps/${g.app}/README.md is missing`);
		continue;
	}
	const source = readFileSync(readme, "utf8");
	const text = Object.entries(g)
		.filter(([k]) => !SKIP.has(k))
		.flatMap(([, v]) =>
			strings(
				Array.isArray(v)
					? v.map((o) =>
							o && typeof o === "object"
								? Object.fromEntries(
										Object.entries(o).filter(([k]) => !SKIP.has(k)),
									)
								: o,
						)
					: v,
			),
		)
		.join("\n");
	for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?(?:[–-]\d[\d,]*)?/g)) {
		const n = m[0].replace(/,$/, "");
		checked++;
		if (!source.includes(n))
			problems.push(
				`${g.id}: "${n}" (in "...${text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\n/g, " ")}...") is not in apps/${g.app}/README.md`,
			);
	}
}
console.log(
	`check-claims: ${games.length} games, ${checked} numbers checked, ${problems.length} problems`,
);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length ? 1 : 0);
