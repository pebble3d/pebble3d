import { ANOMALIES, type AnomalyDef } from "./anomalies.ts";
import {
	DAY_TICKS,
	DEVELOP_TICKS,
	DOCUMENT_BONUS,
	EV_MAX,
	EV_MIN,
	EV_STEP,
	EYE_ABOVE_CENTER,
	EYE_FORWARD,
	FILM,
	FOCUS_MAX,
	FOCUS_MIN,
	FOV_DEFAULT,
	FOV_MAX,
	FOV_MIN,
	PITCH_MAX,
	PITCH_MIN,
	REVEAL_RADIUS,
	SHUTTER_COOLDOWN,
	SIGNAL_RADIUS,
	TICKS_PER_SECOND,
	TIME_BONUS_PER_SECOND,
	WRAP_TICKS,
} from "./constants.ts";
import { BTN, type TickInput } from "./input.ts";
import {
	emptyScore,
	type PhotoCam,
	type PhotoScore,
	project,
	type Subject,
	scorePhoto,
} from "./photo.ts";
import { Rng } from "./rng.ts";

export interface WorldBox {
	x: number;
	z: number;
	hx: number;
	hz: number;
	h: number;
}

/** A place an anomaly may surface. `y` overrides the kind's hover height (over furniture);
 * `floor` marks open floor, where the standing Hollow Door fits. */
export interface Spot {
	x: number;
	z: number;
	y?: number;
	floor?: boolean;
}

/** Presentation-only site settings (camera, title shot, props); the sim ignores them. */
export interface SiteView {
	camDist: number;
	camPitch: number;
	titlePos: [number, number, number];
	titleTarget: [number, number, number];
	/** Depth-of-field proxy distance for depthless splat pixels above the floor, metres. */
	backdrop: number;
	/** Interiors: the bounds walls stop the camera arm (outdoors they would only get in the way). */
	cameraWalls: boolean;
	/** Demo bot: keep the camera yaw within [centre - range, centre + range] (radians) while
	 * walking, strafing instead of turning away (the capture is soft on the other side). */
	botLook?: [number, number];
	props: {
		case?: [number, number, number];
		tripod?: [number, number];
		stakes?: [number, number][];
	};
}

export interface WorldDef {
	bounds: { min: [number, number]; max: [number, number] };
	playerStart: [number, number];
	obstacles: WorldBox[];
	spots: Spot[];
	/** Reveal distance for this site (default REVEAL_RADIUS): smaller in tight interiors. */
	revealRadius?: number;
	view: SiteView;
}

/**
 * Occlusion query: does anything solid lie on the segment from (ox,oy,oz) along the unit
 * direction (dx,dy,dz) within `max` metres? The app answers with an engine raycast.
 */
export type OcclusionQuery = (
	ox: number,
	oy: number,
	oz: number,
	dx: number,
	dy: number,
	dz: number,
	max: number,
) => boolean;

/** Ticks the results screen ignores START for (about a second). */
export const RESULTS_LOCK = 60;

export const PHASE = {
	TITLE: 0,
	EXPLORE: 1,
	PHOTO: 2,
	RESULTS: 3,
} as const;
export type Phase = (typeof PHASE)[keyof typeof PHASE];
export const PHASE_NAMES = ["title", "explore", "photo", "results"] as const;

/** Why the survey ended. */
export const END = { NONE: 0, ALL: 1, FILM: 2, DARK: 3 } as const;

export const EV = {
	REVEAL: 1,
	SHUTTER: 2,
	DOCUMENTED: 3,
	AF: 4,
	PHOTO_ON: 5,
	PHOTO_OFF: 6,
	START: 7,
	RESULTS: 8,
	EV_STEP: 9,
	EMPTY_FRAME: 10,
} as const;

export class Anomaly {
	kind = 0;
	x = 0;
	y = 0;
	z = 0;
	/** Yaw the anomaly's front faces (only the standing door has one): toward the middle of
	 * the play area, so it is seen face-on rather than edge-on. */
	facing = 0;
	revealed = false;
	/** Tick it was revealed (presentation fades it in from there). */
	revealTick = -1;
	/** Best photo score so far (0 = none). */
	best = 0;
	bestStars = 0;
	photos = 0;
	get def(): AnomalyDef {
		return ANOMALIES[this.kind] as AnomalyDef;
	}
}

