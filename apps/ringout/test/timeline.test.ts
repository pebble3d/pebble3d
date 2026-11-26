import { it } from "vitest";
import { COUNTDOWN_TICKS, DT } from "../src/game/constants.ts";
import { EV } from "../src/game/events.ts";
import { Match } from "../src/game/match.ts";
import { physicsHost } from "./helpers.ts";
import { playBotRound } from "./play.ts";

/** Frame timeline of the `?demo=1` match (seed 1, best of 3), for choosing capture ticks. */
it.skipIf(!process.env.EXPLORE)("timeline", async () => {
	const host = await physicsHost();
	const m = new Match({
		slots: ["bot", "bot", "bot", "bot"],
		toWin: 2,
		seed: Number(process.env.SEED ?? 1),
	});
	let frame = 0;
	while (m.champion() < 0) {
		const f0 = frame;
		const notes: string[] = [];
		const { rec, sim } = playBotRound(
			host,
			m.nextSeed(),
			undefined,
			6000,
			(s) => {
				const e = s.events;
				for (let k = 0; k < e.length; k++) {
					if (e.type[k] === EV.IMPACT && (e.v[k] as number) > 7)
						notes.push(`hit${(e.v[k] as number).toFixed(0)}@${f0 + s.tick}`);
					if (e.type[k] === EV.DROP) notes.push(`drop@${f0 + s.tick}`);
					if (e.type[k] === EV.WARN) notes.push(`warn@${f0 + s.tick}`);
				}
			},
		);
		console.log("  ", notes.join(" "));
		sim.free();
		console.log(
			`round ${m.round + 1}: frames ${frame + 1}-${frame + rec.ticks} GO@${frame + COUNTDOWN_TICKS} outs ${rec.outTicks.map((t) => frame + t)} winner ${rec.winner}`,
		);
		frame += rec.ticks;
		m.add({ ...rec, index: m.round });
		// replay pacing as in app.ts
		let t = COUNTDOWN_TICKS - 30;
		let acc = 0;
		const start = frame;
		const sp = (t: number) => {
			for (const o of rec.outTicks) if (t >= o - 50 && t <= o + 30) return 0.4;
			return t > rec.ticks - 40 ? 1 : 4;
		};
		const marks: string[] = [];
		while (t < rec.ticks) {
			frame++;
			acc += DT * sp(t);
			let n = 0;
			while (acc >= DT - 1e-9 && n < 6) {
				acc -= DT;
				t++;
				n++;
				if (rec.outTicks.includes(t)) marks.push(`out@${frame}`);
			}
		}
		console.log(
			`  replay frames ${start + 1}-${frame} ${marks.join(" ")} verdict hold to ${frame + 132}`,
		);
		frame += 133;
	}
	console.log("results from frame", frame);
});
