import type { Game } from "@pebble3d/sdk/game";
import { parseScene } from "@pebble3d/sdk/schema";
import type { Keep, Layout } from "../gen/generate.ts";
import { type Grid, rasterize } from "../gen/grid.ts";

/** What the sim needs from a game: `createGame`'s result in the browser, or the same three built in Node. */
export type SimHost = Pick<Game, "sim" | "views" | "ids">;

export const DT = 1 / 60;
export const PHASE = { TITLE: 0, PLAY: 1, CAUGHT: 2, ESCAPED: 3 } as const;
export const PHASE_NAMES = ["title", "play", "caught", "escaped"] as const;
export const BTN = { START: 1, SPRINT: 2 } as const;
export const GUARD = {
	PATROL: 0,
	SUSPICIOUS: 1,
	ALERT: 2,
	SEARCH: 3,
	RETURN: 4,
} as const;
export const GUARD_NAMES = [
	"patrol",
	"suspicious",
	"alert",
	"search",
	"return",
] as const;
export const EV = {
	START: 1,
	SPOT: 2,
	ALERT: 3,
	LOST: 4,
	LOOT: 5,
	RELIC: 6,
	CAUGHT: 7,
	ESCAPED: 8,
	RETRY: 9,
} as const;

/** One tick of player intent: a quantised move axis (-127..127, screen up = -z) and buttons. */
export interface TickInput {
	mx: number;
	mz: number;
	buttons: number;
}

export const emptyInput = (): TickInput => ({ mx: 0, mz: 0, buttons: 0 });

/** Perception and movement tuning. */
export const TUNE = {
	/** Half-angle of the guards' view cone. */
	coneHalf: (52 * Math.PI) / 180,
	/** Sight range against a target in full darkness, and the extra range at full light. */
	rangeDark: 2.4,
	rangeLit: 8,
	/** Extra sight range while the player sprints, and the radius sprint footsteps carry. */
	sprintRange: 1.5,
	noiseRadius: 7,
	/** Alerted guards keep sight of the player out to here regardless of light. */
	alertRange: 6.5,
	/** An alarmed guard that has not seen the thief for this long starts searching. */
	loseTicks: 120,
	/** Ticks an alarmed guard stands pointing before the chase. */
	startle: 45,
	/** Anything this close is felt, whatever the facing. */
	feel: 1.4,
	catchDist: 0.95,
	suspiciousAt: 0.3,
	/** Guards within this radius of an alerted guard join the hunt. */
	shoutRadius: 12,
	eyeY: 1.5,
	chestY: 1.05,
	headY: 1.45,
	moonlight: 0.06,
	guardLanternRadius: 3.2,
	guardLanternGain: 0.55,
	pickup: 0.85,
	relicPickup: 1.3,
	turnRate: 5,
} as const;

const PATH_MAX = 4096;
const RAY_STATIC = 1;

export class GuardState {
	x = 0;
	z = 0;
	yaw = 0;
	state: number = GUARD.PATROL;
	suspicion = 0;
	/** Ticks since an alarmed guard last saw the thief. */
	unseen = 0;
	/** Can see the player this tick. */
	sees = false;
	node = 0;
	pause = 0;
	scanBase = 0;
	scanT = 0;
	timer = 0;
	lastX = 0;
	lastZ = 0;
	/** Movement intent sent to the engine this tick (world XZ, length <= 1). */
	mx = 0;
	mz = 0;
	sprint = false;
	readonly path = new Int32Array(PATH_MAX);
	pathLen = 0;
	pathIdx = 0;
	pathTX = Number.NaN;
	pathTZ = Number.NaN;
	repath = 0;
	stuckX = 0;
	stuckZ = 0;
	stuckT = 0;
	constructor(
		readonly simId: number,
		readonly slot: number,
		readonly route: Float64Array,
	) {}
	get nodes(): number {
		return this.route.length / 3;
	}
}

