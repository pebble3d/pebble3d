import { MAX_ZOMBIES } from "../constants.ts";
import type { WaveFile } from "../waves/director.ts";

/**
 * Clones to make per avatar up front so a wave never clones mid-fight (a visible hitch).
 * For each wave, the archetype mix (by spawn count) and each archetype's avatar list give
 * every avatar's expected share of the peak on-screen count (`maxAlive` live zombies plus
 * `corpses` still tumbling); the worst wave sets the count, with three standard deviations
 * of headroom for the random `vary` draw, capped at every zombie plus corpse on one avatar.
 */
export function warmCounts(
	waves: WaveFile,
	avatarsByArchetype: Record<string, number[]>,
	avatarCount: number,
	corpses: number,
): number[] {
	const out = new Array<number>(avatarCount).fill(0);
	const cap = MAX_ZOMBIES + corpses;
	const share = new Array<number>(avatarCount);
	for (const w of waves.waves) {
		let total = 0;
		for (const g of w.groups) total += g.count;
		if (total === 0) continue;
		share.fill(0);
		for (const g of w.groups) {
			const list = avatarsByArchetype[g.type] ?? [0];
			for (const a of list)
				if (a < avatarCount)
					share[a] = (share[a] as number) + g.count / total / list.length;
		}
		const peak = Math.min(w.maxAlive, MAX_ZOMBIES) + corpses;
		for (let a = 0; a < avatarCount; a++) {
			const s = share[a] as number;
			if (s === 0) continue;
			// mean + 3 sigma of the binomial avatar draw
			const mean = peak * s;
			const n = Math.min(
				cap,
				Math.ceil(mean + 3 * Math.sqrt(mean * (1 - s))) + 1,
			);
			if (n > (out[a] as number)) out[a] = n;
		}
	}
	return out;
}
