import { ToonNodeMaterial } from "@pebble3d/renderer";
import type { Game } from "@pebble3d/sdk/game";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { float, length, smoothstep, uv, vec3 } from "three/tsl";
import {
	AdditiveBlending,
	IcosahedronGeometry,
	MeshBasicNodeMaterial,
	PlaneGeometry,
	Quaternion,
	Vector3,
} from "three/webgpu";
import type { Archetype } from "./ai/archetypes.ts";
import { Sfx } from "./audio/sfx.ts";
import type { MoveDef } from "./combat/moves.ts";
import { EV } from "./events.ts";
import { BTN } from "./input.ts";
import { PHASE } from "./phase.ts";
import type { GameSim, Zombie } from "./sim.ts";
import { Hud } from "./ui/hud.ts";
import { Afterimages } from "./vfx/afterimage.ts";
import {
	crackDecals,
	type Decals,
	ichorDecals,
	ringDecals,
} from "./vfx/decals.ts";
import { Particles } from "./vfx/particles.ts";
import { Telegraphs } from "./vfx/telegraphs.ts";
import { SlashTrail } from "./vfx/trail.ts";
import { Vortex } from "./vfx/vortex.ts";
import { CameraRig } from "./view/camera-rig.ts";
import { Dusk } from "./view/dusk.ts";
import { ObjectiveView } from "./view/objective-view.ts";
import { PlayerView } from "./view/player-view.ts";
import { ZombieView } from "./view/zombie-view.ts";

export interface PresentationOptions {
	hud: HTMLElement | null;
	mute: boolean;
	/** Auto-framing camera (demo / captures). */
	auto: boolean;
	canvas: HTMLCanvasElement;
	/** The zombie avatars, in `zombies.json` order. */
	zombieGltfs: GLTF[];
	/** Inject one-tick buttons (UI clicks) into the live input. */
	onButtons: (bits: number) => void;
}

const TRAIL_SUBSTEPS = 4;
const _a = new Vector3();
const _b = new Vector3();
const _d0 = new Vector3();
const _d1 = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();

function softDot(): MeshBasicNodeMaterial {
	const m = new MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
	const r = length(uv().sub(0.5)).mul(2);
	m.colorNode = vec3(1, 1, 1).mul(float(1).sub(smoothstep(0.1, 1, r)));
	return m;
}

/**
 * Everything the player sees and hears, driven by the sim: views (player, zombies, gate),
 * VFX, HUD, audio, camera and time of day. `drain` consumes the sim's events after every
 * tick; `update` runs once per rendered frame. Read-only with respect to the sim.
 */
export class Presentation {
	private readonly game: Game;
	private readonly sim: GameSim;
	readonly player: PlayerView;
	private readonly zombies: ZombieView;
	private readonly gate: ObjectiveView;
	private readonly rig: CameraRig;
	private readonly dusk: Dusk;
	private readonly trail: SlashTrail;
	private readonly sparks: Particles;
	private readonly ichor: Particles;
	private readonly dust: Particles;
	private readonly splinters: Particles;
	private readonly pools: Decals;
	private readonly rings: Decals;
	private readonly cracks: Decals;
	private readonly telegraphs: Telegraphs;
	private readonly vortex: Vortex;
	private readonly ghosts: Afterimages;
	private readonly hud: Hud | null;
	private readonly sfx: Sfx;
	private lastFrameF = -1;
	private lastSwing = -1;
	private ghostT = 0;
	private presetCam = false;

