import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, getBounds, NodeIO } from "@gltf-transform/core";
import { KHRTextureBasisu } from "@gltf-transform/extensions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { airborneClips, qmul, qrot } from "./airborne-clips.mjs";
import {
	buildRocketbox,
	cachedTools,
	decodeTga,
	parseCliArgs,
	SOURCE_KEYS,
} from "./build-rocketbox.mjs";
import { rocketboxEntry } from "./rocketbox-entry.mjs";
import { sourceCachePath } from "./source-cache.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ROCKETBOX_ID = "character-rocketbox-male-adult-16";

/** A `size`² uncompressed TGA, 24-bit (0x80 grey) or 32-bit (BGRA = 1, 2, 3, 4). */
function tga(size = 2, bpp = 24) {
	const ch = bpp / 8;
	const b = Buffer.alloc(18 + size * size * ch, 0x80);
	b.fill(0, 0, 18);
	b[2] = 2;
	b.writeUInt16LE(size, 12);
	b.writeUInt16LE(size, 14);
	b[16] = bpp;
	if (ch === 4) for (let i = 18; i < b.length; i += 4) b.set([1, 2, 3, 4], i);
	return b;
}

/** Biped bones of the fixtures: [name, parent, translation] (Y up, facing +Z, cm). */
const BIPED = [
	["Bip01 Spine", "Bip01", [0, 10, 0]],
	["Bip01 Neck", "Bip01 Spine", [0, 45, 0]],
	["Bip01 Head", "Bip01 Neck", [0, 10, 0]],
	["Bip01 L Thigh", "Bip01 Spine", [10, -10, 0]],
	["Bip01 L Calf", "Bip01 L Thigh", [0, -45, 0]],
	["Bip01 L Foot", "Bip01 L Calf", [0, -45, 0]],
	["Bip01 L Toe0", "Bip01 L Foot", [0, -5, 12]],
	["Bip01 R Thigh", "Bip01 Spine", [-10, -10, 0]],
	["Bip01 R Calf", "Bip01 R Thigh", [0, -45, 0]],
	["Bip01 R Foot", "Bip01 R Calf", [0, -45, 0]],
	["Bip01 R Toe0", "Bip01 R Foot", [0, -5, 12]],
	["Bip01 L UpperArm", "Bip01 Neck", [18, -2, 0]],
	["Bip01 L Forearm", "Bip01 L UpperArm", [0, -28, 0]],
	["Bip01 L Hand", "Bip01 L Forearm", [0, -27, 0]],
	["Bip01 R UpperArm", "Bip01 Neck", [-18, -2, 0]],
	["Bip01 R Forearm", "Bip01 R UpperArm", [0, -28, 0]],
	["Bip01 R Hand", "Bip01 R Forearm", [0, -27, 0]],
];

/**
 * A tiny skinned-looking GLB: RootNode > Bip01 > (biped bones, mesh), with body and head
 * materials. `helperOn` inserts an Assimp pivot helper above that bone and animates it.
 */
