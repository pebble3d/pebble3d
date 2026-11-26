import { COURSES } from "../src/game/courses.ts";
import { Track } from "../src/game/track.ts";

for (const c of COURSES) {
	if (process.argv[2] && c.id !== process.argv[2]) continue;
	const t = new Track(c.track);
	let last = -1;
	const out: string[] = [];
	for (let i = 0; i < t.n; i++)
		if (t.segOf[i] !== last) {
			last = t.segOf[i] as number;
			out.push(`s${last}@${i}`);
		}
	console.log(
		c.id,
		out.join(" "),
		"sweepers",
		t.sweepers.map((s) => s.i),
		"cps",
		t.checkpoints,
		"finish",
		t.finish,
	);
}
