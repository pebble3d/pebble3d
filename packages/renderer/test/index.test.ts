import { expect, it } from "vitest";

it("the package index imports in Node without side effects", async () => {
	const mod = await import("../src/index.ts");
	expect(mod.SPLAT_LAYER).toBe(1);
	expect(typeof mod.createRenderer).toBe("function");
	expect(typeof mod.InstanceRegistry).toBe("function");
	expect(typeof mod.applyLook).toBe("function");
});
