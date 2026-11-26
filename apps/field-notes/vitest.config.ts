import { defineProject } from "vitest/config";

export default defineProject({
	test: { name: "field-notes", include: ["test/**/*.test.ts"] },
});