/**
 * Lanternfall rules, advanced once per engine tick after `world.step`. The player and the
 * guards are engine characters (kinematic capsules with `accel`); the sim only writes their
 * movement intent with `setCharacterInput`. Guards perceive the player through static-only
 * raycasts inside a view cone whose reach scales with the light at the player's position.
 * No DOM, no Math.random, no Date, no allocation per tick.
 */
export class LanternSim {
	readonly layout: Layout;
	readonly grid: Grid;
	/** Static light per grid tile (lanterns and braziers with line of sight, plus moonlight). */
	readonly light: Float32Array;
	/** Tiles reachable on foot from the spawn (1) or not (0). */
	readonly reach: Uint8Array;
	readonly guards: GuardState[] = [];
	readonly playerId: number;
	private readonly playerSlot: number;
	tick = 0;
	phase: number = PHASE.TITLE;
	phaseT = 0;
	playT = 0;
	px = 0;
	pz = 0;
	pvx = 0;
	pvz = 0;
	playerLight = 0;
	sprinting = false;
	hasRelic = false;
	lootMask = 0;
	lootCount = 0;
	alerts = 0;
	spotted = 0;
	runs = 0;
	score = 0;
	/** Highest suspicion of any guard (HUD). */
	danger = 0;
	private prevButtons = 0;
	/** Running this tick (louder, and a little easier to see). */
	private loud = false;
	/** The player's movement intent from the last tick (re-sent every frame by `assertInput`). */
	private intentX = 0;
	private intentZ = 0;
	private lightReady = false;
	private anyAlert = false;
	// Event ring for the presentation (audio, HUD flashes): cleared at the start of each tick.
	readonly evType = new Int32Array(32);
	readonly evArg = new Int32Array(32);
	evCount = 0;

	constructor(
		private readonly host: SimHost,
		keep: Keep,
	) {
		this.layout = keep.layout;
		this.grid = rasterize(parseScene(keep.scene));
		this.light = new Float32Array(this.grid.size);
		this.reach = new Uint8Array(this.grid.size);
		this.grid.flood(
			this.grid.nearestWalkable(this.layout.spawn[0], this.layout.spawn[1]),
			this.reach,
		);
		const pid = host.ids.get("player");
		if (pid === undefined) throw new Error('scene has no "player"');
		this.playerId = pid;
		this.playerSlot = host.sim.world.slotOf(pid);
		for (const g of this.layout.guards) {
			const id = host.ids.get(g.id);
			if (id === undefined) throw new Error(`scene has no "${g.id}"`);
			const gs = new GuardState(
				id,
				host.sim.world.slotOf(id),
				Float64Array.from(g.route),
			);
			this.guards.push(gs);
		}
		this.resetActors();
	}

	/** Engine-independent extras folded into a hash with the world's. */
	hash(): string {
		let h = 2166136261;
		const mix = (v: number): void => {
			h = Math.imul(h ^ (v | 0), 16777619);
		};
		mix(this.tick);
		mix(this.phase);
		mix(this.lootMask);
		mix(this.alerts);
		mix(this.hasRelic ? 1 : 0);
		for (const g of this.guards) {
			mix(g.state);
			mix(Math.round(g.suspicion * 1000));
			mix(Math.round(g.yaw * 1000));
		}
		return `${this.host.sim.world.stateHash()}:${(h >>> 0).toString(16)}`;
	}

	private emit(type: number, arg = 0): void {
		if (this.evCount >= this.evType.length) return;
		this.evType[this.evCount] = type;
		this.evArg[this.evCount] = arg;
		this.evCount++;
	}

	/** Static light at a world point (bilinear-free: the tile's value). */
	lightAt(x: number, z: number): number {
		const t = this.grid.index(x, z);
		return t < 0 ? TUNE.moonlight : (this.light[t] as number);
	}

