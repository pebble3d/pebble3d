import { describe, expect, it } from "vitest";
import { exportText, setMaterial, setTransform } from "../src/garden/doc.ts";
import { GARDENS } from "../src/garden/gardens.ts";
import { importText } from "../src/garden/validate.ts";
import { hashAfter, withPieces } from "./helpers.ts";

const N = 600;

describe("export -> import round trip", () => {
	for (const g of GARDENS) {
		it(`${g.key}: identical doc and identical state hash after ${N} ticks`, async () => {
			const doc = withPieces(g.doc, g.solution);
			const text = exportText(doc);
			const r = importText(text);
			if (!r.ok) throw new Error(JSON.stringify(r.issues));
			expect(r.doc).toEqual(doc);
			expect(r.warnings).toEqual([]);
			const before = await hashAfter(doc, N);
			const after = await hashAfter(r.doc, N);
			expect(after).toBe(before);
			// And a second export of the imported doc is byte-identical.
			expect(exportText(r.doc)).toBe(text);
		});
	}

	it("an edited garden survives the round trip too (move, recolour)", async () => {
		const doc = withPieces(GARDENS[3]?.doc ?? GARDENS[0]!.doc, [
			{ piece: "boulder", position: [0, 3, 0] },
		]);
		setTransform(
			doc,
			"boulder-2",
			[0.1234567, 3.5, -0.25],
			[0, 0.3826834, 0, 0.9238795],
			[1.2, 1.2, 1.2],
		);
		setMaterial(doc, "boulder-2", {
			color: "#AA3344",
			roughness: 0.333,
			metalness: 0.9,
		});
		const r = importText(exportText(doc));
		if (!r.ok) throw new Error("import failed");
		expect(await hashAfter(r.doc, N)).toBe(await hashAfter(doc, N));
	});

	it("rewind is exact: Play twice from the same edit state gives the same hash", async () => {
		const doc = withPieces(GARDENS[1]!.doc, GARDENS[1]!.solution);
		expect(await hashAfter(doc, 400)).toBe(await hashAfter(doc, 400));
	});

	it("the hash does depend on the garden (a moved piece changes it)", async () => {
		const g = GARDENS[1]!;
		const a = withPieces(g.doc, g.solution);
		const b = withPieces(g.doc, [
			{ piece: "sphere", position: [-3.3, 2.6, 0] },
		]);
		expect(await hashAfter(a, 300)).not.toBe(await hashAfter(b, 300));
	});
});
