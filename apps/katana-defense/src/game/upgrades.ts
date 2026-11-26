/** Between-wave upgrades: data plus a pure `applyUpgrade` over the run modifiers. */

export interface Mods {
	damage: number;
	dodgeCooldown: number;
	lifesteal: number;
	arc: number;
	shockwave: boolean;
	focusGain: number;
	maxHp: number;
}

export function defaultMods(): Mods {
	return {
		damage: 1,
		dodgeCooldown: 1,
		lifesteal: 0,
		arc: 1,
		shockwave: false,
		focusGain: 1,
		maxHp: 100,
	};
}

export interface UpgradeDef {
	id: string;
	name: string;
	desc: string;
	/** How many times it can be taken. */
	max: number;
}

export const UPGRADES: readonly UpgradeDef[] = [
	{
		id: "edge",
		name: "Honed Edge",
		desc: "+15% damage on every strike",
		max: 3,
	},
	{ id: "step", name: "Wind Step", desc: "Dodge cooldown -20%", max: 2 },
	{
		id: "oath",
		name: "Second Wind",
		desc: "Finishers restore 3 HP per enemy struck",
		max: 2,
	},
	{
		id: "arc",
		name: "Wide Arc",
		desc: "+20% reach and sweep on slashes",
		max: 2,
	},
	{
		id: "quake",
		name: "Aftershock",
		desc: "Heavy strikes release a ground shockwave",
		max: 1,
	},
	{
		id: "focus",
		name: "Deep Focus",
		desc: "+35% Focus gained per hit",
		max: 2,
	},
	{
		id: "vigor",
		name: "Iron Body",
		desc: "+25 max HP and a full heal",
		max: 2,
	},
	{
		id: "ward",
		name: "Mend the Gate",
		desc: "Restore 30% of the gate's integrity",
		max: 3,
	},
];

/** Effects that touch more than the mods (healing) are returned as flags for the sim. */
export interface UpgradeSideEffects {
	healPlayer: boolean;
	repairGate: number;
}

export function applyUpgrade(
	mods: Mods,
	id: string,
	out: UpgradeSideEffects,
): void {
	out.healPlayer = false;
	out.repairGate = 0;
	switch (id) {
		case "edge":
			mods.damage *= 1.15;
			break;
		case "step":
			mods.dodgeCooldown *= 0.8;
			break;
		case "oath":
			mods.lifesteal += 3;
			break;
		case "arc":
			mods.arc *= 1.2;
			break;
		case "quake":
			mods.shockwave = true;
			break;
		case "focus":
			mods.focusGain *= 1.35;
			break;
		case "vigor":
			mods.maxHp += 25;
			out.healPlayer = true;
			break;
		case "ward":
			out.repairGate = 0.3;
			break;
		default:
			throw new Error(`unknown upgrade "${id}"`);
	}
}
