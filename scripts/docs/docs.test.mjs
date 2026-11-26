// Drift guard for the AI-facing docs: generated files are current, scene examples
// validate, relative links resolve and llms-full.txt covers llms.txt.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SceneSchema } from "../../packages/sdk/src/schema.ts";
import { generate } from "./gen.mjs";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);

/** User-facing markdown: docs/** (minus the internal superpowers plans/specs), AGENTS.md, README.md. */
function docFiles() {
	const out = [];
	const walk = (dir) => {
		for (const ent of readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, ent.name);
			if (ent.isDirectory()) {
				if (path.relative(ROOT, p) !== path.join("docs", "superpowers"))
					walk(p);
			} else if (ent.name.endsWith(".md")) out.push(p);
		}
	};
	walk(path.join(ROOT, "docs"));
	for (const f of ["AGENTS.md", "README.md"]) {
		const p = path.join(ROOT, f);
		if (existsSync(p)) out.push(p);
	}
	return out.sort();
}

/** Strips fenced code blocks and inline code so example text is not read as links. */
function proseOnly(md) {
	return md.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
}

function relativeLinks(md) {
	const links = [];
	for (const m of proseOnly(md).matchAll(/\]\(([^)\s]+)\)/g)) {
		const target = m[1];
		if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
		links.push(target.split("#")[0]);
	}
	return links;
}

describe("docs", () => {
	it("generated docs are current", () => {
		const stale = [];
		for (const [rel, content] of generate(ROOT)) {
			const p = path.join(ROOT, rel);
			if (!existsSync(p) || readFileSync(p, "utf8") !== content)
				stale.push(rel);
		}
		expect(stale, "run `pnpm docs:gen`").toEqual([]);
	});

	it("json scene examples validate", () => {
		const failures = [];
		let count = 0;
		for (const file of docFiles()) {
			const md = readFileSync(file, "utf8");
			for (const m of md.matchAll(/^```json\n([\s\S]*?)^```/gm)) {
				const block = m[1];
				if (!block.includes('"version"')) continue;
				count++;
				const rel = path.relative(ROOT, file);
				let json;
				try {
					json = JSON.parse(block);
				} catch (e) {
					failures.push(`${rel}: invalid JSON (${e.message})`);
					continue;
				}
				const res = SceneSchema.safeParse(json);
				if (!res.success)
					failures.push(`${rel}: ${res.error.issues[0]?.message}`);
			}
		}
		expect(count).toBeGreaterThan(0);
		expect(failures).toEqual([]);
	});

	it("relative links resolve", () => {
		const broken = [];
		for (const file of [...docFiles(), path.join(ROOT, "llms.txt")]) {
			for (const link of relativeLinks(readFileSync(file, "utf8"))) {
				if (!link) continue;
				if (!existsSync(path.resolve(path.dirname(file), link)))
					broken.push(`${path.relative(ROOT, file)} -> ${link}`);
			}
		}
		expect(broken).toEqual([]);
	});

	it("llms-full covers llms.txt", () => {
		const llms = readFileSync(path.join(ROOT, "llms.txt"), "utf8");
		const full = readFileSync(path.join(ROOT, "llms-full.txt"), "utf8");
		const links = relativeLinks(llms);
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) expect(full).toContain(`===== ${link} =====`);
	});
});