	private bakeLight(): void {
		const world = this.host.sim.world;
		const sc = this.host.views.scratch;
		const g = this.grid;
		this.light.fill(TUNE.moonlight);
		for (const l of this.layout.lanterns) {
			const r = l.radius;
			const gain = l.kind === "relic" ? 0.7 : 1.1;
			const i0 = g.index(l.x - r, l.z - r);
			const i1 = g.index(l.x + r, l.z + r);
			const a0 = i0 < 0 ? 0 : i0 % g.w;
			const b0 = i0 < 0 ? 0 : Math.floor(i0 / g.w);
			const a1 = i1 < 0 ? g.w - 1 : i1 % g.w;
			const b1 = i1 < 0 ? g.h - 1 : Math.floor(i1 / g.w);
			for (let b = b0; b <= b1; b++)
				for (let a = a0; a <= a1; a++) {
					const t = b * g.w + a;
					if (g.blocked[t] !== 0) continue;
					const tx = g.cx(t);
					const tz = g.cz(t);
					const d = Math.hypot(tx - l.x, tz - l.z);
					if (d >= r) continue;
					const dx = tx - l.x;
					const dy = TUNE.chestY - l.y;
					const dz = tz - l.z;
					const len = Math.hypot(dx, dy, dz);
					if (
						world.raycast(l.x, l.y, l.z, dx, dy, dz, len, RAY_STATIC, 0) &&
						(sc[0] as number) < len - 0.1
					)
						continue;
					const f = 1 - d / r;
					this.light[t] = Math.min(
						1,
						(this.light[t] as number) + gain * f * Math.sqrt(f),
					);
				}
		}
		this.lightReady = true;
	}

	/** Put the player and guards back at their starts (title and every retry). */
	private resetActors(): void {
		const world = this.host.sim.world;
		const [sx, sz] = this.layout.spawn;
		world.teleport(this.playerId, sx, 0.8, sz);
		world.setCharacterInput(this.playerId, 0, 0, false, false);
		this.intentX = 0;
		this.intentZ = 0;
		this.px = sx;
		this.pz = sz;
		for (const g of this.guards) {
			g.x = g.route[0] as number;
			g.z = g.route[1] as number;
			world.teleport(g.simId, g.x, 0.8, g.z);
			g.state = GUARD.PATROL;
			g.suspicion = 0;
			g.sees = false;
			g.node = g.nodes > 1 ? 1 : 0;
			g.pause = 0;
			g.timer = 0;
			g.pathLen = 0;
			g.pathIdx = 0;
			g.pathTX = Number.NaN;
			g.pathTZ = Number.NaN;
			g.repath = 0;
			g.stuckT = 0;
			g.stuckX = g.x;
			g.stuckZ = g.z;
			g.scanT = 0;
			g.lastX = g.x;
			g.lastZ = g.z;
			g.unseen = 0;
			const nx = g.route[g.nodes > 1 ? 3 : 0] as number;
			const nz = g.route[g.nodes > 1 ? 4 : 1] as number;
			g.yaw = Math.atan2(nx - g.x, nz - g.z) || 0;
			g.scanBase = g.yaw;
			g.mx = 0;
			g.mz = 0;
		}
		this.hasRelic = false;
		this.lootMask = 0;
		this.lootCount = 0;
		this.alerts = 0;
		this.spotted = 0;
		this.playT = 0;
		this.anyAlert = false;
		this.loud = false;
		this.danger = 0;
	}

