import l1 from "../../levels/01-first-drop.json" with { type: "json" };
import l2 from "../../levels/02-bounce-house.json" with { type: "json" };
import l3 from "../../levels/03-crosswind.json" with { type: "json" };
import l4 from "../../levels/04-knock-on.json" with { type: "json" };
import l5 from "../../levels/05-catapult.json" with { type: "json" };
import l6 from "../../levels/06-grand-contraption.json" with { type: "json" };
import { type Level, parseLevel } from "./level.ts";

/** The shipped campaign, in play order. Every file is validated on import. */
export const LEVELS: readonly Level[] = [l1, l2, l3, l4, l5, l6].map((j) =>
	parseLevel(j),
);

/** A level by 1-based number or id (or id prefix such as "03"). */
export function findLevel(key: string): Level | undefined {
	const n = Number(key);
	if (Number.isInteger(n) && n >= 1 && n <= LEVELS.length) return LEVELS[n - 1];
	return LEVELS.find((l) => l.id === key || l.id.startsWith(`${key}-`));
}
