import { EV } from "../events.ts";
import { E_STRIDE, EF, H, OFF_EVENTS } from "../snapshot.ts";
import { waveTotal } from "../waves.ts";

function fmt(n: number): string {
	return Math.round(n).toLocaleString("en-US");
}

/**
 * The wave banner for a snapshot's events (the last lifecycle event wins), or null. Pure so
 * it can be tested in Node: [headline, subline, seconds on screen].
 */
export function bannerFor(snap: Float32Array): [string, string, number] | null {
	let out: [string, string, number] | null = null;
	const n = snap[H.EVENTS] as number;
	for (let e = 0; e < n; e++) {
		const o = OFF_EVENTS + e * E_STRIDE;
		const t = snap[o + EF.TYPE] as number;
		const a = snap[o + EF.A] as number;
		if (t === EV.WAVE_START)
			out = [`WAVE ${a}`, `${fmt(waveTotal(a))} incoming`, 2.6];
		else if (t === EV.WAVE_CLEAR)
			// WAVE_CLEAR carries the bonus gold in its x field (see events.ts).
			out = [
				`WAVE ${a} HELD`,
				`+${fmt(snap[o + EF.X] as number)} bonus gold`,
				2.2,
			];
	}
	return out;
}
