import { DataUtils } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
	type EquirectImage,
	spreadEquirectPeaks,
	WEBGL_HDR_MAX_RADIANCE,
} from "../src/defaults/lighting.ts";

const W = 64;
const H = 32;
const HALF_MAX = 65504;

/** A flat sky of `sky` radiance with a few half-float-saturated "sun" texels. */
function sky(half: boolean, sky = 0.5): EquirectImage {
	const n = W * H * 4;
	const data = half ? new Uint16Array(n) : new Float32Array(n);
	const enc = (v: number) => (half ? DataUtils.toHalfFloat(v) : v);
	for (let t = 0; t < W * H; t++) {
		data[t * 4] = enc(sky);
		data[t * 4 + 1] = enc(sky);
		data[t * 4 + 2] = enc(sky);
		data[t * 4 + 3] = enc(1);
	}
	for (const [x, y] of [
		[20, 6],
		[21, 6],
		[20, 7],
		[21, 7],
		[0, 10], // on the u seam: neighbours wrap
		[33, 0], // top pole row: the share past the pole stays in row 0
		[47, H - 1], // bottom pole row
	] as const) {
		for (let c = 0; c < 3; c++) data[(y * W + x) * 4 + c] = enc(HALF_MAX);
	}
	return { data, width: W, height: H };
}

const read = (img: EquirectImage, half: boolean) => (i: number) =>
	half
		? DataUtils.fromHalfFloat(img.data[i] as number)
		: (img.data[i] as number);

/** Solid-angle-weighted total radiance per channel (what diffuse IBL integrates). */
function energy(img: EquirectImage, half: boolean, c: number): number {
	const get = read(img, half);
	let e = 0;
	for (let y = 0; y < H; y++) {
		const w = Math.sin((Math.PI * (y + 0.5)) / H);
		for (let x = 0; x < W; x++) e += get((y * W + x) * 4 + c) * w;
	}
	return e;
}

function maxChannel(img: EquirectImage, half: boolean): number {
	const get = read(img, half);
	let m = 0;
	for (let i = 0; i < img.data.length; i++)
		if (i % 4 !== 3) m = Math.max(m, get(i));
	return m;
}

describe("spreadEquirectPeaks (WebGL HDRI headroom)", () => {
	for (const half of [true, false]) {
		it(`caps peaks and conserves energy (${half ? "half" : "float"})`, () => {
			const img = sky(half);
			const before = [0, 1, 2].map((c) => energy(img, half, c));
			const r = spreadEquirectPeaks(img, WEBGL_HDR_MAX_RADIANCE, half);
			expect(r.changed).toBeGreaterThan(0);
			expect(r.converged).toBe(true);
			expect(maxChannel(img, half)).toBeLessThanOrEqual(
				WEBGL_HDR_MAX_RADIANCE * 1.001,
			);
			for (let c = 0; c < 3; c++)
				expect(
					Math.abs(energy(img, half, c) / (before[c] as number) - 1),
				).toBeLessThan(1e-3);
			// Far from the peaks the sky is untouched; alpha is never touched.
			const get = read(img, half);
			expect(get((28 * W + 40) * 4)).toBe(0.5);
			for (let t = 0; t < W * H; t++) expect(get(t * 4 + 3)).toBe(1);
		});
	}

	it("is a no-op when nothing exceeds the cap", () => {
		const img = sky(true);
		for (let i = 0; i < img.data.length; i++)
			if (DataUtils.fromHalfFloat(img.data[i] as number) > 1)
				img.data[i] = DataUtils.toHalfFloat(1000);
		const copy = img.data.slice();
		expect(spreadEquirectPeaks(img, WEBGL_HDR_MAX_RADIANCE, true)).toEqual({
			changed: 0,
			converged: true,
		});
		expect(img.data).toEqual(copy);
	});

	for (const half of [true, false]) {
		it(`clamps non-finite texels without spreading NaN (${half ? "half" : "float"})`, () => {
			const img = sky(half);
			const inf = half ? 0x7c00 : Number.POSITIVE_INFINITY;
			const ninf = half ? 0xfc00 : Number.NEGATIVE_INFINITY;
			const at = (x: number, y: number) => (y * W + x) * 4;
			img.data[at(50, 20)] = inf; // +Inf red next to finite green/blue
			img.data[at(52, 20) + 1] = ninf;
			const r = spreadEquirectPeaks(img, WEBGL_HDR_MAX_RADIANCE, half);
			expect(r.converged).toBe(true);
			const get = read(img, half);
			for (let i = 0; i < img.data.length; i++)
				expect(Number.isFinite(get(i))).toBe(true);
			expect(get(at(50, 20))).toBe(WEBGL_HDR_MAX_RADIANCE);
			expect(get(at(52, 20) + 1)).toBe(0);
			// Not spread: the neighbours of the +Inf texel keep the sky value.
			expect(get(at(51, 20))).toBe(0.5);
			expect(maxChannel(img, half)).toBeLessThanOrEqual(
				WEBGL_HDR_MAX_RADIANCE * 1.001,
			);
		});
	}

	it("reports non-convergence instead of looping forever", () => {
		// A cap below the sky itself can never be met by spreading.
		const img = sky(false);
		expect(spreadEquirectPeaks(img, 0.1, false).converged).toBe(false);
	});

	it("keeps the cap below the measured WebGL overflow threshold", () => {
		// 32768 measured good on the WebGL backend, 60000 overflowed (see lighting.ts).
		expect(WEBGL_HDR_MAX_RADIANCE).toBeLessThanOrEqual(32768 / 2);
		expect(WEBGL_HDR_MAX_RADIANCE).toBeGreaterThan(1000);
	});
});
