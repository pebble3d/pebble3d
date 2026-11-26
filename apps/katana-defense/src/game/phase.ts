/** Run phases and the pure transition function between them. */
export const PHASE = {
	TITLE: 0,
	PRE_WAVE: 1,
	WAVE: 2,
	WAVE_CLEAR: 3,
	UPGRADE: 4,
	VICTORY: 5,
	GAME_OVER: 6,
} as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];

export const PHASE_NAMES: Record<Phase, string> = {
	0: "title",
	1: "preWave",
	2: "wave",
	3: "waveClear",
	4: "upgrade",
	5: "victory",
	6: "gameOver",
};

export interface PhaseInput {
	phase: Phase;
	/** 1-based wave number of the current/last wave. */
	wave: number;
	totalWaves: number;
	upgradeEvery: number;
	/** The phase's countdown reached zero. */
	timerDone: boolean;
	startPressed: boolean;
	/** An upgrade was picked this frame. */
	picked: boolean;
	playerDead: boolean;
	objectiveDead: boolean;
	/** Every spawn issued and every zombie dead. */
	waveDone: boolean;
}

/**
 * title -> preWave -> wave -> waveClear -> (upgrade every `upgradeEvery` waves) -> preWave
 * ... -> victory after the last wave; gameOver whenever the player or objective falls
 * during preWave/wave. victory/gameOver -> preWave (wave 1) on start. Returns the same
 * phase when nothing changes.
 */
export function nextPhase(s: PhaseInput): Phase {
	switch (s.phase) {
		case PHASE.TITLE:
			return s.startPressed ? PHASE.PRE_WAVE : PHASE.TITLE;
		case PHASE.PRE_WAVE:
			if (s.playerDead || s.objectiveDead) return PHASE.GAME_OVER;
			return s.timerDone || s.startPressed ? PHASE.WAVE : PHASE.PRE_WAVE;
		case PHASE.WAVE:
			if (s.playerDead || s.objectiveDead) return PHASE.GAME_OVER;
			return s.waveDone ? PHASE.WAVE_CLEAR : PHASE.WAVE;
		case PHASE.WAVE_CLEAR:
			if (!s.timerDone) return PHASE.WAVE_CLEAR;
			if (s.wave >= s.totalWaves) return PHASE.VICTORY;
			return s.wave % s.upgradeEvery === 0 ? PHASE.UPGRADE : PHASE.PRE_WAVE;
		case PHASE.UPGRADE:
			return s.picked ? PHASE.PRE_WAVE : PHASE.UPGRADE;
		case PHASE.VICTORY:
		case PHASE.GAME_OVER:
			return s.startPressed ? PHASE.PRE_WAVE : s.phase;
	}
}
