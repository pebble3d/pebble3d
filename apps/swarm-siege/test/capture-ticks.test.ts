import { expect, it } from "vitest";
import { emptyInput } from "../src/game/input.ts";
import { PHASE } from "../src/game/sim.ts";
import { makeSim, runBot } from "./helpers.ts";

// bench/capture-final.sh shoots these moments; a rule change that moves them fails here.
it("capture ticks: wave-12 victory and the undefended defeat", async () => {
	const won = await makeSim({ seed: 7, startWave: 12, bonusGold: 3000 });
	expect(runBot(won, 8000, (s) => s.phase === PHASE.WON)).toBe(5652);
	const lost = await makeSim({ seed: 7, startWave: 6, autoStart: true });
	const input = emptyInput();
	let t = 0;
	while (lost.phase !== PHASE.LOST && t++ < 8000) {
		lost.step(input);
		lost.events.clear();
	}
	expect(lost.tick).toBe(3254);
});