	step(input: TickInput): void {
		this.tick++;
		this.phaseT++;
		this.evCount = 0;
		if (!this.lightReady) this.bakeLight();
		const views = this.host.views;
		const world0 = this.host.sim.world;
		const o = this.playerSlot * 8;
		const npx = views.curr[o] as number;
		const npz = views.curr[o + 2] as number;
		// Velocity from the controller (a frame may run several ticks on one state buffer).
		if (world0.characterState(this.playerId)) {
			const sc = views.scratch;
			this.pvx = sc[9] as number;
			this.pvz = sc[10] as number;
		}
		this.px = npx;
		this.pz = npz;
		const pressed = input.buttons & ~this.prevButtons;
		this.prevButtons = input.buttons;

		for (const g of this.guards) {
			const go = g.slot * 8;
			g.x = views.curr[go] as number;
			g.z = views.curr[go + 2] as number;
		}

		switch (this.phase) {
			case PHASE.TITLE:
				if (pressed & BTN.START && this.phaseT > 20) {
					this.resetActors(); // every run starts from the same positions
					this.setPhase(PHASE.PLAY);
					this.emit(EV.START);
				}
				break;
			case PHASE.PLAY:
				this.playT++;
				this.playRules(input);
				break;
			default:
				if (pressed & BTN.START && this.phaseT > 45) {
					this.resetActors();
					this.runs++;
					this.setPhase(PHASE.PLAY);
					this.emit(EV.RETRY);
				}
		}

		const play = this.phase === PHASE.PLAY;
		const world = this.host.sim.world;
		// Guards patrol on the title screen too (a living backdrop), and freeze at the end.
		const guardsMove = play || this.phase === PHASE.TITLE;
		for (const g of this.guards) {
			if (!guardsMove) {
				g.mx = 0;
				g.mz = 0;
				g.sprint = false;
			} else this.moveGuard(g, play);
			world.setCharacterInput(g.simId, g.mx, g.mz, false, g.sprint);
		}
		let mx = 0;
		let mz = 0;
		this.sprinting = false;
		if (play) {
			mx = input.mx / 127;
			mz = input.mz / 127;
			const len = Math.hypot(mx, mz);
			if (len > 1) {
				mx /= len;
				mz /= len;
			}
			this.sprinting = (input.buttons & BTN.SPRINT) !== 0 && len > 0.2;
		}
		this.intentX = mx;
		this.intentZ = mz;
		world.setCharacterInput(this.playerId, mx, mz, false, this.sprinting);
	}

	/**
	 * Re-send this sim's movement intents to the engine. createGame's player rig writes its own
	 * keyboard input every frame, including frames that advance 0 ticks (any display above
	 * 60 Hz); call this after the frame's ticks so the next world.step always uses the sim's
	 * intent: the demo bot's moves, and no movement on the title or results.
	 */
	assertInput(): void {
		const world = this.host.sim.world;
		world.setCharacterInput(
			this.playerId,
			this.intentX,
			this.intentZ,
			false,
			this.sprinting,
		);
		for (const g of this.guards)
			world.setCharacterInput(g.simId, g.mx, g.mz, false, g.sprint);
	}

	/** Skip the title (the `?start=1` capture path): straight into play. */
	begin(): void {
		if (this.phase !== PHASE.TITLE) return;
		this.setPhase(PHASE.PLAY);
		this.emit(EV.START);
	}

	private setPhase(p: number): void {
		this.phase = p;
		this.phaseT = 0;
	}

	private playRules(input: TickInput): void {
		const L = this.layout;
		const px = this.px;
		const pz = this.pz;
		// Light on the player: the baked pools plus the guards' own hand lanterns.
		let light = this.lightAt(px, pz);
		for (const g of this.guards) {
			const d = Math.hypot(g.x - px, g.z - pz);
			if (d < TUNE.guardLanternRadius)
				light += TUNE.guardLanternGain * (1 - d / TUNE.guardLanternRadius);
		}
		this.playerLight = Math.min(1, light);

		// Loot and relic.
		for (let k = 0; k < L.loot.length; k++) {
			if (this.lootMask & (1 << k)) continue;
			const [lx, lz] = L.loot[k] as [number, number];
			if (Math.hypot(lx - px, lz - pz) < TUNE.pickup) {
				this.lootMask |= 1 << k;
				this.lootCount++;
				this.emit(EV.LOOT, k);
			}
		}
		if (
			!this.hasRelic &&
			Math.hypot(L.relic[0] - px, L.relic[1] - pz) < TUNE.relicPickup
		) {
			this.hasRelic = true;
			this.emit(EV.RELIC);
		}
		if (this.hasRelic && pz > L.exitZ) {
			this.finish(PHASE.ESCAPED);
			this.emit(EV.ESCAPED);
			return;
		}

		// Perception.
		const sprint =
			(input.buttons & BTN.SPRINT) !== 0 &&
			Math.hypot(this.pvx, this.pvz) > 3.2;
		let danger = 0;
		let alertNow = false;
		for (let i = 0; i < this.guards.length; i++) {
			const g = this.guards[i] as GuardState;
			this.perceive(g, i, sprint);
			if (g.state === GUARD.ALERT) alertNow = true;
			if (g.suspicion > danger) danger = g.suspicion;
			if (Math.hypot(g.x - px, g.z - pz) < TUNE.catchDist) {
				this.finish(PHASE.CAUGHT);
				this.emit(EV.CAUGHT, i);
				return;
			}
		}
		if (alertNow && !this.anyAlert) this.alerts++;
		this.anyAlert = alertNow;
		this.danger = danger;
	}

