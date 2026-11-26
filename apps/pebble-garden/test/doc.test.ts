import { describe, expect, it } from "vitest";
import {
	addPiece,
	duplicateEntity,
	emptyDoc,
	exportText,
	removeEntity,
	setBodyType,
	setMaterial,
	setTransform,
} from "../src/garden/doc.ts";
import { PIECES, pieceByKey } from "../src/garden/pieces.ts";
import { importText } from "../src/garden/validate.ts";

describe("garden doc edits", () => {
	it("every palette piece produces a schema-valid scene", () => {
		const d = emptyDoc();
		PIECES.forEach((p, i) => {
			addPiece(d, p, [i * 2 - 12, 1, 0]);
		});
		const r = importText(exportText(d));
		if (!r.ok) throw new Error(JSON.stringify(r.issues));
		expect(r.scene.entities).toHaveLength(PIECES.length);
	});

	it("prefab pieces add one prefab definition and reference it", () => {
		const d = emptyDoc();
		const domino = pieceByKey("domino")!;
		addPiece(d, domino, [0, 0.5, 0]);
		addPiece(d, domino, [1, 0.5, 0]);
		expect(Object.keys(d.prefabs ?? {})).toEqual(["domino"]);
		expect(d.entities.map((e) => e.id)).toEqual(["domino", "domino-2"]);
		expect(d.entities[1]).toEqual({
			id: "domino-2",
			prefab: "domino",
			transform: { position: [1, 0.5, 0] },
		});
	});

	it("edits write tidy overrides", () => {
		const d = emptyDoc();
		const id = addPiece(d, pieceByKey("box")!, [0, 0.4, 0]);
		setTransform(d, id, [1.000049, 2, 3], [0, 0, 0, 1], [2, 1, 1]);
		setMaterial(d, id, { color: "#FF0000", roughness: 1.5 });
		setBodyType(d, id, "static");
		const e = d.entities[0]!;
		expect(e.transform).toEqual({ position: [1, 2, 3], scale: [2, 1, 1] });
		expect(e.mesh?.material).toMatchObject({ color: "#ff0000", roughness: 1 });
		expect(e.body?.type).toBe("static");
		const copy = duplicateEntity(d, id, [1, 0, 0]);
		expect(copy).toBe("block-2");
		expect(removeEntity(d, id)).toBe(true);
		expect(d.entities.map((x) => x.id)).toEqual(["block-2"]);
	});

	it("export keeps short number arrays on one line", () => {
		const d = emptyDoc();
		addPiece(d, pieceByKey("box")!, [1.5, 0.4, -2]);
		expect(exportText(d)).toContain('"position": [1.5, 0.4, -2]');
	});
});
