/**
 * The position graph, as data. Every position has two roles ("top" and "bottom"; in standing
 * both roles are symmetric). Each role lists the moves it can launch and the counters it can
 * answer with. Every move names the counter that beats it, the position it leads to and which
 * role the attacker holds there. Submission moves lead to a submission state (a tension
 * contest) and name where the roll returns if the defender escapes.
 *
 * Extending the game is editing this table; `test/graph.test.ts` checks the invariants
 * (reachability from standing, every move has a counter, no dead ends, unique keys per role).
 */

export type Dir = "up" | "left" | "down" | "right";
export type Role = "top" | "bottom";
export type PosId =
	| "standing"
	| "closedGuard"
	| "halfGuard"
	| "sideControl"
	| "kneeOnBelly"
	| "mount"
	| "back"
	| "armbar"
	| "triangle"
	| "kimura"
	| "rnc";

export type MoveKind =
	| "takedown"
	| "pull"
	| "pass"
	| "advance"
	| "sweep"
	| "reversal"
	| "escape"
	| "sub";

/** Posture telegraphs the renderer keys before a move's window opens (see view/poses.ts). */
export type Tell =
	| "levelChange"
	| "reapLeg"
	| "sitBack"
	| "standUp"
	| "stack"
	| "scissor"
	| "hipUp"
	| "legShoot"
	| "kneeSlide"
	| "figureFour"
	| "underhook"
	| "kneeIn"
	| "duckUnder"
	| "stepOver"
	| "kneeUp"
	| "shrimp"
	| "legPummel"
	| "spinArm"
	| "turnIn"
	| "sitHigh"
	| "bridge"
	| "armUnder"
	| "shoulderWalk";

export interface MoveDef {
	id: string;
	name: string;
	dir: Dir;
	kind: MoveKind;
	/** Target position (a submission state for kind "sub"). */
	to: PosId;
	/** The role the attacker holds in `to` (subs: always "top", the finisher). */
	as: Role;
	points: number;
	/** Grip needed to launch (0..1). */
	grip: number;
	/** Gas spent on launch (0..1). */
	gas: number;
	/** Telegraph length in ticks at full gas, before the timing window opens. */
	telegraph: number;
	/** Id of the defender's counter (in the same position) that beats this move. */
	counter: string;
	tell: Tell;
	/** Subs only: where the roll goes when the defender escapes, and the attacker's role there. */
	escapeTo?: { pos: PosId; as: Role };
	hint: string;
}

export interface CounterDef {
	id: string;
	name: string;
	dir: Dir;
	hint: string;
}

export interface RoleDef {
	label: string;
	moves: MoveDef[];
	counters: CounterDef[];
}

export interface PositionDef {
	id: PosId;
	name: string;
	kind: "neutral" | "position" | "sub";
	/** Subs: the escape the defender must time on each beat. */
	escape?: { name: string; dir: Dir };
	roles: Record<Role, RoleDef>;
}

const m = (d: MoveDef): MoveDef => d;
const c = (id: string, name: string, dir: Dir, hint: string): CounterDef => ({
	id,
	name,
	dir,
	hint,
});

const STANDING_MOVES: MoveDef[] = [
	m({
		id: "doubleLeg",
		name: "Double-leg",
		dir: "up",
		kind: "takedown",
		to: "closedGuard",
		as: "top",
		points: 2,
		grip: 0.3,
		gas: 0.08,
		telegraph: 40,
		counter: "sprawl",
		tell: "levelChange",
		hint: "Drop your level and drive through the hips.",
	}),
	m({
		id: "osoto",
		name: "Outside trip",
		dir: "left",
		kind: "takedown",
		to: "sideControl",
		as: "top",
		points: 2,
		grip: 0.5,
		gas: 0.07,
		telegraph: 34,
		counter: "hipBlock",
		tell: "reapLeg",
		hint: "Pull the collar, reap the far leg.",
	}),
	m({
		id: "pullGuard",
		name: "Pull guard",
		dir: "right",
		kind: "pull",
		to: "closedGuard",
		as: "bottom",
		points: 0,
		grip: 0.2,
		gas: 0.04,
		telegraph: 28,
		counter: "stepAround",
		tell: "sitBack",
		hint: "Sit to guard and close the legs.",
	}),
];
const STANDING_COUNTERS: CounterDef[] = [
	c("sprawl", "Sprawl", "down", "Kick the legs back, hips heavy."),
	c("hipBlock", "Hip block", "up", "Square the hips, post the leg."),
	c("stepAround", "Step around", "right", "Step off the line as they sit."),
];

const ARM_ESCAPE = { name: "Stack & pull", dir: "up" as Dir };

