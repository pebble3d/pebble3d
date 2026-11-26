/** Fixed sim tick. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const GRAVITY = -9.81;

/** The countdown before GO (ticks): 3, 2, 1 beeps at 0, 60, 120. */
export const COUNTDOWN_TICKS = 180;
/** A race is abandoned after this long (s) so a log can never grow without bound. */
export const MAX_RACE_TICKS = COUNTDOWN_TICKS + 60 * 240;

export const DRONE_MASS = 0.8;
/** Collision sphere radius (m); the frame's motor-to-motor span is about 0.34 m. */
export const DRONE_RADIUS = 0.17;

export type FlightMode = "assisted" | "acro";

/** Flight tunables (SI units). Part of the ghost fingerprint: change one and old ghosts expire. */
export const TUNE = {
	/** Thrust-to-weight at full throttle. */
	twr: 3.1,
	/** Linear damping on the body (1/s) plus quadratic drag (1/m). */
	linearDamping: 0.3,
	quadDrag: 0.042,
	/** Assisted: max tilt as tan(angle) (about 34 degrees), climb rate at full stick (m/s). */
	assistTilt: 0.68,
	climbRate: 3.6,
	/** Assisted: vertical speed loop gain (1/s). */
	climbGain: 5,
	/** Assisted: attitude P gain (rad/s per rad of tilt error) and yaw rate (rad/s). */
	attitudeGain: 11,
	assistYaw: 3.0,
	/** Assisted: horizontal brake (tilt per m/s) when the right stick is centred. */
	brake: 0.07,
	/** Acro: full-stick body rates (rad/s). */
	acroRate: 7.5,
	acroYaw: 4.5,
	/** Rate loop: fraction of the body-rate error removed per tick. */
	rateLoop: 0.45,
	/** Unexplained velocity change in one tick (m/s) that counts as a crash, and as a bump. */
	crashDv: 4.6,
	bumpDv: 1.0,
	/** Ticks upside down on the floor before the run is called a crash. */
	flipTicks: 45,
	/** Ticks of "signal lost" after a crash, then auto-hover ticks after the respawn. */
	crashTicks: 54,
	hoverTicks: 36,
} as const;