export class PhotoRecord {
	used = false;
	tick = 0;
	/** Index into `sim.anomalies`, or -1 for a frame with no anomaly in it. */
	anomaly = -1;
	readonly score: PhotoScore = emptyScore();
	readonly cam: PhotoCam = {
		x: 0,
		y: 0,
		z: 0,
		yaw: 0,
		pitch: 0,
		fovDeg: 0,
		focus: 0,
		ev: 0,
	};
	/** First photo of that anomaly to reach a star. */
	firstDoc = false;
	/** Other anomalies also in the frame (each scored and credited on its own). */
	extra = 0;
}

/** Tiny ring of game events for presentation (audio, HUD). Allocation-free. */
export class EventQueue {
	readonly type = new Int32Array(64);
	readonly arg = new Int32Array(64);
	length = 0;
	push(type: number, arg = 0): void {
		if (this.length >= this.type.length) return;
		this.type[this.length] = type;
		this.arg[this.length] = arg;
		this.length++;
	}
	clear(): void {
		this.length = 0;
	}
}

export interface SimConfig {
	seed: number;
	world: WorldDef;
	occlusion: OcclusionQuery;
}

const _score: PhotoScore = emptyScore();
const _sub: Subject = { x: 0, y: 0, z: 0, r: 0, idealEv: 0 };
const _proj = { u: 0, v: 0, depth: 0 };

/**
 * Field Notes game state, advanced by `step(input)` once per 60 Hz tick. The character's
 * position comes from the engine (`setPlayer` before each step); everything else is here.
 * Deterministic for a seed, input log and player track; allocation-free per tick.
 */
export class FieldSim {
	readonly cfg: SimConfig;
	readonly rng: Rng;
	readonly anomalies: Anomaly[] = [];
	readonly photos: PhotoRecord[] = [];
	readonly events = new EventQueue();
	readonly cam: PhotoCam = {
		x: 0,
		y: 0,
		z: 0,
		yaw: 0,
		pitch: 0,
		fovDeg: FOV_DEFAULT,
		focus: 4,
		ev: 0,
	};

	phase: Phase = PHASE.TITLE;
	phaseT = 0;
	tick = 0;
	/** Daylight left, ticks. */
	light = DAY_TICKS;
	film = FILM;
	shutterCd = 0;
	/** Index of the last photo taken (-1 none) and the tick it was taken. */
	lastPhoto = -1;
	lastPhotoTick = -1000;
	endReason: number = END.NONE;
	/** Ticks until the results screen once the survey is over (-1 = not ending). */
	wrapT = -1;
	/** 0..1: how strongly the nearest hidden anomaly is felt. */
	signal = 0;
	/** Index of the subject the frame centre / AF would pick (-1 none), live in photo mode. */
	subject = -1;
	/** Live meter: exposure minus the subject's ideal (0 = right), NaN without a subject. */
	meter = Number.NaN;
	/** Live: subject depth along the look, metres (NaN without a subject). */
	subjectDepth = Number.NaN;
	/** Horizontal distance at which anomalies materialise on this site. */
	readonly reveal: number;
	/** Results: a fresh START (pressed after a release, after RESULTS_LOCK ticks) asks the
	 * app for a new survey. Stray shutter clicks as the survey ends never skip the results. */
	restartRequested = false;
	private startReleased = false;
	/** Player capsule centre (from the engine). */
	px = 0;
	py = 0.8;
	pz = 0;
	/** Run seed's anomaly placement order: anomaly i sits at world spot `spotOf[i]`. */
	readonly spotOf: Int32Array;

