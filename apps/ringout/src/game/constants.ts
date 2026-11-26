/** Fixed simulation rate. Every rule below is expressed in ticks of 1/60 s. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const MAX_PLAYERS = 4;
export const GRAVITY = -18;

/** Orbs: heavy rolling spheres driven by torque, nudged by impulses. */
export const ORB = {
	radius: 0.62,
	mass: 10,
	friction: 0.9,
	restitution: 0.55,
	linearDamping: 0.08,
	angularDamping: 0.12,
	/** Torque impulse per tick at full stick (N·m·s), about the rolling axis. */
	torque: 0.9,
	/** Linear impulse per tick at full stick (N·s), for crisp steering. */
	push: 1.5,
	/** Above this ground speed along the stick, drive stops adding speed (m/s). */
	vmax: 7.5,
	/** Dash impulse (N·s): a burst of about 6 m/s on a 10 kg orb. */
	dash: 85,
	dashCooldown: 72,
	/** A hard hit staggers the victim: ticks of reduced drive per m/s of closing speed. */
	stunPerSpeed: 7,
	stunMax: 70,
	/** Drive kept while staggered. */
	stunControl: 0.15,
	/** Fraction of drive kept while airborne. */
	airControl: 0.2,
	/** Below this height an orb is out of the ring. */
	outY: -3,
} as const;

/** Hex tiles: flat-topped basalt columns, kinematic, top face at y = 0. */
export const TILE = {
	/** Circumradius of a hex (m). Centre spacing is sqrt(3) * this. */
	radius: 1.0,
	/** Collider slab thickness (m). */
	height: 0.7,
	friction: 0.85,
	restitution: 0.2,
} as const;

/** Rings 0..RINGS-1 (0 is the centre tile). 5 rings = 61 tiles. */
export const RINGS = 5;

export const COUNTDOWN_TICKS = 180;
/** Ticks the round lingers after the last ring-out before it is over. */
export const LINGER_TICKS = 100;

/** The arena collapses ring by ring from the outside in. */
export const COLLAPSE = {
	/** Fight tick of the first ring's drop. */
	first: 420,
	/** Ticks between ring drops. */
	every: 360,
	/** Warning (shake + glow) before a ring drops. */
	warn: 150,
	/** A ring's tiles drop over this many ticks, in a seeded order. */
	spread: 50,
	/** A falling tile is parked far below after this many ticks. */
	fallTicks: 150,
	/** Gentle jitter amplitude of warned tiles (m). */
	shake: 0.025,
} as const;

/** The whole arena turns slowly; each collapsed ring speeds it up. */
export const SPIN = {
	base: 0.09,
	perRing: 0.05,
	/** rad/s per tick of spin-up while changing speed. */
	ramp: 0.0015,
} as const;

/** A fight tick limit: after it the round is a draw (the arena is gone by then anyway). */
export const MAX_FIGHT_TICKS =
	COLLAPSE.first + COLLAPSE.every * RINGS + COLLAPSE.fallTicks;

/** Credit for a ring-out goes to the last orb that hit the victim within this window. */
export const KO_WINDOW = 240;
