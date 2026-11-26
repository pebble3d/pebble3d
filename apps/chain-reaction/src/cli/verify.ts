// Chain Reaction level verifier: runs each level's reference solution through the same
// deterministic engine sim the browser uses (wasm Rapier, fixed 60 Hz) with no browser,
// and checks that the ball reaches the goal and that the final state hash matches the
// one stored in the level (`expect`), which the browser run must also reproduce.
//
//   pnpm --filter chain-reaction verify                 all levels
//   pnpm --filter chain-reaction verify 3               one level (number, id or id prefix)
//   pnpm --filter chain-reaction verify --file my.json  a level file outside the campaign
//   pnpm --filter chain-reaction verify 3 --placements '[{"part":"fan","cell":[2,6],"dir":"right"}]'
//                                                       try a candidate solution instead
//   pnpm --filter chain-reaction verify --update        (re)write each level's `expect`
//   pnpm --filter chain-reaction verify --json          machine-readable report
//
// Exit code 0 only if every checked level solves (and matches `expect`, when present).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	type Level,
	type Placement,
	PlacementSchema,
	parseLevel,
	starsFor,
} from "../puzzle/level.ts";
import { findLevel, LEVELS } from "../puzzle/levels.ts";
import { loadNodeEngine } from "../puzzle/node-engine.ts";
import { PuzzleSim } from "../puzzle/sim.ts";

interface Row {
	id: string;
	ok: boolean;
	status: string;
	reason: string | null;
	tick: number;
	hash: string;
	expectHash: string | null;
	hashMatch: boolean | null;
	parts: number;
	par: number;
	stars: number;
	error?: string;
}

function usage(msg: string): never {
	console.error(`verify: ${msg}`);
	process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name: string): boolean => {
	const i = args.indexOf(name);
	if (i < 0) return false;
	args.splice(i, 1);
	return true;
};
const opt = (name: string): string | undefined => {
	const i = args.indexOf(name);
	if (i < 0) return undefined;
	const v = args[i + 1];
	if (v === undefined) usage(`${name} needs a value`);
	args.splice(i, 2);
	return v;
};
const update = flag("--update");
const json = flag("--json");
const file = opt("--file");
const placementsArg = opt("--placements");
if (args.some((a) => a.startsWith("--")))
	usage(`unknown option ${args.find((a) => a.startsWith("--"))}`);

let targets: { level: Level; path: string | null }[];
const levelDir = new URL("../../levels/", import.meta.url);
if (file) {
	targets = [
		{ level: parseLevel(JSON.parse(readFileSync(file, "utf8"))), path: file },
	];
} else if (args.length > 0) {
	targets = args.map((k) => {
		const level = findLevel(k);
		if (!level) usage(`no level "${k}" (1-${LEVELS.length} or an id)`);
		return {
			level,
			path: fileURLToPath(new URL(`${level.id}.json`, levelDir)),
		};
	});
} else {
	targets = LEVELS.map((level) => ({
		level,
		path: fileURLToPath(new URL(`${level.id}.json`, levelDir)),
	}));
}
let candidate: Placement[] | null = null;
if (placementsArg) {
	if (targets.length !== 1) usage("--placements needs exactly one level");
	candidate = (JSON.parse(placementsArg) as unknown[]).map((p) =>
		PlacementSchema.parse(p),
	);
}

const engine = await loadNodeEngine();
const rows: Row[] = [];
for (const { level, path } of targets) {
	const placements = candidate ?? level.solution;
	const row: Row = {
		id: level.id,
		ok: false,
		status: "error",
		reason: null,
		tick: 0,
		hash: "",
		expectHash: candidate ? null : (level.expect?.hash ?? null),
		hashMatch: null,
		parts: placements.length,
		par: level.par,
		stars: starsFor(placements.length, level.par),
	};
	try {
		const sim = new PuzzleSim(engine, level, placements);
		const r = sim.run();
		sim.dispose();
		row.status = r.status;
		row.reason = r.reason;
		row.tick = r.tick;
		row.hash = r.hash;
		if (row.expectHash !== null) row.hashMatch = row.expectHash === r.hash;
		row.ok = r.status === "solved" && row.hashMatch !== false;
		if (!candidate && level.solution.length > level.par) {
			row.ok = false;
			row.error = `reference uses ${level.solution.length} parts, par is ${level.par}`;
		}
		if (update && !candidate && path && r.status === "solved") {
			const raw = JSON.parse(readFileSync(path, "utf8")) as Record<
				string,
				unknown
			>;
			raw.expect = { tick: r.tick, hash: r.hash };
			writeFileSync(path, `${JSON.stringify(raw, null, "\t")}\n`);
			row.expectHash = r.hash;
			row.hashMatch = true;
			row.ok = row.error === undefined;
		}
	} catch (e) {
		row.error = e instanceof Error ? e.message : String(e);
	}
	rows.push(row);
}

if (json) {
	console.log(JSON.stringify(rows, null, 2));
} else {
	for (const r of rows) {
		const mark = r.ok ? "PASS" : "FAIL";
		const res =
			r.status === "solved"
				? `solved at tick ${r.tick} (${(r.tick / 60).toFixed(2)} s)`
				: `${r.status}${r.reason ? ` (${r.reason})` : ""} at tick ${r.tick}`;
		const hash =
			r.hashMatch === null
				? `hash ${r.hash}`
				: r.hashMatch
					? `hash ${r.hash} = expect`
					: `hash ${r.hash} != expect ${r.expectHash}`;
		console.log(
			`${mark}  ${r.id.padEnd(24)} ${res}, ${hash}, ${r.parts} part${r.parts === 1 ? "" : "s"} (par ${r.par}, ${"*".repeat(r.stars)})${r.error ? `  ERROR: ${r.error}` : ""}`,
		);
	}
	const bad = rows.filter((r) => !r.ok).length;
	console.log(
		bad === 0
			? `all ${rows.length} verified`
			: `${bad} of ${rows.length} failed`,
	);
}
process.exit(rows.every((r) => r.ok) ? 0 : 1);
