import { defineProject } from "vitest/config";

export default defineProject({
	test: { name: "breakpoint", include: ["test/**/*.test.ts"] },
});