	constructor(cfg: SimConfig) {
		this.cfg = cfg;
		this.reveal = cfg.world.revealRadius ?? REVEAL_RADIUS;
		this.rng = new Rng(cfg.seed);
		const spots = cfg.world.spots;
		// Fisher-Yates over the spot list; the first six host the six kinds.
		const order = new Int32Array(spots.length);
		for (let i = 0; i < order.length; i++) order[i] = i;
		for (let i = order.length - 1; i > 0; i--) {
			const j = this.rng.int(i + 1);
			const t = order[i] as number;
			order[i] = order[j] as number;
			order[j] = t;
		}
		// The standing door needs open floor: swap a floor spot into its slot if needed.
		const DOOR = ANOMALIES.findIndex((d) => d.id === "door");
		const isFloor = (k: number): boolean =>
			spots[order[k] as number]?.floor === true;
		if (DOOR >= 0 && !isFloor(DOOR)) {
			for (let k = 0; k < order.length; k++) {
				if (k === DOOR || !isFloor(k)) continue;
				const t = order[k] as number;
				order[k] = order[DOOR] as number;
				order[DOOR] = t;
				break;
			}
		}
		this.spotOf = order;
		for (let k = 0; k < ANOMALIES.length; k++) {
			const a = new Anomaly();
			a.kind = k;
			const s = spots[order[k] as number];
			if (!s) throw new Error("world has fewer spots than anomalies");
			a.x = s.x;
			a.z = s.z;
			a.y = k === DOOR ? a.def.y : (s.y ?? a.def.y);
			const b = cfg.world.bounds;
			a.facing = Math.atan2(
				(b.min[0] + b.max[0]) / 2 - a.x,
				(b.min[1] + b.max[1]) / 2 - a.z,
			);
			this.anomalies.push(a);
		}
		for (let i = 0; i < FILM; i++) this.photos.push(new PhotoRecord());
		this.px = cfg.world.playerStart[0];
		this.pz = cfg.world.playerStart[1];
	}

	setPlayer(x: number, y: number, z: number): void {
		this.px = x;
		this.py = y;
		this.pz = z;
	}

	get documented(): number {
		let n = 0;
		for (const a of this.anomalies) if (a.bestStars > 0) n++;
		return n;
	}

	get revealedCount(): number {
		let n = 0;
		for (const a of this.anomalies) if (a.revealed) n++;
		return n;
	}

	/** Final score: best photo per anomaly, a bonus per documented one, and leftover light. */
	get score(): number {
		let s = 0;
		let all = true;
		for (const a of this.anomalies) {
			s += a.best;
			if (a.bestStars > 0) s += DOCUMENT_BONUS;
			else all = false;
		}
		if (all)
			s += Math.floor(this.light / TICKS_PER_SECOND) * TIME_BONUS_PER_SECOND;
		return s;
	}

	get totalStars(): number {
		let s = 0;
		for (const a of this.anomalies) s += a.bestStars;
		return s;
	}

	private setPhase(p: Phase): void {
		this.phase = p;
		this.phaseT = 0;
	}

	step(input: TickInput): void {
		this.events.clear();
		this.tick++;
		this.phaseT++;
		const b = input.buttons;
		switch (this.phase) {
			case PHASE.TITLE:
				if (b & BTN.START) {
					this.setPhase(PHASE.EXPLORE);
					this.events.push(EV.START);
				}
				break;
			case PHASE.EXPLORE:
			case PHASE.PHOTO:
				this.survey(input);
				break;
			case PHASE.RESULTS:
				if (!(b & BTN.START)) this.startReleased = true;
				else if (this.startReleased && this.phaseT > RESULTS_LOCK)
					this.restartRequested = true;
				break;
		}
	}

	private survey(input: TickInput): void {
		const b = input.buttons;
		if (this.light > 0) this.light--;
		if (this.shutterCd > 0) this.shutterCd--;
		this.updateReveal();

		if (this.wrapT < 0) {
			if (b & BTN.PHOTO) {
				if (this.phase === PHASE.EXPLORE) this.enterPhoto(input.camYaw);
				else this.leavePhoto();
			}
		}
		if (this.phase === PHASE.PHOTO) this.photoTick(input);

		if (this.wrapT < 0) {
			const end =
				this.documented === this.anomalies.length
					? END.ALL
					: this.film === 0
						? END.FILM
						: this.light === 0
							? END.DARK
							: END.NONE;
			if (end !== END.NONE) {
				this.endReason = end;
				this.wrapT = end === END.DARK ? 1 : WRAP_TICKS;
			}
		} else if (--this.wrapT <= 0) {
			if (this.phase === PHASE.PHOTO) this.leavePhoto();
			this.setPhase(PHASE.RESULTS);
			this.events.push(EV.RESULTS, this.endReason);
		}
	}

