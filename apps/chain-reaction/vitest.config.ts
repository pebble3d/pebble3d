import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "chain-reaction",
		include: ["test/**/*.test.ts"],
		testTimeout: 60_000,
	},
});
