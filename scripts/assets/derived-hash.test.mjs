import { describe, expect, it } from "vitest";
import {
	ALLOW_ENV,
	ALLOW_FLAG,
	allowDerivedMismatch,
	checkDerivedHash,
} from "./derived-hash.mjs";

describe("allowDerivedMismatch", () => {
	it("is off by default (strict)", () => {
		expect(allowDerivedMismatch(["node", "fetch-assets.mjs"], {})).toBe(false);
		expect(allowDerivedMismatch([], { [ALLOW_ENV]: "0" })).toBe(false);
	});
	it("turns on with the CLI flag or the env var", () => {
		expect(allowDerivedMismatch(["node", "x", ALLOW_FLAG], {})).toBe(true);
		expect(allowDerivedMismatch([], { [ALLOW_ENV]: "1" })).toBe(true);
	});
});

describe("checkDerivedHash", () => {
	it("accepts a match in either mode", () => {
		for (const allow of [false, true])
			expect(
				checkDerivedHash({ id: "a", expected: "ff", got: "ff", allow }),
			).toEqual({
				ok: true,
			});
	});
	it("fails a mismatch in strict mode", () => {
		const r = checkDerivedHash({
			id: "splat",
			expected: "aa",
			got: "bb",
			allow: false,
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain("expected aa, got bb");
	});
	it("keeps a mismatch with a warning that prints the observed hash when allowed", () => {
		const r = checkDerivedHash({
			id: "splat",
			expected: "aa",
			got: "bb",
			allow: true,
		});
		expect(r.ok).toBe(true);
		expect(r.warning).toContain("got bb");
		expect(r.warning).toContain(ALLOW_FLAG);
	});
});
