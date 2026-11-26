import { parseScene } from "@pebble3d/sdk/schema";
import { describe, expect, it } from "vitest";
import { exportText, type GardenDoc } from "../src/garden/doc.ts";
import { History } from "../src/garden/history.ts";
import { GardenSimError, simulationProblem } from "../src/garden/sim.ts";
import {
	importText,
	MAX_DYNAMIC,
	MAX_ENTITIES,
	MAX_IMPORT_BYTES,
} from "../src/garden/validate.ts";
import { nodeEngine } from "./helpers.ts";

describe("hostile imports", () => {
	for (const key of [
		"toString",
		"__proto__",
		"constructor",
		"valueOf",
		"hasOwnProperty",
	]) {
		it(`a record key named ${key} with a bad field reports issues instead of throwing`, () => {
			const text = `{"camera":{"presets":{"${key}":{"position":[0,0,0],"bogus":1}}},"prefabs":{"${key}":{"colour":1}},"entities":[{"id":"${key}","mesh":{"primitive":"box","${key}":1}}]}`;
			const r = importText(text);
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
			expect(({} as Record<string, unknown>).bogus).toBeUndefined();
		});
	}

	it("refuses oversize text and too many entities with a readable message", () => {
		const big = importText(" ".repeat(MAX_IMPORT_BYTES + 1));
		expect(!big.ok && big.issues[0]?.message).toMatch(/MB/);
		const many = {
			entities: Array.from({ length: MAX_ENTITIES + 1 }, (_, i) => ({
				id: `e${i}`,
				mesh: { primitive: "box" },
			})),
		};
		const r = importText(JSON.stringify(many));
		expect(!r.ok && r.issues[0]?.message).toMatch(/at most 1500/);
		const dyn = {
			entities: Array.from({ length: MAX_DYNAMIC + 1 }, (_, i) => ({
				id: `d${i}`,
				mesh: { primitive: "box" },
				body: {},
			})),
		};
		const d = importText(JSON.stringify(dyn));
		expect(!d.ok && d.issues[0]?.message).toMatch(/dynamic bodies/);
	});

	it("schema-valid scenes the engine rejects give a readable message naming the entity", async () => {
		const engine = await nodeEngine();
		const zeroQuat = parseScene({
			entities: [
				{
					id: "twist",
					mesh: { primitive: "box" },
					body: {},
					transform: { rotation: [0, 0, 0, 0] },
				},
			],
		});
		const far = parseScene({
			entities: [
				{
					id: "far",
					mesh: { primitive: "box" },
					body: {},
					transform: { position: [1e39, 0, 0] },
				},
			],
		});
		for (const [scene, id] of [
			[zeroQuat, "twist"],
			[far, "far"],
		] as const) {
			const msg = simulationProblem(engine, scene);
			expect(msg).toMatch(new RegExp(`"${id}" cannot be simulated`));
		}
		// The engine keeps working afterwards.
		expect(
			simulationProblem(
				engine,
				parseScene({
					entities: [{ id: "ok", mesh: { primitive: "box" }, body: {} }],
				}),
			),
		).toBeNull();
		expect(new GardenSimError("x", "y").message).toBe(
			'"x" cannot be simulated: y',
		);
	});

	it("export does not rewrite strings that look like number arrays", () => {
		const doc = {
			version: 1,
			entities: [
				{ id: "a[ 1 ]", mesh: { primitive: "box" } },
				{ id: "a[1]", mesh: { primitive: "box" } },
			],
		} as GardenDoc;
		const r = importText(exportText(doc));
		expect(r.ok).toBe(true);
		if (r.ok)
			expect(r.doc.entities.map((e) => e.id)).toEqual(["a[ 1 ]", "a[1]"]);
	});

	it("undo history is bounded by size", () => {
		const h = new History(200, 1000);
		for (let i = 0; i < 50; i++) h.push(`${i}`.padEnd(100, "x"));
		expect(h.size).toBeLessThanOrEqual(1000);
		expect(h.undo("now")).toMatch(/^49/);
	});
});