	private finish(phase: number): void {
		this.setPhase(phase);
		const secs = this.playT / 60;
		if (phase === PHASE.ESCAPED) {
			const timeBonus = Math.max(0, Math.round(600 - secs * 4));
			const ghost = this.alerts === 0 ? 500 : 0;
			this.score = Math.max(
				0,
				1000 + this.lootCount * 150 + timeBonus + ghost - this.alerts * 150,
			);
		} else this.score = this.lootCount * 50;
	}

	/** Seen this tick? Cone, light-scaled range and a static-only line-of-sight ray. */
	/** How far guard `g` can see the thief right now (light, running, alarm). The HUD cones use it. */
	sightRange(g: GuardState): number {
		const r =
			TUNE.rangeDark +
			TUNE.rangeLit * this.playerLight +
			(this.loud ? TUNE.sprintRange : 0);
		return g.state === GUARD.ALERT ? Math.max(r, TUNE.alertRange) : r;
	}

	private canSee(g: GuardState, sprint: boolean): number {
		const dx = this.px - g.x;
		const dz = this.pz - g.z;
		const d = Math.hypot(dx, dz);
		this.loud = sprint;
		const range = this.sightRange(g);
		if (d > range) return 0;
		if (d > TUNE.feel) {
			const c = (dx * Math.sin(g.yaw) + dz * Math.cos(g.yaw)) / d;
			if (c < Math.cos(TUNE.coneHalf)) return 0;
		}
		if (
			!this.clearSight(g.x, g.z, this.px, TUNE.chestY, this.pz) &&
			!this.clearSight(g.x, g.z, this.px, TUNE.headY, this.pz)
		)
			return 0;
		return 1 - d / range;
	}

	/** True when no static collider blocks the guard's eye -> (x, y, z). */
	clearSight(gx: number, gz: number, x: number, y: number, z: number): boolean {
		const dx = x - gx;
		const dy = y - TUNE.eyeY;
		const dz = z - gz;
		const len = Math.hypot(dx, dy, dz);
		if (len < 1e-3) return true;
		const hit = this.host.sim.world.raycast(
			gx,
			TUNE.eyeY,
			gz,
			dx,
			dy,
			dz,
			len,
			RAY_STATIC,
			0,
		);
		return !hit || (this.host.views.scratch[0] as number) >= len - 0.05;
	}