export const POSITIONS: PositionDef[] = [
	{
		id: "standing",
		name: "Standing",
		kind: "neutral",
		roles: {
			top: {
				label: "Standing",
				moves: STANDING_MOVES,
				counters: STANDING_COUNTERS,
			},
			bottom: {
				label: "Standing",
				moves: STANDING_MOVES,
				counters: STANDING_COUNTERS,
			},
		},
	},
	{
		id: "closedGuard",
		name: "Closed guard",
		kind: "position",
		roles: {
			top: {
				label: "In the guard",
				moves: [
					m({
						id: "standOpen",
						name: "Stand & open",
						dir: "up",
						kind: "advance",
						to: "halfGuard",
						as: "top",
						points: 0,
						grip: 0.3,
						gas: 0.06,
						telegraph: 36,
						counter: "breakPosture",
						tell: "standUp",
						hint: "Stand in posture, pry the ankles open.",
					}),
					m({
						id: "stackPass",
						name: "Stack pass",
						dir: "right",
						kind: "pass",
						to: "sideControl",
						as: "top",
						points: 3,
						grip: 0.6,
						gas: 0.1,
						telegraph: 44,
						counter: "hipOut",
						tell: "stack",
						hint: "Fold them onto their shoulders and walk around.",
					}),
				],
				counters: [
					c("baseOut", "Base out", "left", "Post a hand, widen the knees."),
					c("stackDef", "Stack", "up", "Drive forward onto their hips."),
					c("postureUp", "Posture up", "right", "Spine straight, head up."),
				],
			},
			bottom: {
				label: "Guard",
				moves: [
					m({
						id: "scissor",
						name: "Scissor sweep",
						dir: "left",
						kind: "sweep",
						to: "mount",
						as: "top",
						points: 2,
						grip: 0.5,
						gas: 0.08,
						telegraph: 38,
						counter: "baseOut",
						tell: "scissor",
						hint: "Knee across the belly, chop the far leg.",
					}),
					m({
						id: "armbarG",
						name: "Armbar",
						dir: "up",
						kind: "sub",
						to: "armbar",
						as: "top",
						points: 0,
						grip: 0.6,
						gas: 0.08,
						telegraph: 42,
						counter: "stackDef",
						tell: "hipUp",
						escapeTo: { pos: "closedGuard", as: "bottom" },
						hint: "Hips up, leg over the head.",
					}),
					m({
						id: "triangle",
						name: "Triangle",
						dir: "right",
						kind: "sub",
						to: "triangle",
						as: "top",
						points: 0,
						grip: 0.55,
						gas: 0.08,
						telegraph: 40,
						counter: "postureUp",
						tell: "legShoot",
						escapeTo: { pos: "closedGuard", as: "bottom" },
						hint: "Shoot a leg over the shoulder, lock the figure four.",
					}),
				],
				counters: [
					c(
						"breakPosture",
						"Break posture",
						"up",
						"Pull them down by the collar.",
					),
					c("hipOut", "Hip out", "left", "Shrimp away before the stack lands."),
				],
			},
		},
	},
	{
		id: "halfGuard",
		name: "Half guard",
		kind: "position",
		roles: {
			top: {
				label: "Half guard top",
				moves: [
					m({
						id: "kneeCut",
						name: "Knee-cut pass",
						dir: "up",
						kind: "pass",
						to: "sideControl",
						as: "top",
						points: 3,
						grip: 0.5,
						gas: 0.09,
						telegraph: 40,
						counter: "kneeShield",
						tell: "kneeSlide",
						hint: "Slice the knee across the thigh.",
					}),
					m({
						id: "kimuraH",
						name: "Kimura",
						dir: "right",
						kind: "sub",
						to: "kimura",
						as: "top",
						points: 0,
						grip: 0.6,
						gas: 0.08,
						telegraph: 42,
						counter: "hideArm",
						tell: "figureFour",
						escapeTo: { pos: "halfGuard", as: "top" },
						hint: "Figure-four the near arm.",
					}),
				],
				counters: [
					c("crossface", "Crossface", "up", "Shoulder across the jaw."),
					c("flatten", "Flatten", "left", "Hips down, chest heavy."),
					c(
						"whizzer",
						"Whizzer",
						"right",
						"Overhook the arm, sprawl the hips.",
					),
				],
			},
			bottom: {
				label: "Half guard",
				moves: [
					m({
						id: "underhook",
						name: "Underhook sweep",
						dir: "up",
						kind: "sweep",
						to: "halfGuard",
						as: "top",
						points: 2,
						grip: 0.5,
						gas: 0.08,
						telegraph: 38,
						counter: "crossface",
						tell: "underhook",
						hint: "Dig the underhook, come up on the side.",
					}),
					m({
						id: "recover",
						name: "Recover guard",
						dir: "left",
						kind: "escape",
						to: "closedGuard",
						as: "bottom",
						points: 0,
						grip: 0.25,
						gas: 0.05,
						telegraph: 30,
						counter: "flatten",
						tell: "kneeIn",
						hint: "Knee in, re-close the legs.",
					}),
					m({
						id: "backTake",
						name: "Back take",
						dir: "right",
						kind: "advance",
						to: "back",
						as: "top",
						points: 4,
						grip: 0.65,
						gas: 0.1,
						telegraph: 46,
						counter: "whizzer",
						tell: "duckUnder",
						hint: "Duck under the arm, take the back.",
					}),
				],
				counters: [
					c(
						"kneeShield",
						"Knee shield",
						"up",
						"Frame the knee across their hips.",
					),
					c(
						"hideArm",
						"Hide the arm",
						"right",
						"Grab your own belt, elbow tight.",
					),
				],
			},
		},
	},
	{
		id: "sideControl",
		name: "Side control",
		kind: "position",
		roles: {
			top: {
				label: "Side control",
				moves: [
					m({
						id: "mountStep",
						name: "Step to mount",
						dir: "up",
						kind: "advance",
						to: "mount",
						as: "top",
						points: 4,
						grip: 0.55,
						gas: 0.08,
						telegraph: 42,
						counter: "kneeBlock",
						tell: "stepOver",
						hint: "Step the knee over the belly.",
					}),
					m({
						id: "kob",
						name: "Knee on belly",
						dir: "left",
						kind: "advance",
						to: "kneeOnBelly",
						as: "top",
						points: 2,
						grip: 0.4,
						gas: 0.06,
						telegraph: 34,
						counter: "frame",
						tell: "kneeUp",
						hint: "Pop up, knee on the belly.",
					}),
					m({
						id: "kimuraS",
						name: "Kimura",
						dir: "right",
						kind: "sub",
						to: "kimura",
						as: "top",
						points: 0,
						grip: 0.6,
						gas: 0.08,
						telegraph: 42,
						counter: "grabBelt",
						tell: "figureFour",
						escapeTo: { pos: "sideControl", as: "top" },
						hint: "Isolate the far arm in a figure four.",
					}),
				],
				counters: [
					c("crossfaceS", "Crossface", "up", "Turn their head away."),
					c(
						"hipPressure",
						"Hip pressure",
						"left",
						"Drop the hip on their knees.",
					),
				],
			},
			bottom: {
				label: "Under side control",
				moves: [
					m({
						id: "hipEscape",
						name: "Hip escape",
						dir: "up",
						kind: "escape",
						to: "halfGuard",
						as: "bottom",
						points: 0,
						grip: 0.3,
						gas: 0.06,
						telegraph: 34,
						counter: "crossfaceS",
						tell: "shrimp",
						hint: "Frame, shrimp, knee in.",
					}),
					m({
						id: "reguard",
						name: "Re-guard",
						dir: "left",
						kind: "escape",
						to: "closedGuard",
						as: "bottom",
						points: 0,
						grip: 0.45,
						gas: 0.08,
						telegraph: 40,
						counter: "hipPressure",
						tell: "legPummel",
						hint: "Pummel a leg back in front.",
					}),
				],
				counters: [
					c("kneeBlock", "Knee block", "up", "Knee up to block the step."),
					c("frame", "Frame", "left", "Forearm in the hip."),
					c(
						"grabBelt",
						"Grab the belt",
						"right",
						"Lock your hands, hide the arm.",
					),
				],
			},
		},
	},
	{
		id: "kneeOnBelly",
		name: "Knee on belly",
		kind: "position",
		roles: {
			top: {
				label: "Knee on belly",
				moves: [
					m({
						id: "kobMount",
						name: "Slide to mount",
						dir: "up",
						kind: "advance",
						to: "mount",
						as: "top",
						points: 4,
						grip: 0.5,
						gas: 0.07,
						telegraph: 38,
						counter: "pushKnee",
						tell: "stepOver",
						hint: "Slide the knee across into mount.",
					}),
					m({
						id: "armbarK",
						name: "Far-side armbar",
						dir: "right",
						kind: "sub",
						to: "armbar",
						as: "top",
						points: 0,
						grip: 0.6,
						gas: 0.08,
						telegraph: 42,
						counter: "elbowsIn",
						tell: "spinArm",
						escapeTo: { pos: "sideControl", as: "top" },
						hint: "Spin over the head onto the far arm.",
					}),
				],
				counters: [
					c("float", "Float", "up", "Ride the shrimp, stay light."),
					c("ride", "Ride the knee", "left", "Switch the knee, keep the pin."),
				],
			},
			bottom: {
				label: "Under knee on belly",
				moves: [
					m({
						id: "pushShrimp",
						name: "Push & shrimp",
						dir: "up",
						kind: "escape",
						to: "halfGuard",
						as: "bottom",
						points: 0,
						grip: 0.35,
						gas: 0.06,
						telegraph: 34,
						counter: "float",
						tell: "shrimp",
						hint: "Push the knee, shrimp out.",
					}),
					m({
						id: "turnInK",
						name: "Turn in",
						dir: "left",
						kind: "escape",
						to: "closedGuard",
						as: "bottom",
						points: 0,
						grip: 0.5,
						gas: 0.08,
						telegraph: 40,
						counter: "ride",
						tell: "legPummel",
						hint: "Turn into them and close the guard.",
					}),
				],
				counters: [
					c("pushKnee", "Push the knee", "up", "Both hands on the knee."),
					c(
						"elbowsIn",
						"Elbows in",
						"right",
						"Keep the elbows glued to the ribs.",
					),
				],
			},
		},
	},
	{
		id: "mount",
		name: "Mount",
		kind: "position",
		roles: {
			top: {
				label: "Mount",
				moves: [
					m({
						id: "armbarM",
						name: "Armbar",
						dir: "up",
						kind: "sub",
						to: "armbar",
						as: "top",
						points: 0,
						grip: 0.55,
						gas: 0.08,
						telegraph: 42,
						counter: "elbowsTight",
						tell: "spinArm",
						escapeTo: { pos: "closedGuard", as: "bottom" },
						hint: "Pin the arm, swing the leg over the head.",
					}),
					m({
						id: "takeBackM",
						name: "Take the back",
						dir: "right",
						kind: "advance",
						to: "back",
						as: "top",
						points: 4,
						grip: 0.5,
						gas: 0.08,
						telegraph: 40,
						counter: "stayFlat",
						tell: "sitHigh",
						hint: "When they turn, hooks in.",
					}),
				],
				counters: [
					c("basePost", "Post & base", "up", "Hands out wide, hips low."),
					c("grapevine", "Grapevine", "left", "Lace the legs, flatten them."),
				],
			},
			bottom: {
				label: "Mounted",
				moves: [
					m({
						id: "upa",
						name: "Upa bridge",
						dir: "up",
						kind: "reversal",
						to: "closedGuard",
						as: "top",
						points: 2,
						grip: 0.4,
						gas: 0.1,
						telegraph: 38,
						counter: "basePost",
						tell: "bridge",
						hint: "Trap the arm and foot, bridge and roll.",
					}),
					m({
						id: "elbowEsc",
						name: "Elbow escape",
						dir: "left",
						kind: "escape",
						to: "halfGuard",
						as: "bottom",
						points: 0,
						grip: 0.3,
						gas: 0.07,
						telegraph: 34,
						counter: "grapevine",
						tell: "shrimp",
						hint: "Elbow to knee, shrimp, recover a leg.",
					}),
				],
				counters: [
					c(
						"elbowsTight",
						"Elbows tight",
						"up",
						"Arms in, never push straight.",
					),
					c("stayFlat", "Stay flat", "right", "Do not give the back."),
				],
			},
		},
	},
	{
		id: "back",
		name: "Back control",
		kind: "position",
		roles: {
			top: {
				label: "Back control",
				moves: [
					m({
						id: "rnc",
						name: "Rear-naked choke",
						dir: "up",
						kind: "sub",
						to: "rnc",
						as: "top",
						points: 0,
						grip: 0.55,
						gas: 0.08,
						telegraph: 44,
						counter: "handFight",
						tell: "armUnder",
						escapeTo: { pos: "back", as: "top" },
						hint: "Slide the arm under the chin.",
					}),
					m({
						id: "armbarB",
						name: "Armbar",
						dir: "right",
						kind: "sub",
						to: "armbar",
						as: "top",
						points: 0,
						grip: 0.65,
						gas: 0.08,
						telegraph: 42,
						counter: "protectArm",
						tell: "spinArm",
						escapeTo: { pos: "closedGuard", as: "bottom" },
						hint: "Trap the arm and swing out to the side.",
					}),
				],
				counters: [
					c("hooksIn", "Hooks in", "up", "Keep both hooks, follow the turn."),
					c("seatBelt", "Seat belt", "left", "Tighten the over-under grip."),
				],
			},
			bottom: {
				label: "Back taken",
				moves: [
					m({
						id: "turnInB",
						name: "Turn into guard",
						dir: "up",
						kind: "escape",
						to: "closedGuard",
						as: "top",
						points: 0,
						grip: 0.45,
						gas: 0.08,
						telegraph: 42,
						counter: "hooksIn",
						tell: "turnIn",
						hint: "Clear a hook, turn into their guard.",
					}),
					m({
						id: "slideOut",
						name: "Slide out",
						dir: "left",
						kind: "escape",
						to: "sideControl",
						as: "bottom",
						points: 0,
						grip: 0.3,
						gas: 0.06,
						telegraph: 34,
						counter: "seatBelt",
						tell: "shoulderWalk",
						hint: "Walk the shoulders to the mat.",
					}),
				],
				counters: [
					c("handFight", "Hand fight", "up", "Two hands on the choking arm."),
					c("protectArm", "Protect the arm", "right", "Hide the elbow."),
				],
			},
		},
	},
	subState("armbar", "Armbar", ARM_ESCAPE),
	subState("triangle", "Triangle", { name: "Posture & angle", dir: "right" }),
	subState("kimura", "Kimura", { name: "Grab your belt", dir: "left" }),
	subState("rnc", "Rear-naked choke", { name: "Two-on-one", dir: "down" }),
];

