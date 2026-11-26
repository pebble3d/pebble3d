import {
	DataTexture,
	LinearFilter,
	LinearMipmapLinearFilter,
	RepeatWrapping,
	RGBAFormat,
	UnsignedByteType,
} from "three/webgpu";
import { Rng } from "../rng.ts";

const SIZE = 256;

/** Tileable value-noise fBm on a SIZE^2 grid: octave periods 8..128 cells. Range ~[0, 1]. */
function fbm(seed: number, base: number, octaves: number): Float32Array {
	const out = new Float32Array(SIZE * SIZE);
	let amp = 0.5;
	let total = 0;
	let period = base;
	for (let o = 0; o < octaves && period <= SIZE; o++) {
		const rng = new Rng(seed * 977 + o * 131);
		const cells = SIZE / period;
		const lat = new Float32Array(cells * cells);
		for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
		for (let y = 0; y < SIZE; y++) {
			const fy = y / period;
			const y0 = Math.floor(fy);
			const ty = fy - y0;
			const sy = ty * ty * (3 - 2 * ty);
			const r0 = (y0 % cells) * cells;
			const r1 = ((y0 + 1) % cells) * cells;
			for (let x = 0; x < SIZE; x++) {
				const fx = x / period;
				const x0 = Math.floor(fx);
				const tx = fx - x0;
				const sx = tx * tx * (3 - 2 * tx);
				const c0 = x0 % cells;
				const c1 = (x0 + 1) % cells;
				const a =
					(lat[r0 + c0] as number) +
					((lat[r0 + c1] as number) - (lat[r0 + c0] as number)) * sx;
				const b =
					(lat[r1 + c0] as number) +
					((lat[r1 + c1] as number) - (lat[r1 + c0] as number)) * sx;
				out[y * SIZE + x] =
					(out[y * SIZE + x] as number) + (a + (b - a) * sy) * amp;
			}
		}
		total += amp;
		amp *= 0.5;
		period /= 2;
	}
	for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
	return out;
}

let shared: DataTexture | null = null;

/**
 * One baked, tileable noise texture shared by the cloud sea, grass and rock materials
 * (R: broad fBm, G: fine fBm, B: a third independent fBm, A: 1). Sampling it is far cheaper
 * per pixel than evaluating fractal noise in the shader over full-screen surfaces.
 */
export function noiseTexture(): DataTexture {
	if (shared) return shared;
	const r = fbm(1, 128, 5);
	const g = fbm(2, 32, 4);
	const b = fbm(3, 64, 5);
	const data = new Uint8Array(SIZE * SIZE * 4);
	for (let i = 0; i < SIZE * SIZE; i++) {
		data[i * 4] = Math.round((r[i] as number) * 255);
		data[i * 4 + 1] = Math.round((g[i] as number) * 255);
		data[i * 4 + 2] = Math.round((b[i] as number) * 255);
		data[i * 4 + 3] = 255;
	}
	const t = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
	t.wrapS = RepeatWrapping;
	t.wrapT = RepeatWrapping;
	t.magFilter = LinearFilter;
	t.minFilter = LinearMipmapLinearFilter;
	t.generateMipmaps = true;
	t.needsUpdate = true;
	shared = t;
	return t;
}
