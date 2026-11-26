import { defineProject } from "vitest/config";

export default defineProject({
	test: { name: "ghostline", include: ["test/**/*.test.ts"] },
});