async function fixtureGlb(
	path,
	withAnimation,
	helperOn,
	materials = ["m019_body", "m019_head"],
	grid = 0,
) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	// one triangle, or (grid > 0) a flat grid x grid quad sheet as unindexed triangles
	const xyz = [0, 0, 0, 1, 0, 0, 0, 180, 0];
	const st = [0, 0, 1, 0, 0, 1];
	if (grid > 0) {
		xyz.length = st.length = 0;
		for (let i = 0; i < grid; i++)
			for (let j = 0; j < grid; j++)
				for (const [di, dj] of [
					[0, 0],
					[1, 0],
					[0, 1],
					[1, 0],
					[1, 1],
					[0, 1],
				]) {
					xyz.push((i + di) * 10, (j + dj) * 10, 0);
					st.push((i + di) / grid, (j + dj) / grid);
				}
	}
	const pos = doc
		.createAccessor()
		.setType("VEC3")
		.setArray(new Float32Array(xyz))
		.setBuffer(buffer);
	const mesh = doc.createMesh("m");
	for (const name of materials)
		mesh.addPrimitive(
			doc
				.createPrimitive()
				.setAttribute("POSITION", pos)
				.setAttribute(
					"TEXCOORD_0",
					doc
						.createAccessor()
						.setType("VEC2")
						.setArray(new Float32Array(st))
						.setBuffer(buffer),
				)
				.setMaterial(doc.createMaterial(name)),
		);
	const bip = doc
		.createNode("Bip01")
		.setTranslation([0, 90, 0])
		.addChild(doc.createNode("mesh").setMesh(mesh));
	const nodes = new Map([["Bip01", bip]]);
	for (const [name, parent, t] of BIPED) {
		const n = doc.createNode(name).setTranslation(t);
		let p = nodes.get(parent);
		if (name === helperOn) {
			const h = doc.createNode(`${name}_$AssimpFbx$_PreRotation`);
			p.addChild(h);
			p = h;
		}
		p.addChild(n);
		nodes.set(name, n);
	}
	const rootNode = doc.createNode("RootNode").addChild(bip);
	doc.createScene().addChild(rootNode);
	if (withAnimation) {
		const input = doc
			.createAccessor()
			.setType("SCALAR")
			.setArray(new Float32Array([0, 1]))
			.setBuffer(buffer);
		const sampler = doc
			.createAnimationSampler()
			.setInput(input)
			.setOutput(
				doc
					.createAccessor()
					.setType("VEC3")
					.setArray(new Float32Array([5, 90, 0, 5, 90, 100]))
					.setBuffer(buffer),
			);
		const anim = doc
			.createAnimation("Take 001")
			.addSampler(sampler)
			.addChannel(
				doc
					.createAnimationChannel()
					.setTargetNode(bip)
					.setTargetPath("translation")
					.setSampler(sampler),
			);
		for (const target of [bip, ...(helperOn ? [nodes.get(helperOn)] : [])]) {
			const rot = doc
				.createAnimationSampler()
				.setInput(input)
				.setOutput(
					doc
						.createAccessor()
						.setType("VEC4")
						.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]))
						.setBuffer(buffer),
				);
			anim
				.addSampler(rot)
				.addChannel(
					doc
						.createAnimationChannel()
						.setTargetNode(target)
						.setTargetPath("rotation")
						.setSampler(rot),
				);
		}
	}
	await writeFile(path, await new NodeIO().writeBinary(doc));
}

const deg = (r) => (r * 180) / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angle = (a, b) =>
	deg(
		Math.acos(
			(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) /
				Math.sqrt(
					(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) *
						(b[0] * b[0] + b[1] * b[1] + b[2] * b[2]),
				),
		),
	);

/**
 * World positions of `nodes` ([{name, parent, translation, rotation, scale}], parent-first),
 * with `rot` (name -> quaternion) overriding the local rotations.
 */
function fkPositions(nodes, rot = new Map()) {
	const wr = new Map();
	const ws = new Map();
	const wp = new Map();
	for (const n of nodes) {
		const r = rot.get(n.name) ?? n.rotation;
		if (!n.parent) {
			wr.set(n.name, r);
			ws.set(n.name, n.scale);
			wp.set(n.name, n.translation);
			continue;
		}
		const ps = ws.get(n.parent);
		const t = qrot(
			wr.get(n.parent),
			n.translation.map((v, i) => v * ps[i]),
		);
		wp.set(
			n.name,
			wp.get(n.parent).map((v, i) => v + t[i]),
		);
		wr.set(n.name, qmul(wr.get(n.parent), r));
		ws.set(
			n.name,
			ps.map((v, i) => v * n.scale[i]),
		);
	}
	return wp;
}

/** Local rotations of `clip` (AnimationClipData) at key index `k` (clamped per track). */
function clipPose(clip, k) {
	const m = new Map();
	for (const t of clip.tracks) {
		if (t.path !== "rotation") continue;
		const i = Math.min(k, t.times.length - 1);
		m.set(t.node, Array.from(t.values.subarray(i * 4, i * 4 + 4)));
	}
	return m;
}

/** Leg and arm angles (degrees) of pose `rot`, measured in world space against `baseRot`. */
function limbAngles(nodes, rot, baseRot) {
	const base = fkPositions(nodes, baseRot);
	const p = fkPositions(nodes, rot);
	const dir = (pos, a, b) => sub(pos.get(b), pos.get(a));
	const thigh = dir(p, "Bip01 L Thigh", "Bip01 L Calf");
	const shin = dir(p, "Bip01 L Calf", "Bip01 L Foot");
	const fwd = sub(base.get("Bip01 L Toe0"), base.get("Bip01 L Foot"));
	fwd[1] = 0;
	const left = sub(base.get("Bip01 L Thigh"), base.get("Bip01 R Thigh"));
	const arm0 = dir(base, "Bip01 L UpperArm", "Bip01 L Forearm");
	const arm = dir(p, "Bip01 L UpperArm", "Bip01 L Forearm");
	const thigh0 = dir(base, "Bip01 L Thigh", "Bip01 L Calf");
	return {
		knee: angle(thigh, shin),
		thighFlex: angle(thigh0, thigh),
		thighForward: thigh[0] * fwd[0] + thigh[1] * fwd[1] + thigh[2] * fwd[2],
		armRaise: angle(arm0, arm),
		armOut:
			(arm[0] - arm0[0]) * left[0] +
			(arm[1] - arm0[1]) * left[1] +
			(arm[2] - arm0[2]) * left[2],
	};
}

