import { KIND } from "./defs.ts";

/** One stream of a wave: `count` enemies of `kind` at `rate`/s from `rift` (0 A, 1 B, 2 both), after `delay` ticks. */
export interface Group {
	kind: number;
	count: number;
	rate: number;
	rift: number;
	delay: number;
}

/** Wave plans, 1-based (index 0 unused). Pure data from the wave number. */
export function wavePlan(w: number): Group[] {
	const g: Group[] = [];
	const mites = Math.round(140 * 1.36 ** (w - 1));
	const span = 14 + w; // seconds the mite stream lasts
	g.push({
		kind: KIND.MITE,
		count: mites,
		rate: mites / span,
		rift: 2,
		delay: 0,
	});
	if (w >= 3) {
		const n = 8 * (w - 2);
		g.push({
			kind: KIND.GLIDER,
			count: n,
			rate: n / (span * 0.8),
			rift: w % 2,
			delay: 240,
		});
	}
	if (w >= 6) {
		const n = 6 * (w - 5);
		g.push({
			kind: KIND.GLIDER,
			count: n,
			rate: n / (span * 0.7),
			rift: (w + 1) % 2,
			delay: 600,
		});
	}
	if (w >= 5) {
		const n = w - 4 + (w >= 10 ? w - 9 : 0);
		g.push({
			kind: KIND.BRUTE,
			count: n,
			rate: n / (span * 0.6),
			rift: 2,
			delay: 420,
		});
	}
	if (w === 12) {
		g.push({ kind: KIND.MITE, count: 2500, rate: 220, rift: 2, delay: 900 });
	}
	return g;
}

export function waveTotal(w: number): number {
	let n = 0;
	for (const g of wavePlan(w)) n += g.count;
	return n;
}