	private updateReveal(): void {
		let nearest = Number.POSITIVE_INFINITY;
		for (let i = 0; i < this.anomalies.length; i++) {
			const a = this.anomalies[i] as Anomaly;
			const d = Math.hypot(a.x - this.px, a.z - this.pz);
			if (a.revealed) continue;
			if (d <= this.reveal) {
				a.revealed = true;
				a.revealTick = this.tick;
				this.events.push(EV.REVEAL, i);
			} else if (d < nearest) nearest = d;
		}
		this.signal =
			nearest === Number.POSITIVE_INFINITY
				? 0
				: Math.max(
						0,
						Math.min(
							1,
							1 - (nearest - this.reveal) / (SIGNAL_RADIUS - this.reveal),
						),
					);
	}

	/** Places the photo camera at the character's eye, looking along `yaw`. */
	private placeEye(): void {
		const c = this.cam;
		c.x = this.px - Math.sin(c.yaw) * EYE_FORWARD;
		c.z = this.pz - Math.cos(c.yaw) * EYE_FORWARD;
		c.y = this.py + EYE_ABOVE_CENTER;
	}

	private enterPhoto(yaw: number): void {
		const c = this.cam;
		c.yaw = yaw;
		c.pitch = -0.08;
		c.fovDeg = FOV_DEFAULT;
		this.placeEye();
		this.setPhase(PHASE.PHOTO);
		this.events.push(EV.PHOTO_ON);
	}

	private leavePhoto(): void {
		this.setPhase(PHASE.EXPLORE);
		this.events.push(EV.PHOTO_OFF);
	}

