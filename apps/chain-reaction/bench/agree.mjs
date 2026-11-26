#!/usr/bin/env node
// Browser vs Node agreement: runs every level's reference solution inside headless Chromium
// (the real app bundle, WebGPU page, wasm sim; `?agree=1`) and with the Node verifier, and
// checks the final engine state hashes are identical. Exit 0 only if every level matches.
//   node apps/chain-reaction/bench/agree.mjs [--port 5253] [--no-build]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const port = process.argv.includes("--port")
	? process.argv[process.argv.indexOf("--port") + 1]
	: "5253";
const out = "artifacts/games/chain-reaction/agree";
execFileSync(
	process.execPath,
	[
		"scripts/shot/shot.mjs",
		"--app",
		"chain-reaction",
		"--port",
		port,
		"--out",
		out,
		"--name",
		"agree",
		"--ticks",
		"5",
		"--timeout",
		"240",
		"--param",
		"agree=1",
		"--param",
		"hud=0",
		...(process.argv.includes("--no-build") ? ["--no-build"] : []),
	],
	{ cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
);
const browser = JSON.parse(readFileSync(join(ROOT, out, "agree.json"), "utf8"))
	.game.agreement;
const node = JSON.parse(
	execFileSync(
		process.execPath,
		[
			"--experimental-strip-types",
			"--no-warnings",
			"apps/chain-reaction/src/cli/verify.ts",
			"--json",
		],
		{ cwd: ROOT, encoding: "utf8" },
	),
);
let bad = 0;
for (const n of node) {
	const b = browser.find((x) => x.level === n.id);
	const same =
		b && b.hash === n.hash && b.tick === n.tick && b.status === n.status;
	if (!same) bad++;
	console.log(
		`${same ? "MATCH" : "DIFF "}  ${n.id.padEnd(24)} node ${n.status}@${n.tick} ${n.hash}  browser ${b ? `${b.status}@${b.tick} ${b.hash}` : "missing"}`,
	);
}
console.log(
	bad === 0
		? `browser and Node agree on all ${node.length} levels`
		: `${bad} level(s) differ`,
);
process.exit(bad === 0 ? 0 : 1);
