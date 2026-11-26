import { defineProject } from "vitest/config";

export default defineProject({
	test: { name: "katana-defense", include: ["test/**/*.test.ts"] },
});