	constructor(game: Game, sim: GameSim, gltf: GLTF, o: PresentationOptions) {
		this.game = game;
		this.sim = sim;
		const r = game.renderer;
		const scene = r.three.scene;
		this.player = new PlayerView(scene, gltf, sim);
		this.zombies = new ZombieView(scene, game, sim, o.zombieGltfs);
		this.gate = new ObjectiveView(scene, sim);
		this.rig = new CameraRig(r.three.camera, sim, o.auto ? null : o.canvas);
		this.rig.auto = o.auto;
		this.dusk = new Dusk(r);
		this.trail = new SlashTrail(scene);
		const quad = new PlaneGeometry(1, 1);
		this.sparks = new Particles(scene, {
			capacity: 400,
			geometry: quad,
			material: softDot(),
			mode: "stretch",
			stretch: 0.045,
			gravity: 9,
			drag: 3.5,
			fadeColor: true,
		});
		this.pools = ichorDecals(scene, 90);
		const ichorMat = new ToonNodeMaterial({
			color: 0x2c5a22,
			roughness: 0.15,
			metalness: 0,
			emissive: 0x0c2008,
		});
		ichorMat.toonSpecular = 0.4;
		this.ichor = new Particles(scene, {
			capacity: 500,
			geometry: new IcosahedronGeometry(0.5, 0),
			material: ichorMat,
			mode: "tumble",
			gravity: 14,
			drag: 0.6,
			onGround: (x, z, size) => {
				if (size > 0.05)
					this.pools.add(
						x,
						z,
						0.02,
						size * 2.6,
						6 + size * 20,
						1,
						1,
						1,
						(x * 7.3 + z * 3.1) % 6.28,
						0.012,
					);
			},
		});
		const dustMat = new MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
		});
		const dr = length(uv().sub(0.5)).mul(2);
		dustMat.colorNode = vec3(0.55, 0.48, 0.38);
		dustMat.opacityNode = float(1)
			.sub(smoothstep(0.2, 1, dr))
			.mul(0.35);
		this.dust = new Particles(scene, {
			capacity: 260,
			geometry: quad,
			material: dustMat,
			mode: "billboard",
			gravity: -0.4,
			drag: 2.2,
		});
		this.splinters = new Particles(scene, {
			capacity: 120,
			geometry: new IcosahedronGeometry(0.5, 0).scale(0.4, 0.4, 2.2),
			material: new ToonNodeMaterial({
				color: 0x6b4b2e,
				roughness: 0.9,
			}),
			mode: "tumble",
			gravity: 14,
			drag: 0.4,
		});
		this.rings = ringDecals(scene, 24);
		this.cracks = crackDecals(scene, 24);
		this.telegraphs = new Telegraphs(scene, sim);
		this.vortex = new Vortex(scene);
		this.ghosts = new Afterimages(scene, gltf, this.player.model);
		this.sfx = new Sfx(!o.mute);
		this.hud = o.hud
			? new Hud(o.hud, sim, {
					demo: o.auto,
					onPick: (slot) =>
						o.onButtons([BTN.PICK1, BTN.PICK2, BTN.PICK3][slot] ?? 0),
					onStart: () => o.onButtons(BTN.START),
				})
			: null;
		this.dusk.target = 0.12;
		this.dusk.snap();
	}

	get cameraYaw(): number {
		return this.rig.tpc.yaw;
	}

	look(yaw: number, pitch: number): void {
		this.rig.tpc.yaw += yaw;
		this.rig.tpc.pitch += pitch;
	}

	/** Fixes the follow camera's yaw / pitch / distance (captures); undefined keeps it free. */
	overrideCamera(
		yaw: number | undefined,
		pitch: number | undefined,
		dist: number | undefined,
	): void {
		this.rig.fixedYaw = yaw ?? null;
		this.rig.fixedPitch = pitch ?? null;
		if (dist !== undefined) this.rig.tpc.distance = dist;
	}

	/** Perf experiments (?dbg=...): "nozombies" hides them, "noshadow" stops their shadows. */
	debug(flags: string[]): void {
		this.zombies.debug(flags.includes("nozombies"), flags.includes("noshadow"));
	}

	/** Zombie view diagnostics (debug hook). */
	zombieDiag(): { animated: number; visible: number; clones: number } {
		return { ...this.zombies.diag };
	}

	/** Pins the view to a scene camera preset (captures). */
	setCameraPreset(name: string): void {
		if (name === "controller") return;
		this.presetCam = true;
		this.rig.tpc.enabled = false;
		this.game.renderer.setCameraPreset(name);
	}

	/** Consumes the events of the tick just simulated. */
	drain(): void {
		const s = this.sim;
		const e = s.events;
		if (s.shake > 0) this.rig.addTrauma(s.shake * 0.55);
		for (let i = 0; i < e.n; i++) {
			const x = e.x[i] as number;
			const y = e.y[i] as number;
			const z = e.z[i] as number;
			const a = e.a[i] as number;
			const u = e.u[i] as number;
			const v = e.v[i] as number;
			switch (e.type[i]) {
				case EV.SWING: {
					const d = s.moves.moves[a] as MoveDef;
					const heavy = d.hits.some((h) => h.poise >= 2);
					this.sfx.swish(heavy ? 1 : 0.2);
					this.trail.cut();
					this.trail.intensity = heavy ? 1.25 : 0.9;
					if (d.id !== "light1" && d.id !== "light2")
						this.hud?.moveName(d.name);
					break;
				}
				case EV.HIT:
					this.onHit(x, y, z, u, v > 0);
					break;
				case EV.KILL:
					this.onKill(a, x, y, z, u, v);
					break;
				case EV.SPAWN:
					this.cracks.add(x, z, 0.3, 1.5, 1.6, 1.8, 0.55, 0.15, x * 3.1);
					for (let k = 0; k < 10; k++) {
						const ang = k * 0.628 + x;
						this.dust.spawn(
							x + Math.cos(ang) * 0.4,
							0.15,
							z + Math.sin(ang) * 0.4,
							Math.cos(ang) * 1.6,
							1.2 + (k % 3) * 0.5,
							Math.sin(ang) * 1.6,
							1.1,
							0.5,
							1,
							1,
							1,
						);
					}
					this.sfx.groan(u === 2 ? 0.6 : 1, 0.08);
					break;
				case EV.TELEGRAPH: {
					const zb = this.zombieBySerial(a);
					if (u > 0 && zb && (s.archetypes[zb.type] as Archetype).slam)
						this.sfx.groan(0.45, 0.22);
					break;
				}
				case EV.STRIKE:
					if (u > 0) {
						// brute slam
						this.rings.add(x, z, 0.4, u + 0.6, 0.55, 2.4, 0.5, 0.25);
						for (let k = 0; k < 18; k++) {
							const ang = k * 0.349;
							this.dust.spawn(
								x + Math.cos(ang) * 1.2,
								0.2,
								z + Math.sin(ang) * 1.2,
								Math.cos(ang) * 4,
								1.5,
								Math.sin(ang) * 4,
								1.3,
								0.9,
								1,
								1,
								1,
							);
						}
						this.sfx.boom(0.9);
					}
					break;
				case EV.PLAYER_HURT:
					this.player.hurt();
					this.hud?.hurt();
					this.sfx.hurt();
					this.rig.punch(2);
					for (let k = 0; k < 8; k++)
						this.sparks.spawn(
							x,
							y,
							z,
							Math.sin(k * 2.1) * 3,
							1 + k * 0.3,
							Math.cos(k * 2.1) * 3,
							0.35,
							0.09,
							2.4,
							0.4,
							0.2,
						);
					break;
				case EV.DODGE:
					this.sfx.dash();
					this.ghostT = 0;
					for (let k = 0; k < 6; k++)
						this.dust.spawn(
							x,
							0.1,
							z,
							-u * 2 + Math.sin(k) * 0.8,
							0.6,
							-v * 2 + Math.cos(k) * 0.8,
							0.7,
							0.45,
							1,
							1,
							1,
						);
					break;
				case EV.LAND:
					for (let k = 0; k < 8; k++) {
						const ang = k * 0.785;
						this.dust.spawn(
							x,
							0.1,
							z,
							Math.cos(ang) * 2,
							0.4,
							Math.sin(ang) * 2,
							0.8,
							0.5,
							1,
							1,
							1,
						);
					}
					if (a === s.moves.plunge) {
						this.rings.add(x, z, 0.5, 3.6, 0.5, 1.6, 1.8, 2.4);
						this.sfx.boom(1);
						this.rig.punch(4);
					}
					break;
				case EV.SPIN:
					this.sfx.spin(true);
					this.hud?.moveName("Spin Storm");
					break;
				case EV.FOCUS_FULL:
					this.sfx.chime(true);
					this.hud?.focusReady();
					break;
				case EV.PRE_WAVE:
					this.hud?.preWave(a);
					this.dusk.target =
						0.12 + 0.88 * ((a - 1) / Math.max(1, s.totalWaves - 1));
					if (this.game.renderer.stats().fps === 0 || a === s.cfg.startWave)
						this.dusk.snap();
					break;
				case EV.WAVE_START:
					this.hud?.waveStart(a);
					this.sfx.horn();
					break;
				case EV.WAVE_CLEAR:
					this.hud?.waveClear(a, u);
					this.sfx.chime();
					break;
				case EV.UPGRADE_PICK:
					this.sfx.chime(true);
					break;
				case EV.OBJ_HIT:
					this.gate.hit();
					this.hud?.gateStruck();
					this.sfx.thud();
					for (let k = 0; k < 5; k++)
						this.splinters.spawn(
							x + Math.sin(k * 1.7) * 0.8,
							1 + (k % 3) * 0.4,
							z + 0.3,
							Math.sin(k * 1.7) * 2.5,
							2 + k * 0.4,
							2.2,
							1.2,
							0.07,
							1,
							1,
							1,
						);
					break;
				case EV.SHOCKWAVE:
					this.rings.add(x, z, 0.5, u, 0.45, 2.2, 1.6, 0.9);
					this.sfx.boom(0.7);
					break;
				case EV.PERFECT_DODGE:
					this.hud?.perfect();
					this.sfx.chime(true);
					break;
				case EV.ZOMBIE_LAND:
					for (let k = 0; k < 5; k++)
						this.dust.spawn(
							x,
							0.1,
							z,
							Math.cos(k * 1.3) * 1.5,
							0.5,
							Math.sin(k * 1.3) * 1.5,
							0.7,
							0.5,
							1,
							1,
							1,
						);
					break;
				case EV.CHARGE_READY:
					this.sfx.chime();
					break;
				case EV.RUN_START:
					this.zombies.clear();
					break;
				case EV.GAME_OVER:
				case EV.VICTORY:
					this.sfx.horn();
					break;
			}
		}
		e.clear();
	}

	private zombieBySerial(serial: number): Zombie | null {
		for (const z of this.sim.zombies) if (z.serial === serial) return z;
		return null;
	}

	private onHit(
		x: number,
		y: number,
		z: number,
		dmg: number,
		heavy: boolean,
	): void {
		const p = this.sim.player;
		// spray away from the player, sparks along the blade's travel
		let dx = x - p.x;
		let dz = z - p.z;
		const l = Math.hypot(dx, dz) || 1;
		dx /= l;
		dz /= l;
		const n = heavy ? 16 : 10;
		for (let k = 0; k < n; k++) {
			const s = 4 + ((k * 7) % 5) * 1.6;
			const side = ((k * 13) % 7) / 3.5 - 1;
			this.sparks.spawn(
				x,
				y,
				z,
				(dx + -dz * side) * s,
				1.5 + ((k * 5) % 4),
				(dz + dx * side) * s,
				0.22 + (k % 3) * 0.06,
				0.07,
				2.6,
				2.2,
				1.6,
			);
		}
		const m = heavy ? 14 : 9;
		for (let k = 0; k < m; k++) {
			const s = 1.5 + ((k * 3) % 5) * 0.7;
			const side = ((k * 11) % 9) / 4.5 - 1;
			this.ichor.spawn(
				x,
				y,
				z,
				(dx + -dz * side * 0.8) * s,
				1 + ((k * 7) % 5) * 0.7,
				(dz + dx * side * 0.8) * s,
				1.6,
				0.035 + (k % 3) * 0.02,
				1,
				1,
				1,
			);
		}
		this.sfx.hit(heavy);
		if (heavy) this.rig.punch(2.5);
		this.hud?.damage(x, y + 0.2, z, dmg, heavy);
	}

	private onKill(
		serial: number,
		x: number,
		y: number,
		z: number,
		vx: number,
		vz: number,
	): void {
		const zb = this.zombieBySerial(serial);
		if (zb) this.zombies.kill(zb, vx, vz);
		for (let k = 0; k < 16; k++) {
			const ang = k * 0.39;
			const s = 2 + (k % 4);
			this.ichor.spawn(
				x,
				1 + y,
				z,
				Math.cos(ang) * s * 0.6 + vx * 0.2,
				2 + (k % 5),
				Math.sin(ang) * s * 0.6 + vz * 0.2,
				1.6,
				0.05 + (k % 3) * 0.02,
				1,
				1,
				1,
			);
		}
		this.sfx.groan(0.8, 0.1);
	}

	update(dt: number, alpha: number): void {
		const s = this.sim;
		const cam = this.game.renderer.three.camera;
		this.player.update(dt, alpha);
		const pv = this.player.root.position;
		if (!this.presetCam) {
			if (s.phase === PHASE.TITLE)
				this.rig.cinematic(dt, s.objective.x, 0.8, s.objective.z + 1.5, 12);
			else if (s.phase === PHASE.GAME_OVER || s.phase === PHASE.VICTORY)
				this.rig.cinematic(dt, pv.x, pv.y + 0.4, pv.z, 7.5);
			else this.rig.update(dt, pv.x, pv.y, pv.z);
		}

		// blade trail: sub-sampled between the last rendered move frame and this one
		const c = s.combo;
		const d = c.def;
		if (d && d.id !== "dodge" && d.hits.length > 0) {
			const frozen = s.hitstop > 0;
			const f = Math.min(d.total, c.frame + (frozen ? 0 : alpha));
			const h0 = d.hits[0];
			const h1 = d.hits[d.hits.length - 1];
			const from = (h0?.at ?? 0) - 5;
			const to = (h1 ? h1.at + h1.len : 0) + 3;
			if (c.swing !== this.lastSwing) {
				this.lastSwing = c.swing;
				this.lastFrameF = f;
			}
			if (f >= from && f <= to && f > this.lastFrameF) {
				// sub-sample between the last rendered blade and this one: the hand moves
				// linearly, the blade direction turns along the arc
				const pv = this.player;
				_d0.subVectors(pv.prevTip, pv.prevBase).normalize();
				_d1.subVectors(pv.bladeTip, pv.bladeBase).normalize();
				_qa.setFromUnitVectors(_d0, _d1);
				const len = pv.bladeTip.distanceTo(pv.bladeBase);
				for (let k = 1; k <= TRAIL_SUBSTEPS; k++) {
					const t = k / TRAIL_SUBSTEPS;
					_a.lerpVectors(pv.prevBase, pv.bladeBase, t);
					_qb.identity().slerp(_qa, t);
					_b.copy(_d0).applyQuaternion(_qb).multiplyScalar(len).add(_a);
					this.trail.push(_a, _b);
				}
			}
			this.lastFrameF = f;
		}
		this.trail.update(s.hitstop > 0 ? dt * 0.15 : dt);

		// afterimages during dodges and the dash-slash
		if (d && (d.id === "dodge" || d.id === "dashSlash") && c.frame < 14) {
			this.ghostT -= dt;
			if (this.ghostT <= 0) {
				this.ghosts.snap(this.player.root.children[0] ?? this.player.root);
				this.ghostT = 0.035;
			}
		}
		this.ghosts.update(dt);

		const spinning = d !== null && d.spin > 0;
		this.vortex.update(dt, spinning, pv.x, pv.y, pv.z);
		if (!spinning) this.sfx.spin(false);

		this.zombies.update(dt, alpha);
		this.telegraphs.update(dt, alpha);
		this.sparks.update(dt, cam);
		this.ichor.update(dt, cam);
		this.dust.update(dt, cam);
		this.splinters.update(dt, cam);
		this.pools.update(dt);
		this.rings.update(dt);
		this.cracks.update(dt);
		this.dusk.update(dt);
		this.gate.update(dt, this.dusk.t);
		this.sfx.setDusk(this.dusk.t);
		if (this.hud) {
			const canvas = this.game.renderer.three.renderer.domElement;
			this.hud.update(dt, cam, canvas.clientWidth, canvas.clientHeight);
		}
	}
}
