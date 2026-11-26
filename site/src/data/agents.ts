// The "Build with AI" pages. Descriptive only: what files in this repo each tool can use,
// and what an agent can run to check its work. No claims about the tools beyond that.

export interface Agent {
	id: string;
	/** Full product name, for headings and page titles. */
	name: string;
	/** Short label for pills and tabs. */
	short: string;
	/** One line for the cards. */
	summary: string;
	/** Which repo file carries the rules for this tool. */
	rulesFile: { path: string; note: string };
	setup: string[];
	/** Extra advice specific to this tool. */
	tips: string[];
}

/** One prompt that works with every agent; it only uses commands the repo documents. */
export const PROMPT = `Read AGENTS.md and docs/getting-started.md first.

Create apps/playground/scenes/tower.json: the "studio" preset with a ground,
a prefab "brick" (a 0.5 m dynamic box) stacked into a 4 x 4 tower 8 bricks high,
and a heavy sphere that starts 6 m above the tower and drops onto it.
Add a camera preset "hero" that frames the whole tower.
Validate the file against packages/sdk/scene.schema.json.

Then run:  pnpm shot --scene tower --cam hero --ticks 240
Open the PNG it writes in artifacts/shots/ and read the JSON sidecar next to it.
If the sidecar lists console errors, the tower is out of frame, or nothing fell,
fix the scene and shoot again. Finish with pnpm test and pnpm lint.`;

/** What any agent can run to check its own work. */
export const CHECKS: { cmd: string; what: string; gpu?: boolean }[] = [
	{
		cmd: "pnpm shot --scene <name> --cam hero",
		what: "Renders a scene in Chromium and writes a PNG plus a JSON sidecar with the adapter, render stats, state hash, tick and console. Exits 1 on any unexpected console warning or error.",
		gpu: true,
	},
	{
		cmd: "pnpm shot --app rockfall --param demo=1 --ticks 600",
		what: "The same for a game app, driven by its ?demo=1 autoplayer bot.",
		gpu: true,
	},
	{
		cmd: 'node --experimental-strip-types packages/sdk/test/determinism.mjs --expect "$(cat packages/sdk/test/fixtures/det-hash.txt)"',
		what: "Runs the determinism fixture in Node; it must print 2d76d9927e780425.",
	},
	{
		cmd: "pnpm test && pnpm typecheck && pnpm lint",
		what: "Unit tests (including Node runs of the game sims on the real wasm), types and lint.",
	},
	{
		cmd: "pnpm --filter chain-reaction verify",
		what: "Replays every puzzle solution headless in Node and checks the stored state hashes.",
	},
	{
		cmd: "pnpm docs:gen --check",
		what: "Fails if the generated scene and API references are stale after a schema or export change.",
	},
];

export const agents: Agent[] = [
	{
		id: "claude-code",
		name: "Claude Code",
		short: "Claude Code",
		summary:
			"Run it in the repo root: CLAUDE.md points it at AGENTS.md, and it can open the PNGs that pnpm shot writes.",
		rulesFile: {
			path: "CLAUDE.md",
			note: "The repo's CLAUDE.md is one line that points at AGENTS.md, so the same rules apply to every agent.",
		},
		setup: [
			"Install the toolchain once: Node 22.6 or newer, pnpm, Rust with the wasm32-unknown-unknown target, and wasm-bindgen-cli 0.2.130.",
			"Clone the repo and run pnpm i && pnpm build:wasm && pnpm fetch-assets. For pnpm shot, also run pnpm exec playwright install chromium once.",
			"Start Claude Code in the repo root. It picks up CLAUDE.md, which sends it to AGENTS.md.",
			"Let it run pnpm commands, so it can shoot, test and lint without asking each time.",
		],
		tips: [
			"Ask it to look at the PNG after every pnpm shot. It can read image files, so it can check framing and lighting, not only the exit code.",
			"For a new game, point it at docs/getting-started.md section 3, which walks through a minimal app file by file.",
		],
	},
	{
		id: "cursor",
		name: "Cursor",
		short: "Cursor",
		summary:
			"A project rule in .cursor/rules always applies and points at AGENTS.md; agent mode can run the checks.",
		rulesFile: {
			path: ".cursor/rules/pebble3d.mdc",
			note: "An always-on project rule that summarises the invariants and points at AGENTS.md.",
		},
		setup: [
			"Install the toolchain once: Node 22.6 or newer, pnpm, Rust with the wasm32-unknown-unknown target, and wasm-bindgen-cli 0.2.130.",
			"Clone the repo, open it as the workspace folder, and run pnpm i && pnpm build:wasm && pnpm fetch-assets in the terminal.",
			"The rule in .cursor/rules/pebble3d.mdc is applied to every request in this repo.",
			"Use agent mode, so it can run pnpm shot and the tests in the terminal.",
		],
		tips: [
			"Add llms.txt or a specific docs page to the chat context when you start a larger task.",
			"If your model accepts images, attach the PNG from artifacts/shots/ so it can see the result.",
		],
	},
	{
		id: "codex",
		name: "OpenAI Codex",
		short: "Codex",
		summary:
			"Reads AGENTS.md from the repo root. Do the networked setup first so the sandbox only needs local commands.",
		rulesFile: {
			path: "AGENTS.md",
			note: "The rules live in AGENTS.md at the repo root: layout, commands, invariants and the before-you-finish checklist.",
		},
		setup: [
			"Install the toolchain once: Node 22.6 or newer, pnpm, Rust with the wasm32-unknown-unknown target, and wasm-bindgen-cli 0.2.130.",
			"Clone the repo and run pnpm i && pnpm build:wasm && pnpm fetch-assets yourself first: they download packages and assets.",
			"Start Codex in the repo root. AGENTS.md is there.",
		],
		tips: [
			"pnpm shot needs a real GPU and refuses a software adapter. In an environment without one, ask for the Node checks instead: tests, the determinism script and the chain-reaction verifier.",
			'Name the exact commands you want run before it finishes; AGENTS.md lists them under "Before you finish".',
		],
	},
	{
		id: "copilot",
		name: "GitHub Copilot",
		short: "Copilot",
		summary:
			".github/copilot-instructions.md points it at AGENTS.md; the Node checks run anywhere, pnpm shot needs a GPU.",
		rulesFile: {
			path: ".github/copilot-instructions.md",
			note: "Repository instructions that summarise the invariants and point at AGENTS.md.",
		},
		setup: [
			"Install the toolchain once: Node 22.6 or newer, pnpm, Rust with the wasm32-unknown-unknown target, and wasm-bindgen-cli 0.2.130.",
			"Clone the repo and run pnpm i && pnpm build:wasm && pnpm fetch-assets.",
			"The instructions in .github/copilot-instructions.md apply to chat and agent requests in this repo.",
			"Use agent mode in your editor, so it can run the checks in the terminal.",
		],
		tips: [
			"In a hosted environment without a GPU, pnpm shot cannot render. The tests, the determinism script and the chain-reaction verifier still run in Node.",
			"Reference docs/scene-reference.md when it writes scene JSON; every field, type and default is there.",
		],
	},
];
