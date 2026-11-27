/**
 * Drives the game's rig through every keyed situation a roll can show: each position's pose,
 * each move's telegraph at full lean, and every transition blend sampled at t = 0.25, 0.5 and
 * 0.75 (including submission escapes). Returns the worst contact problems found.
 */
import { MOVES, type MoveRef, POS_INDEX } from "../src/game/graph.ts";
import { ACT, MatchSim, PHASE } from "../src/game/sim.ts";
import {
	belowFloor,
	penetrations,
	TOL_HAND,
	TOL_LIMB,
} from "../src/game/view/body.ts";
import { Rig, transitionSeconds } from "../src/game/view/rig.ts";

export interface Problem {
	where: string;
	what: string;
	depth: number;
}

const TORSO = new Set(["pelvis", "spine", "shoulders", "head"]);
const EPS = 0.004;

function check(r: Rig, where: string, out: Problem[]): void {
	for (const h of penetrations(r.sol[0], r.sol[1], 0)) {
		const hand = h.a.startsWith("hand") || h.b.startsWith("hand");
		const torso = TORSO.has(h.a) && TORSO.has(h.b);
		const tol = torso ? 0.01 : hand ? TOL_HAND : TOL_LIMB;
		if (h.depth > tol + EPS)
			out.push({ where, what: `${h.a}/${h.b}`, depth: h.depth });
	}
	for (const p of [0, 1]) {
		const s = r.sol[p as 0 | 1];
		for (const name of belowFloor(s, TOL_LIMB + EPS))
			out.push({ where, what: `${p}:${name} in mat`, depth: 0 });
	}
}

function liveSim(pos: number, top: number): MatchSim {
	const s = new MatchSim({ seed: 1, introTicks: 1 });
	s.step(0, 0);
	s.step(0, 0);
	s.pos = pos;
	s.top = top;
	s.transTick = -100;
	return s;
}

function settle(r: Rig, s: MatchSim, secs = 1.5): void {
	for (let t = 0; t < secs; t += 1 / 30) r.update(s, 1 / 30);
}

export function contactProblems(): Problem[] {
	const out: Problem[] = [];
	// the bow before the roll (the sim is still in its intro phase)
	const intro = new Rig();
	settle(intro, new MatchSim({ seed: 1 }));
	check(intro, "intro pose", out);
	for (let mi = 0; mi < MOVES.length; mi++) {
		const mr = MOVES[mi] as MoveRef;
		const def = mr.def;
		// the attacker is player 0; standing has player 0 on the -x side ("top")
		const top0 = mr.role === "top" ? 0 : 1;
		for (const attacker of mr.pos === POS_INDEX.standing ? [0, 1] : [0]) {
			const s = liveSim(mr.pos, mr.pos === POS_INDEX.standing ? 0 : top0);
			const r = new Rig();
			settle(r, s);
			check(r, `${def.id} pose`, out);
			// telegraph at full lean (window open)
			s.act = ACT.WINDOW;
			s.actor = attacker;
			s.move = mi;
			s.actT = 1;
			s.telDur = def.telegraph;
			settle(r, s, 0.6);
			check(r, `${def.id} telegraph${attacker ? " (mirrored)" : ""}`, out);
			if (attacker) continue;
			// the move lands: blend into the target
			s.act = ACT.IDLE;
			s.actor = -1;
			s.move = -1;
			s.lastMove = mi;
			s.pos = POS_INDEX[def.to];
			s.top = def.kind === "sub" || def.as === "top" ? 0 : 1;
			s.transTick = 1000 + mi;
			blendSamples(r, s, transitionSeconds(mi), `${def.id} blend`, out);
			// submissions: the escape blend back out
			if (def.escapeTo) {
				s.pos = POS_INDEX[def.escapeTo.pos];
				s.top = def.escapeTo.as === "top" ? 0 : 1;
				s.transTick = 2000 + mi;
				blendSamples(
					r,
					s,
					transitionSeconds(mi),
					`${def.id} escape blend`,
					out,
				);
			}
		}
	}
	return out;
}

function blendSamples(
	r: Rig,
	s: MatchSim,
	secs: number,
	where: string,
	out: Problem[],
): void {
	const dt = secs * 0.25;
	r.update(s, dt); // t = 0 (snapshot)
	for (const t of [0.25, 0.5, 0.75]) {
		r.update(s, dt);
		check(r, `${where} t=${t}`, out);
	}
	settle(r, s, 1);
	check(r, `${where} settled`, out);
	void PHASE;
}
