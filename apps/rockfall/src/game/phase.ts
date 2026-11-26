export const PHASE = {
	TITLE: 0,
	COUNTDOWN: 1,
	WAVE: 2,
	BREATHER: 3,
	OVER: 4,
} as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];
export const PHASE_NAMES = ["title", "countdown", "wave", "breather", "over"];