	private photoTick(input: TickInput): void {
		const c = this.cam;
		const b = input.buttons;
		c.yaw += input.lookYaw;
		if (c.yaw > Math.PI) c.yaw -= 2 * Math.PI;
		else if (c.yaw < -Math.PI) c.yaw += 2 * Math.PI;
		c.pitch = Math.min(
			PITCH_MAX,
			Math.max(PITCH_MIN, c.pitch + input.lookPitch),
		);
		c.fovDeg = Math.min(FOV_MAX, Math.max(FOV_MIN, c.fovDeg + input.zoom));
		c.focus = Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, c.focus + input.focus));
		if (b & BTN.EV_UP) {
			c.ev = Math.min(EV_MAX, c.ev + EV_STEP);
			this.events.push(EV.EV_STEP, 1);
		}
		if (b & BTN.EV_DOWN) {
			c.ev = Math.max(EV_MIN, c.ev - EV_STEP);
			this.events.push(EV.EV_STEP, -1);
		}
		this.placeEye();
		this.pickSubject();
		if (b & BTN.AF) this.autofocus();
		if (b & BTN.SHUTTER && this.shutterCd === 0 && this.film > 0)
			this.takePhoto();
	}

	/** The revealed anomaly nearest the frame centre (in frame, in front), live for the HUD. */
	private pickSubject(): void {
		let best = -1;
		let bestD = Number.POSITIVE_INFINITY;
		for (let i = 0; i < this.anomalies.length; i++) {
			const a = this.anomalies[i] as Anomaly;
			if (!a.revealed) continue;
			if (!project(this.cam, a.x, a.y, a.z, _proj)) continue;
			if (_proj.u < 0 || _proj.u > 1 || _proj.v < 0 || _proj.v > 1) continue;
			const d = Math.hypot(_proj.u - 0.5, _proj.v - 0.5);
			if (d < bestD) {
				bestD = d;
				best = i;
				this.subjectDepth = _proj.depth;
			}
		}
		this.subject = best;
		if (best < 0) {
			this.meter = Number.NaN;
			this.subjectDepth = Number.NaN;
		} else {
			const a = this.anomalies[best] as Anomaly;
			this.meter = this.cam.ev - a.def.idealEv;
		}
	}

	/** Eye-AF: focus on the live subject; without one, on the floor (or far) at the centre. */
	private autofocus(): void {
		const c = this.cam;
		if (this.subject >= 0) c.focus = this.subjectDepth;
		else if (c.pitch < -0.02) c.focus = c.y / Math.sin(-c.pitch);
		else c.focus = 20;
		c.focus = Math.min(FOCUS_MAX, Math.max(FOCUS_MIN, c.focus));
		this.events.push(EV.AF, this.subject);
	}

	private occluded(a: Anomaly): boolean {
		const c = this.cam;
		const dx = a.x - c.x;
		const dy = a.y - c.y;
		const dz = a.z - c.z;
		const d = Math.hypot(dx, dy, dz);
		if (d < 1e-3) return false;
		// Stop short of the subject's own volume.
		const max = d - a.def.r * 0.5;
		if (max <= 0) return false;
		return this.cfg.occlusion(c.x, c.y, c.z, dx / d, dy / d, dz / d, max);
	}

	private takePhoto(): void {
		const n = FILM - this.film;
		const rec = this.photos[n] as PhotoRecord;
		this.film--;
		this.shutterCd = SHUTTER_COOLDOWN;
		rec.used = true;
		rec.tick = this.tick;
		Object.assign(rec.cam, this.cam);
		rec.anomaly = -1;
		rec.firstDoc = false;
		rec.extra = 0;
		rec.score.total = -1;
		this.events.push(EV.SHUTTER, n);
		// Every revealed anomaly in the frame is scored on its own and keeps its best; the
		// best-scoring one is the photo's headline subject.
		for (let i = 0; i < this.anomalies.length; i++) {
			const a = this.anomalies[i] as Anomaly;
			if (!a.revealed) continue;
			const sub = _sub;
			sub.x = a.x;
			sub.y = a.y;
			sub.z = a.z;
			sub.r = a.def.r;
			sub.idealEv = a.def.idealEv;
			scorePhoto(this.cam, sub, false, _score);
			if (!_score.inFrame) continue;
			if (this.occluded(a)) scorePhoto(this.cam, sub, true, _score);
			a.photos++;
			const wasDoc = a.bestStars > 0;
			if (_score.total > a.best) {
				a.best = _score.total;
				a.bestStars = _score.stars;
			}
			const firstDoc = !wasDoc && a.bestStars > 0;
			if (firstDoc) this.events.push(EV.DOCUMENTED, i);
			if (_score.total > rec.score.total) {
				if (rec.anomaly >= 0) rec.extra++;
				Object.assign(rec.score, _score);
				rec.anomaly = i;
				rec.firstDoc = firstDoc;
			} else rec.extra++;
		}
		if (rec.anomaly < 0) {
			Object.assign(rec.score, emptyScore());
			this.events.push(EV.EMPTY_FRAME, n);
		}
		this.lastPhoto = n;
		this.lastPhotoTick = this.tick;
	}

	/** True while the last print is still on screen. */
	get developing(): boolean {
		return this.tick - this.lastPhotoTick < DEVELOP_TICKS;
	}

	/** FNV-1a over the state that matters (determinism tests and the shot sidecar). */
	hash(): string {
		let h = 0x811c9dc5;
		const mix = (v: number): void => {
			const x = Math.round(v * 1000) | 0;
			for (let s = 0; s < 32; s += 8) {
				h ^= (x >>> s) & 0xff;
				h = Math.imul(h, 0x01000193);
			}
		};
		mix(this.tick);
		mix(this.phase);
		mix(this.light);
		mix(this.film);
		mix(this.cam.yaw);
		mix(this.cam.pitch);
		mix(this.cam.fovDeg);
		mix(this.cam.focus);
		mix(this.cam.ev);
		for (const a of this.anomalies) {
			mix(a.x);
			mix(a.z);
			mix(a.revealed ? 1 : 0);
			mix(a.best);
		}
		for (const p of this.photos) mix(p.used ? p.score.total : -7);
		return (h >>> 0).toString(16).padStart(8, "0");
	}
}
