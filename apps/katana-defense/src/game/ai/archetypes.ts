/** Zombie archetypes, parsed from `src/data/archetypes.json`. */
export interface Archetype {
	index: number;
	id: string;
	hp: number;
	speed: number;
	radius: number;
	height: number;
	scale: number;
	reach: number;
	/** Strike arc, radians. */
	arc: number;
	windup: number;
	strike: number;
	recover: number;
	cooldown: number;
	damage: number;
	objDamage: number;
	aggro: number;
	poise: number;
	mass: number;
	score: number;
	slam: boolean;
	color: string;
}

type RawArchetype = Omit<Archetype, "index" | "id">;

export function parseArchetypes(raw: Record<string, unknown>): Archetype[] {
	const out: Archetype[] = [];
	for (const [id, v] of Object.entries(raw)) {
		if (id.startsWith("_")) continue;
		const a = v as RawArchetype;
		if (!(a.hp > 0 && a.speed > 0 && a.radius > 0))
			throw new Error(`archetypes: ${id} needs positive hp, speed, radius`);
		out.push({ ...a, arc: (a.arc * Math.PI) / 180, index: out.length, id });
	}
	return out;
}

export function archetypeIndex(list: Archetype[], id: string): number {
	const i = list.findIndex((a) => a.id === id);
	if (i < 0) throw new Error(`unknown archetype "${id}"`);
	return i;
}