/** quaternion for `d` degrees about a unit axis. */
const aa = (axis, d) => {
	const h = (d * Math.PI) / 360;
	return [...axis.map((v) => v * Math.sin(h)), Math.cos(h)];
};
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];

/**
 * The BIPED skeleton (plus RootNode > Bip01), every bone given an arbitrary world rotation the
 * way 3ds Max biped bones have arbitrary local axes; world positions are unchanged.
 */
function twistedSkeleton() {
	const world = [
		{ name: "RootNode", parent: null, pos: [0, 0, 0] },
		{ name: "Bip01", parent: "RootNode", pos: [0, 90, 0] },
		{ name: "Bip01 Footsteps", parent: "Bip01", pos: [0, 0, 0] },
	];
	const at = new Map(world.map((w) => [w.name, w.pos]));
	for (const [name, parent, t] of BIPED) {
		const pos = at.get(parent).map((v, i) => v + t[i]);
		at.set(name, pos);
		world.push({ name, parent, pos });
	}
	const wr = new Map();
	const nodes = [];
	world.forEach((w, i) => {
		const r = aa([0.6, 0.48, 0.64], 37 * i);
		wr.set(w.name, r);
		const pr = w.parent ? wr.get(w.parent) : [0, 0, 0, 1];
		const pp = w.parent ? at.get(w.parent) : [0, 0, 0];
		nodes.push({
			name: w.name,
			parent: w.parent,
			translation: w.parent ? qrot(qinv(pr), sub(w.pos, pp)) : w.pos,
			rotation: w.parent ? qmul(qinv(pr), r) : r,
			scale: [1, 1, 1],
		});
	});
	return nodes;
}

describe("airborne clips", () => {
	const nodes = twistedSkeleton();
	const { jump, fall } = airborneClips({ nodes });

	it("Jump plays 0.4-1.0 s and Fall is one seamless loop", () => {
		expect(jump.name).toBe("Jump");
		expect(fall.name).toBe("Fall");
		expect(jump.duration).toBeGreaterThanOrEqual(0.4);
		expect(jump.duration).toBeLessThanOrEqual(1.0);
		for (const t of fall.tracks) {
			const n = t.path === "rotation" ? 4 : 3;
			const last = t.values.length - n;
			expect(Array.from(t.values.subarray(last))).toEqual(
				Array.from(t.values.subarray(0, n)),
			);
			expect(t.times[t.times.length - 1]).toBeCloseTo(fall.duration, 6);
		}
	});

	it("every track targets the Bip01 hierarchy (not Footsteps); hips translation only", () => {
		const subtree = new Set(
			nodes
				.filter(
					(n) => n.name.startsWith("Bip01") && n.name !== "Bip01 Footsteps",
				)
				.map((n) => n.name),
		);
		for (const clip of [jump, fall])
			for (const t of clip.tracks) {
				expect(subtree.has(t.node)).toBe(true);
				if (t.path !== "rotation") {
					expect(t.path).toBe("translation");
					expect(t.node).toBe("Bip01");
				}
			}
	});

	it("Jump peaks in a natural tuck: knees ~60°, thighs ~45° forward, arms up ~30° outward", () => {
		const peak = jump.tracks.find((t) => t.times.length > 2);
		const k = peak.times.findIndex((x) => x >= 0.25 - 1e-6);
		const a = limbAngles(nodes, clipPose(jump, k));
		expect(a.knee).toBeGreaterThan(55);
		expect(a.knee).toBeLessThan(65);
		expect(a.thighFlex).toBeGreaterThan(40);
		expect(a.thighFlex).toBeLessThan(50);
		expect(a.thighForward).toBeGreaterThan(0);
		expect(a.armRaise).toBeGreaterThan(25);
		expect(a.armRaise).toBeLessThan(45);
		expect(a.armOut).toBeGreaterThan(0);
		// Frame 0 is the base (Idle frame 0) pose.
		const rest = limbAngles(nodes, clipPose(jump, 0));
		expect(rest.knee).toBeLessThan(1);
		expect(rest.armRaise).toBeLessThan(1);
	});

	it("Fall holds a bent-knee tuck through the loop", () => {
		const n = fall.tracks.find((t) => t.times.length > 2).times.length;
		for (let k = 0; k < n; k++) {
			const a = limbAngles(nodes, clipPose(fall, k));
			expect(a.knee).toBeGreaterThan(40);
			expect(a.knee).toBeLessThan(60);
			expect(a.armOut).toBeGreaterThan(0);
		}
	});

	it("rejects a skeleton without the biped limbs", () => {
		expect(() =>
			airborneClips({
				nodes: nodes.filter((x) => x.name !== "Bip01 L Calf"),
			}),
		).toThrow(/Bip01 L Calf/);
	});
});