function subState(
	id: PosId,
	name: string,
	esc: { name: string; dir: Dir },
): PositionDef {
	return {
		id,
		name,
		kind: "sub",
		escape: esc,
		roles: {
			top: { label: "Finishing", moves: [], counters: [] },
			bottom: { label: "Defending", moves: [], counters: [] },
		},
	};
}

export const POS_INDEX: Record<PosId, number> = Object.fromEntries(
	POSITIONS.map((p, i) => [p.id, i]),
) as Record<PosId, number>;

export const DIRS: Dir[] = ["up", "left", "down", "right"];
export const DIR_KEYS: Record<Dir, string> = {
	up: "W",
	left: "A",
	down: "S",
	right: "D",
};

/** Flat move table: every move gets a global index so the sim can store it as a number. */
export interface MoveRef {
	def: MoveDef;
	pos: number;
	role: Role;
}
export const MOVES: MoveRef[] = [];
for (let p = 0; p < POSITIONS.length; p++) {
	const pd = POSITIONS[p] as PositionDef;
	const roles: Role[] = pd.id === "standing" ? ["top"] : ["top", "bottom"];
	for (const r of roles)
		for (const def of pd.roles[r].moves) MOVES.push({ def, pos: p, role: r });
}

/** The move a role launches with a direction in a position, or -1. Standing: role ignored. */
export function moveIndex(pos: number, role: Role, dir: Dir): number {
	const standing = pos === POS_INDEX.standing;
	for (let i = 0; i < MOVES.length; i++) {
		const mr = MOVES[i] as MoveRef;
		if (mr.pos !== pos || mr.def.dir !== dir) continue;
		if (standing || mr.role === role) return i;
	}
	return -1;
}