	private perceive(g: GuardState, index: number, sprint: boolean): void {
		const v = this.canSee(g, sprint);
		g.sees = v > 0;
		if (g.sees) {
			const rate = 0.15 + 1.6 * v * v + 0.35 * this.playerLight;
			const before = g.suspicion;
			g.suspicion = Math.min(1, g.suspicion + rate * DT);
			g.lastX = this.px;
			g.lastZ = this.pz;
			if (before < TUNE.suspiciousAt && g.suspicion >= TUNE.suspiciousAt)
				this.spotted++;
		} else if (g.state !== GUARD.ALERT) {
			g.suspicion = Math.max(0, g.suspicion - 0.12 * DT);
		}
		// Sprinting footsteps carry: nearby calm guards come to look.
		let heard = false;
		if (
			sprint &&
			g.state !== GUARD.ALERT &&
			Math.hypot(this.px - g.x, this.pz - g.z) < TUNE.noiseRadius
		) {
			g.lastX = this.px;
			g.lastZ = this.pz;
			if (g.suspicion < TUNE.suspiciousAt) g.suspicion = TUNE.suspiciousAt;
			heard = true;
		}
		if (g.suspicion >= 1 && g.state !== GUARD.ALERT) {
			this.enter(g, GUARD.ALERT);
			this.emit(EV.ALERT, index);
			for (const o of this.guards) {
				if (o === g || o.state === GUARD.ALERT) continue;
				if (Math.hypot(o.x - g.x, o.z - g.z) > TUNE.shoutRadius) continue;
				o.lastX = this.px;
				o.lastZ = this.pz;
				o.suspicion = Math.max(o.suspicion, 0.6);
				this.enter(o, GUARD.SUSPICIOUS);
			}
		} else if (
			(g.sees || heard) &&
			g.suspicion >= TUNE.suspiciousAt &&
			(g.state === GUARD.PATROL ||
				g.state === GUARD.RETURN ||
				g.state === GUARD.SEARCH)
		) {
			this.enter(g, GUARD.SUSPICIOUS);
			this.emit(EV.SPOT, index);
		}
	}

	private enter(g: GuardState, s: number): void {
		g.state = s;
		g.unseen = 0;
		g.timer = 0;
		g.pathLen = 0;
		g.scanBase = g.yaw;
		g.scanT = 0;
	}

	/** Guard movement for the next engine tick. `alive` = perception is on (play phase). */
	private moveGuard(g: GuardState, alive: boolean): void {
		g.timer++;
		g.mx = 0;
		g.mz = 0;
		g.sprint = false;
		let faceX = Number.NaN;
		let faceZ = 0;
		switch (alive ? g.state : GUARD.PATROL) {
			case GUARD.PATROL: {
				if (g.pause > 0) {
					g.pause--;
					this.scan(g, 0.9, 0.025);
					break;
				}
				const tx = g.route[g.node * 3] as number;
				const tz = g.route[g.node * 3 + 1] as number;
				if (Math.hypot(tx - g.x, tz - g.z) < 0.35) {
					g.pause = g.route[g.node * 3 + 2] as number;
					g.scanBase = g.yaw;
					g.scanT = 0;
					g.node = (g.node + 1) % g.nodes;
					break;
				}
				this.steer(g, tx, tz, 1, false);
				if (this.stuck(g)) g.node = (g.node + 1) % g.nodes;
				break;
			}
			case GUARD.SUSPICIOUS: {
				if (g.sees) {
					faceX = g.lastX;
					faceZ = g.lastZ;
				} else if (g.timer > 40) {
					if (this.goTo(g, g.lastX, g.lastZ, 0.8, false))
						this.enter(g, GUARD.SEARCH);
				} else {
					faceX = g.lastX;
					faceZ = g.lastZ;
				}
				if (g.suspicion <= 0) this.enter(g, GUARD.SEARCH);
				break;
			}
			case GUARD.ALERT: {
				// Startled: the '!' pops and the guard points before it gives chase (a head start).
				if (g.timer < TUNE.startle) {
					faceX = g.lastX;
					faceZ = g.lastZ;
					break;
				}
				if (g.sees) g.unseen = 0;
				else g.unseen++;
				if (
					(this.goTo(g, g.lastX, g.lastZ, 1, true) && !g.sees) ||
					g.unseen > TUNE.loseTicks
				) {
					g.suspicion = 0.7;
					this.enter(g, GUARD.SEARCH);
					this.emit(EV.LOST, this.guards.indexOf(g));
				}
				break;
			}
			case GUARD.SEARCH: {
				this.scan(g, 1.6, 0.04);
				if (g.timer > 200) {
					this.enter(g, GUARD.RETURN);
					g.node = this.nearestNode(g);
				}
				break;
			}
			case GUARD.RETURN: {
				const tx = g.route[g.node * 3] as number;
				const tz = g.route[g.node * 3 + 1] as number;
				if (this.goTo(g, tx, tz, 0.8, false)) this.enter(g, GUARD.PATROL);
				break;
			}
		}
		if (!Number.isNaN(faceX))
			this.turnTo(g, Math.atan2(faceX - g.x, faceZ - g.z));
	}

