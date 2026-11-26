import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "swarm-siege",
		include: ["test/**/*.test.ts"],
		testTimeout: 60_000,
	},
});
