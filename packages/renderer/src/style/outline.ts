import {
	Fn,
	float,
	max,
	perspectiveDepthToViewZ,
	screenSize,
	screenUV,
	smoothstep,
	uniform,
	vec2,
	vec3,
} from "three/tsl";
import {
	Color,
	type Node,
	type PerspectiveCamera,
	type TextureNode,
} from "three/webgpu";
import type { ToonSettings } from "../types.ts";

/** What `ToonNodeMaterial` reads from the scene pass context to ink itself. */
export interface ToonInk {
	/** Ink coverage of the current fragment, 0..1. */
	edge: Node<"float">;
	/** Linear ink colour (mixed in before tone mapping). */
	color: Node<"vec3">;
}

/**
 * Ink-line coverage at the current fragment, from the mesh-only prepass (depth + view
 * normal; splats and transparents never reach it, so the splat gets no lines). Evaluated
 * inside the opaque toon materials of the scene pass (see `ToonNodeMaterial`), so effects
 * and other transparents drawn later blend over the ink instead of under it.
 *
 * - Silhouettes / creases in depth: the screen-space Laplacian of inverse view depth, which
 *   is zero on any plane (1/z is affine in screen space), so grazing floors stay clean. Only
 *   the near side of a step is inked, so lines sit on the object and stay `width` px wide.
 * - Folds: the largest normal change against the 4 neighbours.
 * - `width` is in CSS pixels (scaled by the renderer's pixel ratio).
 */
export function toonInk(
	depth: TextureNode,
	normal: TextureNode,
	camera: PerspectiveCamera,
	pixelRatio: () => number,
	o: ToonSettings["outline"],
): ToonInk {
	const near = uniform(camera.near).onFrameUpdate(() => camera.near);
	const far = uniform(camera.far).onFrameUpdate(() => camera.far);
	const opacity = uniform(o.opacity);
	const width = uniform(o.width).onFrameUpdate(() => o.width * pixelRatio());
	const depthT = uniform(o.depthThreshold);
	const normalT = uniform(o.normalThreshold);
	const c = new Color(o.color);
	const edge = Fn(() => {
		const px = vec2(width, width).div(screenSize);
		const uv = screenUV;
		const ox = vec2(px.x, 0);
		const oy = vec2(0, px.y);
		const invZ = (p: Node<"vec2">): Node<"float"> =>
			float(1).div(
				perspectiveDepthToViewZ(depth.sample(p).r, near, far).negate(),
			);
		const zc = invZ(uv);
		const zl = invZ(uv.sub(ox));
		const zr = invZ(uv.add(ox));
		const zd = invZ(uv.sub(oy));
		const zu = invZ(uv.add(oy));
		// Negative Laplacian of 1/z on the near side of a step; relative to the centre depth.
		const lap = max(zc.mul(2).sub(zl).sub(zr), zc.mul(2).sub(zd).sub(zu)).div(
			zc,
		);
		const dEdge = smoothstep(depthT, depthT.mul(2), lap);

		const nc = normal.sample(uv).xyz;
		const nDiff = max(
			max(
				float(1).sub(nc.dot(normal.sample(uv.add(ox)).xyz)),
				float(1).sub(nc.dot(normal.sample(uv.sub(ox)).xyz)),
			),
			max(
				float(1).sub(nc.dot(normal.sample(uv.add(oy)).xyz)),
				float(1).sub(nc.dot(normal.sample(uv.sub(oy)).xyz)),
			),
		);
		// Background has no normal: the depth term owns silhouettes.
		const isMesh = depth.sample(uv).r.lessThan(1);
		const nEdge = smoothstep(normalT, normalT.add(0.2), nDiff).mul(
			isMesh.select(float(1), float(0)),
		);
		return max(dEdge, nEdge).clamp().mul(opacity);
	})() as Node<"float">;
	return { edge, color: vec3(c.r, c.g, c.b) };
}