/** Counter index (into the role's counters) for a direction, or -1. */
export function counterIndex(pos: number, role: Role, dir: Dir): number {
	const list = (POSITIONS[pos] as PositionDef).roles[role].counters;
	for (let i = 0; i < list.length; i++)
		if ((list[i] as CounterDef).dir === dir) return i;
	return -1;
}

/** Index of the counter that beats move `mi`, within the defender's counter list. */
export function correctCounter(mi: number): number {
	const mr = MOVES[mi] as MoveRef;
	const pd = POSITIONS[mr.pos] as PositionDef;
	const defRole: Role =
		pd.id === "standing" ? "top" : mr.role === "top" ? "bottom" : "top";
	return pd.roles[defRole].counters.findIndex((x) => x.id === mr.def.counter);
}

export const SUB_POSITIONS = new Set<PosId>([
	"armbar",
	"triangle",
	"kimura",
	"rnc",
]);

/** The lowest grip any move of a role asks for, per position (precomputed: no per-frame work). */
const MIN_GRIP: number[] = [];
for (let p = 0; p < POSITIONS.length; p++)
	for (const r of ["top", "bottom"] as Role[]) {
		const moves = (POSITIONS[p] as PositionDef).roles[r].moves;
		let m = moves.length ? 1 : 0;
		for (const mv of moves) m = Math.min(m, mv.grip);
		MIN_GRIP[p * 2 + (r === "top" ? 0 : 1)] = m;
	}
export function minGrip(pos: number, role: Role): number {
	return MIN_GRIP[pos * 2 + (role === "top" ? 0 : 1)] ?? 0;
}
