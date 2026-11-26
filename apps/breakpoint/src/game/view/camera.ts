import { type PerspectiveCamera, Vector3 } from "three/webgpu";

export type CamMode =
	| "title"
	| "aim"
	| "flight"
	| "impact"
	| "survey"
	| "replay";

const _t = new Vector3();
const _p = new Vector3();

/** Smoothstep. */
const ss = (t: number): number => {
	const k = Math.min(1, Math.max(0, t));
	return k * k * (3 - 2 * k);
};

/**
 * The camera director. Every mode computes a desired eye and target; the camera eases toward
 * them (critically damped), plus a decaying shake. It also owns the time scale: impacts drop
 * into slow motion and ease back out. Presentation-only.
 */
export class CameraDirector {
	mode: CamMode = "title";
	/** Seconds (real) in the current mode. */
	modeTime = 0;
	/** Game-time multiplier the frame loop applies to the sim. */
	timeScale = 1;
	readonly eye = new Vector3(30, 12, 30);
	readonly look = new Vector3(0, 3, 0);
	/** Focus points the modes use (set by the presentation). */
	readonly site = new Vector3(0, 3, 0);
	readonly cannon = new Vector3(0, 2.4, 30);
	readonly reticle = new Vector3(0, 2, 0);
	readonly ball = new Vector3();
	readonly ballVel = new Vector3(0, 0, -1);
	readonly impactAt = new Vector3();
	readonly impactDir = new Vector3(0, 0, -1);
	/** Site radius (m), for framing. */
	siteRadius = 10;
	/** Which side the impact cam takes (+1 / -1). */
	side = 1;
	private shakeAmp = 0;
	private shakeT = 0;
	private stiffness = 3;
	/** Replay: slow-mo factor while it plays. */
	replayScale = 0.4;
	/** Overrides (captures): fixed yaw/pitch/dist around the site. */
	override: { yaw: number; pitch: number; dist: number } | null = null;

	constructor(private readonly cam: PerspectiveCamera) {}

	set(mode: CamMode, snap = false): void {
		if (mode === this.mode && !snap) return;
		this.mode = mode;
		this.modeTime = 0;
		this.stiffness = mode === "impact" ? 9 : mode === "flight" ? 6 : 2.4;
		if (mode === "impact" || mode === "replay")
			this.side = this.impactDir.x >= 0 ? -1 : 1;
		if (snap) {
			this.desired(0);
			this.cam.position.copy(_p);
			this.look.copy(_t);
			this.eye.copy(_p);
		}
	}

	shake(amount: number): void {
		this.shakeAmp = Math.min(0.6, this.shakeAmp + amount);
	}

	/** Desired eye in _p and target in _t for the current mode. */
	private desired(t: number): void {
		const r = this.siteRadius;
		switch (this.mode) {
			case "title": {
				// Slow orbit; the target sits left of the site so the site frames right of the
				// title text.
				const a = 0.75 + t * 0.05;
				const d = r + 20;
				_p.set(
					this.site.x + Math.sin(a) * d,
					6 + r * 0.25,
					this.site.z + Math.cos(a) * d,
				);
				_t.set(-Math.cos(a), 0, Math.sin(a))
					.multiplyScalar(r * 0.75)
					.add(this.site);
				_t.y = 4.5;
				break;
			}
			case "aim": {
				// Over the cannon's shoulder, biased toward the reticle.
				_p.copy(this.cannon).add(
					_t.set(this.reticle.x * 0.18 + 3.0, 2.7, 10.5),
				);
				_t.copy(this.reticle).lerp(this.site, 0.35);
				_t.y = Math.max(_t.y, 2.4);
				break;
			}
			case "flight": {
				_t.copy(this.ballVel).normalize();
				_p.copy(this.ball)
					.addScaledVector(_t, -7)
					.add(_t.set(1.4, 2.2, 0));
				_t.copy(this.ball).addScaledVector(this.ballVel, 0.25);
				_t.lerp(this.impactAt, 0.35);
				break;
			}
			case "impact": {
				// Back along the line of fire (always clear), offset to one side and raised,
				// pulling back as the debris spreads.
				const d = this.impactDir;
				const k = ss(t / 4);
				const back = 8 + 7 * k;
				const off = 3.2 + 2 * k;
				_p.set(
					this.impactAt.x - d.x * back - d.z * off * this.side,
					this.impactAt.y + 1.6 + 2.2 * k,
					this.impactAt.z - d.z * back + d.x * off * this.side,
				);
				_t.copy(this.impactAt);
				_t.y = Math.max(1.8, this.impactAt.y + 0.6 * k);
				break;
			}
			case "survey": {
				const a = 0.5 + Math.sin(t * 0.08) * 0.15;
				_p.set(Math.sin(a) * (r + 16), 7 + r * 0.35, Math.cos(a) * (r + 16));
				_t.copy(this.site);
				_t.y = 2.2;
				break;
			}
			case "replay": {
				// A slow arc around the site from the cannon side, low, through the replay.
				const d = this.impactDir;
				const base = Math.atan2(-d.x, -d.z);
				const a = base + 0.95 * this.side - t * 0.07 * this.side;
				const dist = r + 7 + t * 0.25;
				_p.set(
					this.site.x + Math.sin(a) * dist,
					2.0 + t * 0.22,
					this.site.z + Math.cos(a) * dist,
				);
				_t.copy(this.impactAt).lerp(this.site, 0.4);
				_t.y = 2.6;
				break;
			}
		}
		if (this.override) {
			const o = this.override;
			_t.copy(this.site);
			_t.y = 2.5;
			_p.set(
				_t.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist,
				_t.y + Math.sin(o.pitch) * o.dist,
				_t.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist,
			);
		}
	}

	/** `dt` real seconds. */
	update(dt: number): void {
		this.modeTime += dt;
		this.desired(this.modeTime);
		const k = 1 - Math.exp(-dt * this.stiffness);
		this.eye.lerp(_p, k);
		this.look.lerp(_t, Math.min(1, k * 1.4));
		this.cam.position.copy(this.eye);
		this.shakeT += dt;
		if (this.shakeAmp > 0.001) {
			const a = this.shakeAmp;
			const s = this.shakeT * 31;
			this.cam.position.x += Math.sin(s * 1.3) * a * 0.5;
			this.cam.position.y += Math.sin(s * 1.7 + 1) * a * 0.4;
			this.cam.position.z += Math.cos(s * 1.1) * a * 0.3;
			this.shakeAmp *= Math.exp(-dt * 4.5);
		}
		this.cam.lookAt(this.look);
		// Time scale: impact slow-mo eases back to real time.
		if (this.mode === "impact") {
			const t = this.modeTime;
			this.timeScale = t < 1.3 ? 0.22 : 0.22 + 0.78 * ss((t - 1.3) / 1.4);
		} else if (this.mode === "replay") this.timeScale = this.replayScale;
		else this.timeScale = 1;
	}
}