describe("build-rocketbox", () => {
	let tmp;
	let sources;
	beforeEach(async () => {
		tmp = await mkdtemp(join(tmpdir(), "rocketbox-test-"));
		sources = {};
		for (const k of SOURCE_KEYS) {
			const p = join(tmp, `${k}.src`);
			await writeFile(
				p,
				k.endsWith("_color") || k.endsWith("_normal") || k.endsWith("_specular")
					? tga()
					: "fbx",
			);
			sources[k] = p;
		}
	});
	afterEach(async () => {
		await rm(tmp, { recursive: true, force: true });
	});

	it("fails loudly on a converter error", async () => {
		const out = join(tmp, "out.glb");
		const tools = {
			convert: async () => {
				throw new Error("converter exploded");
			},
			encodeKtx2: async () => {
				throw new Error("not reached");
			},
		};
		await expect(buildRocketbox({ sources, out, tools })).rejects.toThrow(
			/converter exploded/,
		);
		expect(existsSync(out)).toBe(false);
	});

	it("fails loudly on an encoder error after a successful conversion", async () => {
		const out = join(tmp, "out.glb");
		const tools = {
			convert: async (input, glb) => fixtureGlb(glb, input !== sources.avatar),
			encodeKtx2: async () => {
				throw new Error("encoder exploded");
			},
		};
		await expect(buildRocketbox({ sources, out, tools })).rejects.toThrow(
			/encoder exploded/,
		);
		expect(existsSync(out)).toBe(false);
	});

	it("builds with stub tools: KTX2 textures, clips, alphaHash only with an opacity map", async () => {
		const out = join(tmp, "out.glb");
		sources.head_opacity = join(tmp, "head_opacity.src");
		await writeFile(sources.head_opacity, tga());
		const roles = [];
		const tools = {
			convert: async (input, glb) => fixtureGlb(glb, input !== sources.avatar),
			encodeKtx2: async (png, ktx2, role) => {
				expect(existsSync(png)).toBe(true);
				roles.push(role);
				await writeFile(ktx2, "KTX2-stub");
			},
		};
		await buildRocketbox({ sources, out, tools });
		const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
		const r = (await io.read(out)).getRoot();
		expect(r.listAnimations().map((a) => a.getName())).toEqual([
			"Idle",
			"Walk",
			"Run",
			"Jump",
			"Fall",
		]);
		for (const t of r.listTextures())
			expect(t.getMimeType()).toBe("image/ktx2");
		expect(roles.sort()).toEqual(
			[
				"color",
				"colorAlpha",
				"normal",
				"normal",
				"roughness",
				"roughness",
			].sort(),
		);
		const mat = (n) => r.listMaterials().find((m) => m.getName() === n);
		expect(mat("m019_head").getAlphaMode()).toBe("MASK");
		expect(mat("m019_head").getExtras()).toEqual({ alphaHash: true });
		expect(mat("m019_body").getAlphaMode()).toBe("OPAQUE");
		expect(mat("m019_body").getExtras()).toEqual({});
		// Walk root motion (hips Z 0 -> 100) is stripped to the clip's frame-0 XZ (5, 0);
		// the height (90) stays.
		const walk = r.listAnimations().find((a) => a.getName() === "Walk");
		const hips = walk
			.listChannels()
			.find((c) => c.getTargetPath() === "translation");
		expect(Array.from(hips.getSampler().getOutput().getArray())).toEqual([
			5, 90, 0, 5, 90, 0,
		]);
	});

	it("builds an `_opacity` hair-card material from the RGBA opacity_color source, capped by maxTexture", async () => {
		const out = join(tmp, "out.glb");
		sources.opacity_color = join(tmp, "opacity_color.src");
		await writeFile(sources.opacity_color, tga(256, 32));
		for (const k of ["body_color", "head_color"])
			await writeFile(sources[k], tga(256));
		const sizes = [];
		const tools = {
			convert: async (input, glb) =>
				fixtureGlb(glb, input !== sources.avatar, undefined, [
					"f004_body",
					"f004_head",
					"f004_opacity",
				]),
			encodeKtx2: async (png, ktx2, role) => {
				const b = await readFile(png);
				// PNG IHDR: width at 16, colour type at 25 (2 = RGB, 6 = RGBA)
				sizes.push([role, b.readUInt32BE(16), b[25]]);
				await writeFile(ktx2, "KTX2-stub");
			},
		};
		await buildRocketbox({ sources, out, tools, maxTexture: 64 });
		expect(sizes.filter(([r]) => r === "color")).toEqual([
			["color", 64, 2],
			["color", 64, 2],
		]);
		expect(sizes.filter(([r]) => r === "colorAlpha")).toEqual([
			["colorAlpha", 64, 6],
		]);
		const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
		const r = (await io.read(out)).getRoot();
		const hair = r.listMaterials().find((m) => m.getName() === "f004_opacity");
		expect(hair.getAlphaMode()).toBe("MASK");
		expect(hair.getDoubleSided()).toBe(true);
		expect(hair.getNormalTexture()).toBe(null);
		expect(hair.getBaseColorTexture()).not.toBe(null);
		const body = r.listMaterials().find((m) => m.getName() === "f004_body");
		expect(body.getAlphaMode()).toBe("OPAQUE");
	});

	it("--atlas packs body (top) and head (bottom) into one square map and one material", async () => {
		const out = join(tmp, "out.glb");
		for (const k of SOURCE_KEYS)
			if (/_(color|normal|specular)$/.test(k))
				await writeFile(sources[k], tga(8));
		const sizes = [];
		const tools = {
			convert: async (input, glb) => fixtureGlb(glb, input !== sources.avatar),
			encodeKtx2: async (png, ktx2, role) => {
				const b = await readFile(png);
				sizes.push([role, b.readUInt32BE(16), b.readUInt32BE(20)]);
				await writeFile(ktx2, "KTX2-stub");
			},
		};
		await buildRocketbox({ sources, out, tools, atlas: true });
		expect(sizes.sort()).toEqual([
			["color", 8, 8],
			["normal", 8, 8],
			["roughness", 8, 8],
		]);
		const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
		const r = (await io.read(out)).getRoot();
		expect(r.listMaterials().map((m) => m.getName())).toEqual(["m019_atlas"]);
		const prims = r.listMeshes().flatMap((m) => m.listPrimitives());
		const vRange = [];
		for (const p of prims) {
			expect(p.getMaterial().getName()).toBe("m019_atlas");
			const a = p.getAttribute("TEXCOORD_0").getArray();
			const v = [a[1], a[3], a[5]];
			vRange.push([Math.min(...v), Math.max(...v)]);
		}
		// body squashed into v 0..0.5, head into 0.5..1 (u untouched)
		expect(vRange.sort()).toEqual([
			[0, 0.5],
			[0.5, 1],
		]);
	});

	it("--simplify welds and simplifies, and still writes a readable GLB", async () => {
		const out = join(tmp, "out.glb");
		const tools = {
			convert: async (input, glb) =>
				input === sources.avatar
					? fixtureGlb(glb, false, undefined, undefined, 8)
					: fixtureGlb(glb, true),
			encodeKtx2: async (_png, ktx2) => writeFile(ktx2, "KTX2-stub"),
		};
		await buildRocketbox({ sources, out, tools, simplifyRatio: 0.5 });
		const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
		const r = (await io.read(out)).getRoot();
		const prims = r.listMeshes().flatMap((m) => m.listPrimitives());
		expect(prims.length).toBeGreaterThan(0);
		for (const p of prims) {
			// welded (indexed) and simplified: a flat 8x8 sheet (128 triangles) collapses
			const idx = p.getIndices();
			expect(idx).not.toBeNull();
			expect(idx.getCount() / 3).toBeGreaterThan(0);
			expect(idx.getCount() / 3).toBeLessThanOrEqual(64);
			expect(p.getAttribute("POSITION").getCount()).toBeLessThan(8 * 8 * 6);
		}
		expect(r.listAnimations().length).toBeGreaterThan(0);
	});

	it("--simplify rejects ratios outside (0, 1)", async () => {
		const out = join(tmp, "out.glb");
		const tools = { convert: async () => {}, encodeKtx2: async () => {} };
		await expect(
			buildRocketbox({ sources, out, tools, simplifyRatio: 1.5 }),
		).rejects.toThrow(/simplify/);
	});

	it("rejects an `_opacity` material without an opacity_color source, and a bad maxTexture", async () => {
		const out = join(tmp, "out.glb");
		const tools = {
			convert: async (input, glb) =>
				fixtureGlb(glb, input !== sources.avatar, undefined, [
					"f004_body",
					"f004_opacity",
				]),
			encodeKtx2: async (_png, ktx2) => writeFile(ktx2, "KTX2-stub"),
		};
		await expect(buildRocketbox({ sources, out, tools })).rejects.toThrow(
			/opacity_color/,
		);
		await expect(
			buildRocketbox({ sources, out, tools, maxTexture: 1000 }),
		).rejects.toThrow(/max-texture/);
		expect(existsSync(out)).toBe(false);
	});

	it("rejects a clip that animates a bone whose Assimp helper chain was collapsed", async () => {
		const out = join(tmp, "out.glb");
		const tools = {
			convert: async (input, glb) =>
				fixtureGlb(
					glb,
					input !== sources.avatar,
					input === sources.walk ? "Bip01 L Thigh" : undefined,
				),
			encodeKtx2: async (_png, ktx2) => writeFile(ktx2, "KTX2-stub"),
		};
		await expect(buildRocketbox({ sources, out, tools })).rejects.toThrow(
			/Bip01 L Thigh.*helper/,
		);
		expect(existsSync(out)).toBe(false);
	});

	it("rejects a missing source", async () => {
		const out = join(tmp, "out.glb");
		delete sources.walk;
		const tools = { convert: async () => {}, encodeKtx2: async () => {} };
		await expect(buildRocketbox({ sources, out, tools })).rejects.toThrow(
			/walk/,
		);
		expect(existsSync(out)).toBe(false);
	});

	const manifest = JSON.parse(
		readFileSync(join(root, "apps/playground/assets.manifest.json"), "utf8"),
	);
	const entry = manifest.assets.find((a) => a.id === ROCKETBOX_ID);
	const realSources = entry
		? Object.fromEntries(
				SOURCE_KEYS.map((k) => [
					k,
					k === "avatar"
						? sourceCachePath(root, entry.id, null, entry.url)
						: entry.derive?.sources?.[k]
							? sourceCachePath(root, entry.id, k, entry.derive.sources[k].url)
							: null,
				]),
			)
		: null;
	const tools = cachedTools();
	const missing = !realSources
		? "no rocketbox manifest entry"
		: !Object.values(realSources).every((p) => p && existsSync(p))
			? "rocketbox sources not cached (run pnpm fetch-assets)"
			: !tools
				? "KTX-Software not cached (run pnpm fetch-assets)"
				: null;

	it.skipIf(missing)(
		`output has required clips and scale${missing ? ` (skipped: ${missing})` : ""}`,
		async () => {
			const out = join(tmp, "real.glb");
			await buildRocketbox({ sources: realSources, out, tools });
			const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
			const doc = await io.read(out);
			const r = doc.getRoot();
			const clips = r.listAnimations().map((a) => a.getName());
			expect(clips).toEqual(
				expect.arrayContaining(["Idle", "Walk", "Run", "Jump", "Fall"]),
			);
			const anim = (name) =>
				r.listAnimations().find((a) => a.getName() === name);
			const duration = (a) =>
				Math.max(...a.listSamplers().map((s) => s.getInput().getMax([])[0]));
			expect(duration(anim("Jump"))).toBeGreaterThanOrEqual(0.4);
			expect(duration(anim("Jump"))).toBeLessThanOrEqual(1.0);
			const hips = r.listNodes().find((n) => n.getName() === "Bip01");
			const inHips = (n) => {
				for (let p = n; p; p = p.getParentNode()) if (p === hips) return true;
				return false;
			};
			for (const a of r.listAnimations())
				for (const c of a.listChannels()) {
					const node = c.getTargetNode();
					// Every track targets the Bip01 hierarchy; only the hips translate.
					expect(inHips(node), `${a.getName()} -> ${node.getName()}`).toBe(
						true,
					);
					if (node !== hips) expect(c.getTargetPath()).toBe("rotation");
				}
			// Walk/Run root motion is gone: hips X and Z are constant.
			for (const name of ["Walk", "Run"]) {
				const t = anim(name)
					.listChannels()
					.find((c) => c.getTargetPath() === "translation")
					.getSampler()
					.getOutput()
					.getArray();
				for (let i = 0; i < t.length; i += 3) {
					expect(t[i]).toBe(t[0]);
					expect(t[i + 2]).toBe(t[2]);
				}
			}
			// The Jump peak on the real (twisted-axis) Bip01 skeleton is a natural tuck.
			const skel = [];
			const walk = (n, parent) => {
				skel.push({
					name: n.getName(),
					parent,
					translation: n.getTranslation(),
					rotation: n.getRotation(),
					scale: n.getScale(),
				});
				for (const c of n.listChildren()) walk(c, n.getName());
			};
			for (const n of r.listScenes()[0].listChildren()) walk(n, null);
			const jump = anim("Jump");
			const times = jump
				.listChannels()
				.map((c) => c.getSampler().getInput().getArray())
				.find((t) => t.length > 2);
			const poseAt = (k) => {
				const pose = new Map();
				for (const c of jump.listChannels()) {
					if (c.getTargetPath() !== "rotation") continue;
					const o = c.getSampler().getOutput().getArray();
					const i = Math.min(k, o.length / 4 - 1);
					pose.set(
						c.getTargetNode().getName(),
						Array.from(o.subarray(i * 4, i * 4 + 4)),
					);
				}
				return pose;
			};
			const rest = poseAt(0);
			const a = limbAngles(
				skel,
				poseAt(times.findIndex((x) => x >= 0.25 - 1e-6)),
				rest,
			);
			// Idle frame 0 already bends the knee a little; the jump adds ~60°.
			const kneeRest = limbAngles(skel, rest, rest).knee;
			expect(a.knee - kneeRest).toBeGreaterThan(55);
			expect(a.knee - kneeRest).toBeLessThan(65);
			expect(a.thighFlex).toBeGreaterThan(40);
			expect(a.thighFlex).toBeLessThan(50);
			expect(a.thighForward).toBeGreaterThan(0);
			expect(a.armRaise).toBeGreaterThan(25);
			expect(a.armRaise).toBeLessThan(45);
			expect(a.armOut).toBeGreaterThan(0);
			const b = getBounds(r.listScenes()[0]);
			expect(Math.abs(b.max[1] - b.min[1] - 1.75)).toBeLessThanOrEqual(0.02);
			expect(Math.abs(b.min[1])).toBeLessThanOrEqual(0.01);
			const textures = r.listTextures();
			expect(textures.length).toBeGreaterThan(0);
			for (const t of textures) expect(t.getMimeType()).toBe("image/ktx2");
			expect(r.listExtensionsUsed().map((e) => e.extensionName)).toContain(
				"KHR_texture_basisu",
			);
			const glb = await readFile(out);
			const json = JSON.parse(
				glb.subarray(20, 20 + glb.readUInt32LE(12)).toString(),
			);
			for (const t of json.textures)
				expect(t.extensions?.KHR_texture_basisu?.source).toBeTypeOf("number");
			// KTX2 supercompressionScheme (header offset 44): normals UASTC + zstd (2),
			// colour and roughness ETC1S / BasisLZ (1).
			const scheme = (tex) => Buffer.from(tex.getImage()).readUInt32LE(44);
			for (const m of r.listMaterials()) {
				expect(scheme(m.getNormalTexture()), `${m.getName()} normal`).toBe(2);
				expect(scheme(m.getBaseColorTexture()), `${m.getName()} colour`).toBe(
					1,
				);
				expect(
					scheme(m.getMetallicRoughnessTexture()),
					`${m.getName()} roughness`,
				).toBe(1);
			}
		},
		600_000,
	);
});