	private nearestNode(g: GuardState): number {
		let best = 0;
		let bestD = Number.POSITIVE_INFINITY;
		for (let k = 0; k < g.nodes; k++) {
			const d = Math.hypot(
				(g.route[k * 3] as number) - g.x,
				(g.route[k * 3 + 1] as number) - g.z,
			);
			if (d < bestD) {
				bestD = d;
				best = k;
			}
		}
		return best;
	}

	private scan(g: GuardState, amp: number, rate: number): void {
		g.scanT += rate;
		this.turnTo(g, g.scanBase + amp * Math.sin(g.scanT));
	}

	private turnTo(g: GuardState, yaw: number): void {
		let d = yaw - g.yaw;
		d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
		const max = TUNE.turnRate * DT;
		g.yaw += Math.max(-max, Math.min(max, d));
		g.yaw -= Math.round(g.yaw / (2 * Math.PI)) * 2 * Math.PI;
	}

	/** Head straight for (tx, tz) and face the way it moves. */
	private steer(
		g: GuardState,
		tx: number,
		tz: number,
		speed: number,
		sprint: boolean,
	): void {
		const dx = tx - g.x;
		const dz = tz - g.z;
		const d = Math.hypot(dx, dz);
		if (d < 1e-4) return;
		const s = Math.min(speed, 0.35 + d); // ease into the target
		g.mx = (dx / d) * s;
		g.mz = (dz / d) * s;
		g.sprint = sprint;
		this.turnTo(g, Math.atan2(dx, dz));
	}

	private stuck(g: GuardState): boolean {
		if (++g.stuckT < 90) return false;
		const moved = Math.hypot(g.x - g.stuckX, g.z - g.stuckZ);
		g.stuckT = 0;
		g.stuckX = g.x;
		g.stuckZ = g.z;
		return moved < 0.3;
	}

	/**
	 * Walk to (tx, tz): straight when the grid line is clear, else along an A* path (replanned
	 * when the target moves or every 45 ticks). Returns true on arrival.
	 */
	private goTo(
		g: GuardState,
		tx: number,
		tz: number,
		speed: number,
		sprint: boolean,
	): boolean {
		if (Math.hypot(tx - g.x, tz - g.z) < 0.5) return true;
		const grid = this.grid;
		if (grid.clearLine(g.x, g.z, tx, tz)) {
			this.steer(g, tx, tz, speed, sprint);
			if (this.stuck(g)) return true;
			return false;
		}
		g.repath--;
		if (
			g.pathLen === 0 ||
			g.repath <= 0 ||
			Math.hypot(tx - g.pathTX, tz - g.pathTZ) > 1
		) {
			const from = grid.nearestWalkable(g.x, g.z, 3);
			const to = grid.nearestWalkable(tx, tz, 4);
			g.pathLen = from >= 0 && to >= 0 ? grid.findPath(from, to, g.path) : 0;
			g.pathIdx = 0;
			g.pathTX = tx;
			g.pathTZ = tz;
			g.repath = 45;
			if (g.pathLen === 0) return true; // unreachable: give up here
		}
		// Aim at the farthest of the next few path tiles in a clear line.
		let aim = g.pathIdx;
		for (let k = Math.min(g.pathLen - 1, g.pathIdx + 10); k > g.pathIdx; k--) {
			const t = g.path[k] as number;
			if (grid.clearLine(g.x, g.z, grid.cx(t), grid.cz(t))) {
				aim = k;
				break;
			}
		}
		g.pathIdx = aim;
		const t = g.path[aim] as number;
		this.steer(g, grid.cx(t), grid.cz(t), speed, sprint);
		if (this.stuck(g)) g.pathLen = 0;
		return false;
	}
}
