import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "drift-drone",
		include: ["test/**/*.test.ts"],
		testTimeout: 60_000,
	},
});