describe("parseCliArgs", () => {
	it("parses the output, sources and options", () => {
		expect(
			parseCliArgs([
				"out.glb",
				"avatar=a.fbx",
				"--max-texture=512",
				"--simplify=0.4",
				"--atlas",
			]),
		).toEqual({
			out: "out.glb",
			sources: { avatar: "a.fbx" },
			maxTexture: 512,
			simplifyRatio: 0.4,
			atlas: true,
		});
	});

	it("rejects unknown options instead of taking them as sources", () => {
		expect(() => parseCliArgs(["out.glb", "--foo=bar"])).toThrow(
			/unknown option/,
		);
		expect(() => parseCliArgs(["out.glb", "--simplfy=0.5"])).toThrow(
			/unknown option/,
		);
		expect(() => parseCliArgs(["out.glb", "nope"])).toThrow(/bad source/);
		expect(() => parseCliArgs([])).toThrow(/usage/);
	});
});

describe("decodeTga", () => {
	it("returns RGB by default and RGBA from a 32-bit file with keepAlpha", () => {
		expect(Array.from(decodeTga(tga(1, 32)).data)).toEqual([3, 2, 1]);
		expect(Array.from(decodeTga(tga(1, 32), true).data)).toEqual([3, 2, 1, 4]);
		// a 24-bit file stays RGB even with keepAlpha
		expect(decodeTga(tga(1), true).data.length).toBe(3);
	});
});

