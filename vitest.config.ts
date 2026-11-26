import { defineConfig } from "vitest/config";

// Each workspace package with tests is a vitest project (its name comes from package.json).
// `scripts` holds the Node build tooling's tests (plain .mjs, run in Node).
export default defineConfig({
	test: {
		passWithNoTests: true,
		projects: [
			"packages/sdk",
			"packages/renderer",
			"apps/katana-defense",
			"apps/rockfall",
			"apps/field-notes",
			"apps/breakpoint",
			"apps/ghostline",
			"apps/chain-reaction",
			"apps/lanternfall",
			"apps/swarm-siege",
			"apps/skyrun",
			"apps/ringout",
			"apps/pebble-garden",
			"apps/drift-drone",
			{
				test: {
					name: "scripts",
					include: ["scripts/**/*.test.mjs"],
					environment: "node",
				},
			},
		],
	},
});
