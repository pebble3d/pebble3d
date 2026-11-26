import type { EngineRenderer } from "@pebble3d/renderer";
import { fog, rangeFogFactor, uniform } from "three/tsl";
import { Color, type DirectionalLight, Vector3 } from "three/webgpu";

/** One time-of-day key. */
interface Key {
	sunDir: [number, number, number];
	sunColor: string;
	sun: number;
	exposure: number;
	splatExposure: number;
	splatSaturation: number;
	tint: [number, number, number];
	env: number;
	fogColor: string;
	fogNear: number;
	fogFar: number;
}

/** Golden hour (wave 1) -> sunset -> dusk (wave 8). */
const KEYS: Key[] = [
	{
		sunDir: [0.97, 0.62, 0.3],
		sunColor: "#ffe6c4",
		sun: 3.1,
		exposure: 1.0,
		splatExposure: 0.86,
		splatSaturation: 1.1,
		tint: [1.0, 0.95, 0.86],
		env: 1.0,
		fogColor: "#d9b48a",
		fogNear: 34,
		fogFar: 120,
	},
	{
		// sunset: warm key light, but skin stays skin (no deep orange cast)
		sunDir: [0.97, 0.36, 0.42],
		sunColor: "#ffbf8a",
		sun: 2.8,
		exposure: 0.98,
		splatExposure: 0.72,
		splatSaturation: 1.04,
		tint: [1.0, 0.84, 0.7],
		env: 0.85,
		fogColor: "#c98a64",
		fogNear: 26,
		fogFar: 90,
	},
	{
		// dusk: the world darkens and cools; characters keep a low warm rim from the sun
		// and enough sky fill to read skin and the zombies' grey-green
		sunDir: [0.97, 0.18, 0.5],
		sunColor: "#ff9a6a",
		sun: 2.3,
		exposure: 0.98,
		splatExposure: 0.46,
		splatSaturation: 0.85,
		tint: [0.72, 0.74, 0.84],
		env: 0.72,
		fogColor: "#3b4656",
		fogNear: 16,
		fogFar: 60,
	},
];

const SUN_COLORS = KEYS.map((k) => new Color(k.sunColor));
const FOG_COLORS = KEYS.map((k) => new Color(k.fogColor));
const _v = new Vector3();

function lerp(u: number, v: number, f: number): number {
	return u + (v - u) * f;
}

/**
 * Drives the scene from golden hour to dusk across the waves: sun direction, colour and
 * intensity, tone-mapping exposure, environment intensity, the splat's exposure, saturation
 * and tint, and a range fog. `t` eases toward its target so a wave change is a slow fade.
 */
export class Dusk {
	t = 0;
	target = 0;
	private readonly fogColor = uniform(new Color());
	private readonly fogNear = uniform(30);
	private readonly fogFar = uniform(110);
	private readonly sun: DirectionalLight | null;
	private readonly r: EngineRenderer;

	constructor(r: EngineRenderer) {
		this.r = r;
		let sun: DirectionalLight | null = null;
		r.three.scene.traverse((o) => {
			if (!sun && (o as DirectionalLight).isDirectionalLight)
				sun = o as DirectionalLight;
		});
		this.sun = sun;
		r.three.scene.fogNode = fog(
			this.fogColor,
			rangeFogFactor(this.fogNear, this.fogFar),
		);
		this.apply();
	}

	update(dt: number): void {
		this.t += (this.target - this.t) * (1 - Math.exp(-0.6 * dt));
		this.apply();
	}

	/** Jumps straight to the target (captures). */
	snap(): void {
		this.t = this.target;
		this.apply();
	}

	private apply(): void {
		const x = Math.max(0, Math.min(1, this.t)) * (KEYS.length - 1);
		const i = Math.min(KEYS.length - 2, Math.floor(x));
		const f = x - i;
		const a = KEYS[i] as Key;
		const b = KEYS[i + 1] as Key;
		const r = this.r;
		if (this.sun) {
			_v.set(
				lerp(a.sunDir[0], b.sunDir[0], f),
				lerp(a.sunDir[1], b.sunDir[1], f),
				lerp(a.sunDir[2], b.sunDir[2], f),
			).normalize();
			this.sun.position.copy(_v).multiplyScalar(100);
			this.sun.color
				.copy(SUN_COLORS[i] as Color)
				.lerp(SUN_COLORS[i + 1] as Color, f);
			this.sun.intensity = lerp(a.sun, b.sun, f);
		}
		r.three.renderer.toneMappingExposure = lerp(a.exposure, b.exposure, f);
		r.three.scene.environmentIntensity = lerp(a.env, b.env, f);
		r.three.scene.backgroundIntensity = lerp(a.env, b.env, f);
		const sc = r.splatColor;
		if (sc) {
			sc.exposure.value = lerp(a.splatExposure, b.splatExposure, f);
			sc.saturation.value = lerp(a.splatSaturation, b.splatSaturation, f);
			sc.tint.value.setRGB(
				lerp(a.tint[0], b.tint[0], f),
				lerp(a.tint[1], b.tint[1], f),
				lerp(a.tint[2], b.tint[2], f),
			);
		}
		this.fogColor.value
			.copy(FOG_COLORS[i] as Color)
			.lerp(FOG_COLORS[i + 1] as Color, f);
		this.fogNear.value = lerp(a.fogNear, b.fogNear, f);
		this.fogFar.value = lerp(a.fogFar, b.fogFar, f);
	}
}
