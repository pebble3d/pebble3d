import { describe, expect, it } from "vitest";
import { nextPhase, PHASE, type PhaseInput } from "../src/game/phase.ts";

const base: PhaseInput = {
	phase: PHASE.TITLE,
	wave: 1,
	totalWaves: 8,
	upgradeEvery: 2,
	timerDone: false,
	startPressed: false,
	picked: false,
	playerDead: false,
	objectiveDead: false,
	waveDone: false,
};
const at = (o: Partial<PhaseInput>) => nextPhase({ ...base, ...o });

describe("nextPhase", () => {
	it("title waits for start", () => {
		expect(at({})).toBe(PHASE.TITLE);
		expect(at({ startPressed: true })).toBe(PHASE.PRE_WAVE);
	});
	it("pre-wave counts down or is skipped", () => {
		expect(at({ phase: PHASE.PRE_WAVE })).toBe(PHASE.PRE_WAVE);
		expect(at({ phase: PHASE.PRE_WAVE, timerDone: true })).toBe(PHASE.WAVE);
		expect(at({ phase: PHASE.PRE_WAVE, startPressed: true })).toBe(PHASE.WAVE);
	});
	it("a wave ends in a clear, or a game over when the player or gate falls", () => {
		expect(at({ phase: PHASE.WAVE })).toBe(PHASE.WAVE);
		expect(at({ phase: PHASE.WAVE, waveDone: true })).toBe(PHASE.WAVE_CLEAR);
		expect(at({ phase: PHASE.WAVE, playerDead: true })).toBe(PHASE.GAME_OVER);
		expect(at({ phase: PHASE.WAVE, objectiveDead: true, waveDone: true })).toBe(
			PHASE.GAME_OVER,
		);
	});
	it("upgrades come after every second wave; victory after the last", () => {
		const clear = { phase: PHASE.WAVE_CLEAR, timerDone: true } as const;
		expect(at({ ...clear, wave: 1 })).toBe(PHASE.PRE_WAVE);
		expect(at({ ...clear, wave: 2 })).toBe(PHASE.UPGRADE);
		expect(at({ ...clear, wave: 7 })).toBe(PHASE.PRE_WAVE);
		expect(at({ ...clear, wave: 8 })).toBe(PHASE.VICTORY);
		expect(at({ phase: PHASE.WAVE_CLEAR, wave: 2 })).toBe(PHASE.WAVE_CLEAR);
		expect(at({ phase: PHASE.UPGRADE })).toBe(PHASE.UPGRADE);
		expect(at({ phase: PHASE.UPGRADE, picked: true })).toBe(PHASE.PRE_WAVE);
	});
	it("end screens restart on start", () => {
		expect(at({ phase: PHASE.GAME_OVER })).toBe(PHASE.GAME_OVER);
		expect(at({ phase: PHASE.GAME_OVER, startPressed: true })).toBe(
			PHASE.PRE_WAVE,
		);
		expect(at({ phase: PHASE.VICTORY, startPressed: true })).toBe(
			PHASE.PRE_WAVE,
		);
	});
});
