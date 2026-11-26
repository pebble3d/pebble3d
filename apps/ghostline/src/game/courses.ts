import lacquer from "../../courses/lacquer.json" with { type: "json" };
import sunfold from "../../courses/sunfold.json" with { type: "json" };
import undertow from "../../courses/undertow.json" with { type: "json" };
import type { BotTune } from "./bot.ts";
import { type CourseFile, parseCourse } from "./course.ts";

export type Course = CourseFile & { bot?: BotTune };

/** The shipped courses, in menu order. */
export const COURSES: Course[] = [sunfold, lacquer, undertow].map(
	(c) => parseCourse(c) as Course,
);

export function courseById(id: string): Course {
	const c = COURSES.find((k) => k.id === id);
	if (!c) throw new Error(`unknown course "${id}"`);
	return c;
}