describe("rocketboxEntry", () => {
	const textures = [
		"f004_body_color.tga",
		"f004_body_normal.tga",
		"f004_body_specular.tga",
		"f004_head_color.tga",
		"f004_head_normal.tga",
		"f004_head_specular.tga",
		"f004_opacity_color.tga",
	];
	it("builds a pinned-commit entry with the avatar's prefix, sex-matched clips and options", () => {
		const e = rocketboxEntry("Female_Adult_04", textures, {
			walk: "f_walk_injured",
			maxTexture: 1024,
		});
		expect(e.id).toBe("character-rocketbox-female-adult-04");
		expect(e.file).toBe("rocketbox-female-adult-04.glb");
		expect(e.license).toBe("MIT");
		expect(e.url).toMatch(
			/Microsoft-Rocketbox\/[0-9a-f]{40}\/Assets\/Avatars\/Adults\/Female_Adult_04\/Export\/Female_Adult_04\.fbx$/,
		);
		const s = e.derive.sources;
		expect(s.body_color.url).toMatch(/Textures\/f004_body_color\.tga$/);
		expect(s.opacity_color.url).toMatch(/f004_opacity_color\.tga$/);
		expect(s.idle.url).toMatch(/motextr_static\/f_idle_neutral_01\.max\.fbx$/);
		expect(s.walk.url).toMatch(/motextr_xy\/f_walk_injured\.max\.fbx$/);
		expect(s.run.url).toMatch(/motextr_xy\/f_run_fast_01\.max\.fbx$/);
		const step = e.derive.steps[0];
		expect(step).toContain("opacity_color={source:opacity_color}");
		expect(step.at(-1)).toBe("--max-texture=1024");
		for (const k of SOURCE_KEYS)
			if (k !== "avatar") expect(step).toContain(`${k}={source:${k}}`);
	});
	it("omits the opacity source when the avatar has none and rejects non-adult ids", () => {
		const e = rocketboxEntry(
			"Male_Adult_18",
			textures
				.filter((t) => !t.includes("opacity"))
				.map((t) => t.replace("f004", "m023")),
		);
		expect(e.derive.sources.opacity_color).toBeUndefined();
		expect(e.derive.sources.idle.url).toMatch(/m_idle_neutral_01/);
		expect(() => rocketboxEntry("Child_01", textures)).toThrow(/adult/);
	});
});

describe("manifest Rocketbox entries", () => {
	const manifest = JSON.parse(
		readFileSync(join(root, "apps/playground/assets.manifest.json"), "utf8"),
	);
	const rb = manifest.assets.filter(
		(a) => a.derive?.tool === "rocketbox-build",
	);
	it("pin every source by sha256 and carry an MIT licence and attribution", () => {
		expect(rb.length).toBeGreaterThanOrEqual(5);
		for (const a of rb) {
			expect(a.sourceSha256, a.id).toMatch(/^[0-9a-f]{64}$/);
			expect(a.sha256, a.id).toMatch(/^[0-9a-f]{64}$/);
			expect(a.license, a.id).toBe("MIT");
			expect(a.attribution, a.id).toMatch(/Microsoft Rocketbox/);
			for (const [k, src] of Object.entries(a.derive.sources)) {
				expect(src.sha256, `${a.id} ${k}`).toMatch(/^[0-9a-f]{64}$/);
				expect(src.url, `${a.id} ${k}`).toMatch(/\/[0-9a-f]{40}\//);
			}
		}
	});
});
