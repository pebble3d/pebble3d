import { describe, expect, it } from "vitest";
import { contactProblems } from "./contacts.ts";

describe("contacts", () => {
	it("no pose, telegraph or transition blend (t = 0.25 / 0.5 / 0.75) puts one body through the other or into the mat", () => {
		// tolerances are the README's: 3 cm for limbs, 5 cm for gripping hands, 1 cm torso to torso,
		// 3 cm into the mat
		const problems = contactProblems();
		expect(problems.slice(0, 10), `${problems.length} problems`).toEqual([]);
	});
});
