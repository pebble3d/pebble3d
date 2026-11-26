#!/usr/bin/env node
// Builds an animated, KTX2-textured GLB of a Microsoft Rocketbox avatar (MIT; first used for
// "Male_Adult_16", now any adult avatar) from its pinned FBX/TGA sources, with open-source
// tools only:
//  - FBX -> glTF: assimpjs (Assimp compiled to WebAssembly, pinned devDependency), in-process.
//  - KTX2: `ktx create` from KTX-Software (pinned release, sha256-checked download into
//    node_modules/.cache/pebble3d-tools/), single-threaded so the output is byte-reproducible.
//  - glTF editing: @gltf-transform (pinned).
//
// fetch-assets runs this as the `rocketbox-build` derive tool:
//   build-rocketbox.mjs <out.glb> <key>=<path> ... [--max-texture=<px>] [--simplify=<ratio>]
// one key per SOURCE_KEYS entry, plus the optional OPTIONAL_SOURCE_KEYS. Every source path has
// already been sha256-verified by fetch-assets. --max-texture caps the colour maps at <px>
// (normals at <px>/2, roughness at <px>/4), for crowd avatars with a smaller texture budget.
// --simplify keeps about <ratio> of the triangles (meshoptimizer edge collapse after a weld;
// it only drops vertices, so skin weights and UVs stay exact), for crowds seen from afar.
// --atlas packs the body and head maps into one square map (body in the top half, head in
// the bottom half, each at half vertical resolution: WebGPU sampled a non-square KTX2 atlas
// as blank) under one material and joins their primitives: one draw per clone and pass.
// `scripts/assets/rocketbox-entry.mjs <AvatarId>` writes the manifest entry for an avatar.
//
// Pipeline:
//  1. Convert the avatar FBX and each clip FBX to GLB (separately).
//  2. Collapse Assimp's `<bone>_$AssimpFbx$_*` pivot helper chains into the bone itself.
//     Assimp writes the hips' (Bip01) animation as the complete transform relative to the chain's
//     parent, so leaving the helpers in would apply their offset twice.
//  3. Merge the clips onto the avatar skeleton by bone name, keeping rotation tracks only plus
//     the hips' translation; walk/run root motion (hips XZ) is measured, logged and removed
//     (held at the clip's frame-0 XZ). A clip may not animate any bone other than the hips
//     whose helper chain was collapsed (its track would be relative to the removed pivots).
//  3b. Add the procedural Jump and Fall clips (airborne-clips.mjs), keyed from Idle frame 0.
//  4. Scale the model to stand 1.75 m tall with its feet at y = 0.
//  5. Decode the TGA textures, derive roughness from the 3ds Max specular map
//     (1 - 0.55 * spec, min 0.45, metalness 0) and encode KTX2: ETC1S colour and roughness,
//     UASTC normals. A material named `*_opacity` (hair cards, lashes) takes the RGBA
//     `opacity_color` source as its alpha-tested, double-sided colour map, with no normal or
//     roughness map.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { getBounds, NodeIO, PropertyType } from "@gltf-transform/core";
import { KHRTextureBasisu } from "@gltf-transform/extensions";
import {
	dedup,
	join as joinPrimitives,
	prune,
	resample,
	simplify,
	weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { airborneClips } from "./airborne-clips.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const toolCache = join(root, "node_modules/.cache/pebble3d-tools");

/** Source keys buildRocketbox expects (fetch-assets passes each as key=path). */
export const SOURCE_KEYS = [
	"avatar",
	"body_color",
	"body_normal",
	"body_specular",
	"head_color",
	"head_normal",
	"head_specular",
	"idle",
	"walk",
	"run",
];

/** Optional sources: alpha maps (see the material loop). */
export const OPTIONAL_SOURCE_KEYS = [
	"opacity_color",
	"head_opacity",
	"body_opacity",
];

/** GLB clip name -> source key. Jump and Fall are procedural (airborne-clips.mjs). */
const CLIPS = { Idle: "idle", Walk: "walk", Run: "run" };
/** Clips whose hips XZ carries root motion (from the `motextr_xy` export). */
const ROOT_MOTION = new Set(["Walk", "Run"]);
const HIPS = "Bip01";
const TARGET_HEIGHT = 1.75;
/** Texture sizes; the 2048² sources are box-downsampled. Est. GPU memory ≈ 14.6 MB. */
const SIZE = { color: 2048, colorAlpha: 2048, normal: 1024, roughness: 512 };

const KTX = {
	version: "4.4.2",
	url: "https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Linux-x86_64.tar.bz2",
	sha256: "a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245",
	dir: "KTX-Software-4.4.2-Linux-x86_64",
	// Extracted files, verified on every use (the cache is not trusted).
	files: {
		"bin/ktx":
			"2028e023a18e827e66362a9e184052f40192566b10f92655a337e2eb8ea0829b",
		"lib/libktx.so.4.4.2":
			"0792dd32ce7d2a101d614a3d1dc1f2b4297869d9cab5d7f0bb4fee304c4c9bcc",
	},
};

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const log = (...a) => console.log("rocketbox:", ...a);

// ---------------------------------------------------------------------------------------------
// Tools

/** FBX -> GLB with assimpjs (in-process WebAssembly). Throws on failure. */
async function assimpConvert(input, outGlb) {
	const require = createRequire(import.meta.url);
	const assimpjs = require("assimpjs");
	const ajs = await assimpjs();
	const files = new ajs.FileList();
	files.AddFile(basename(input), await readFile(input));
	const result = ajs.ConvertFileList(files, "glb2");
	if (!result.IsSuccess() || result.FileCount() !== 1)
		throw new Error(
			`assimpjs failed on ${input}: ${result.GetErrorCode?.() ?? "unknown error"}`,
		);
	await writeFile(outGlb, Buffer.from(result.GetFile(0).GetContent()));
}

function ktxPaths() {
	const dir = join(toolCache, `ktx-${KTX.version}`, KTX.dir);
	return { dir, bin: join(dir, "bin/ktx"), lib: join(dir, "lib") };
}

async function ktxVerified() {
	const { dir } = ktxPaths();
	for (const [f, hash] of Object.entries(KTX.files)) {
		const p = join(dir, f);
		if (!existsSync(p) || sha256(await readFile(p)) !== hash) return false;
	}
	return true;
}

/** Downloads (sha256-checked) and extracts the pinned KTX-Software release if needed. */
async function ensureKtx() {
	if (process.platform !== "linux" || process.arch !== "x64")
		throw new Error(
			`KTX-Software ${KTX.version} is pinned for linux-x64 only (got ${process.platform}-${process.arch})`,
		);
	if (await ktxVerified()) return ktxPaths();
	const base = join(toolCache, `ktx-${KTX.version}`);
	await rm(base, { recursive: true, force: true });
	await mkdir(base, { recursive: true });
	log(`downloading ${KTX.url}`);
	const res = await fetch(KTX.url, {
		headers: { "user-agent": "pebble3d-fetch-assets" },
	});
	if (!res.ok) throw new Error(`${KTX.url}: HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (sha256(buf) !== KTX.sha256)
		throw new Error(
			`${KTX.url}: sha256 mismatch (expected ${KTX.sha256}, got ${sha256(buf)})`,
		);
	const tar = join(base, basename(KTX.url));
	await writeFile(tar, buf);
	const members = [
		`${KTX.dir}/bin/ktx`,
		`${KTX.dir}/lib/libktx.so`,
		`${KTX.dir}/lib/libktx.so.4`,
		`${KTX.dir}/lib/libktx.so.4.4.2`,
	];
	const r = spawnSync("tar", ["-xjf", tar, "-C", base, "--", ...members], {
		stdio: "inherit",
	});
	await rm(tar, { force: true });
	if (r.status !== 0) throw new Error(`tar exited ${r.status}`);
	if (!(await ktxVerified())) {
		await rm(base, { recursive: true, force: true });
		throw new Error("KTX-Software extracted files failed sha256 verification");
	}
	return ktxPaths();
}

/** `ktx create` argv for a texture role. Single-threaded: byte-reproducible output. */
export function ktxCreateArgs(role, inPng, outKtx2) {
	const common = ["create", "--threads", "1", "--generate-mipmap"];
	const roles = {
		color: [
			"--format",
			"R8G8B8_SRGB",
			"--encode",
			"basis-lz",
			"--clevel",
			"2",
			"--qlevel",
			"192",
		],
		colorAlpha: [
			"--format",
			"R8G8B8A8_SRGB",
			"--encode",
			"basis-lz",
			"--clevel",
			"2",
			"--qlevel",
			"192",
		],
		roughness: [
			"--format",
			"R8G8B8_UNORM",
			"--assign-tf",
			"linear",
			"--encode",
			"basis-lz",
			"--clevel",
			"2",
			"--qlevel",
			"192",
		],
		normal: [
			"--format",
			"R8G8B8_UNORM",
			"--assign-tf",
			"linear",
			"--normalize",
			"--encode",
			"uastc",
			"--uastc-quality",
			"2",
			"--zstd",
			"18",
		],
	};
	if (!roles[role]) throw new Error(`unknown texture role "${role}"`);
	return [...common, ...roles[role], inPng, outKtx2];
}

function ktxEncoder({ bin, lib }) {
	return async (inPng, outKtx2, role) => {
		const r = spawnSync(bin, ktxCreateArgs(role, inPng, outKtx2), {
			encoding: "utf8",
			env: { ...process.env, LD_LIBRARY_PATH: lib },
		});
		if (r.status !== 0)
			throw new Error(
				`ktx create (${role}) failed on ${inPng} (exit ${r.status}):\n${r.stdout}${r.stderr}`,
			);
		if (!existsSync(outKtx2))
			throw new Error(`ktx create (${role}) wrote no ${outKtx2}`);
	};
}

/** The real tools, downloading KTX-Software if needed. */
export async function realTools() {
	return { convert: assimpConvert, encodeKtx2: ktxEncoder(await ensureKtx()) };
}

/** The real tools if KTX-Software is already cached (offline), else null. For tests. */
export function cachedTools() {
	const { dir } = ktxPaths();
	const ok = Object.entries(KTX.files).every(([f, hash]) => {
		const p = join(dir, f);
		return existsSync(p) && sha256(readFileSync(p)) === hash;
	});
	return ok
		? { convert: assimpConvert, encodeKtx2: ktxEncoder(ktxPaths()) }
		: null;
}

// ---------------------------------------------------------------------------------------------
// Images

/** Uncompressed 24/32-bit TGA -> top-down RGB (RGBA with `keepAlpha` and a 32-bit file). */
export function decodeTga(buf, keepAlpha = false) {
	const idLen = buf[0];
	const type = buf[2];
	const w = buf.readUInt16LE(12);
	const h = buf.readUInt16LE(14);
	const bpp = buf[16];
	const desc = buf[17];
	if (type !== 2 || (bpp !== 24 && bpp !== 32))
		throw new Error(`unsupported TGA type ${type}/${bpp}bpp`);
	const ch = bpp / 8;
	const topDown = (desc & 0x20) !== 0;
	const src = 18 + idLen;
	if (buf.length < src + w * h * ch) throw new Error("truncated TGA");
	const oc = keepAlpha && ch === 4 ? 4 : 3;
	const data = Buffer.alloc(w * h * oc);
	for (let y = 0; y < h; y++) {
		const sy = topDown ? y : h - 1 - y;
		for (let x = 0; x < w; x++) {
			const s = src + (sy * w + x) * ch;
			const d = (y * w + x) * oc;
			data[d] = buf[s + 2];
			data[d + 1] = buf[s + 1];
			data[d + 2] = buf[s];
			if (oc === 4) data[d + 3] = buf[s + 3];
		}
	}
	return { data, w, h };
}

/** Box-filter downsample by an integer factor (exact, deterministic). */
function downsample(img, size) {
	if (img.w === size && img.h === size) return img;
	const f = img.w / size;
	if (img.w !== img.h || !Number.isInteger(f) || f < 1)
		throw new Error(`cannot downsample ${img.w}x${img.h} to ${size}`);
	const ch = img.data.length / (img.w * img.h);
	const data = Buffer.alloc(size * size * ch);
	const n = f * f;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++)
			for (let c = 0; c < ch; c++) {
				let sum = 0;
				for (let dy = 0; dy < f; dy++)
					for (let dx = 0; dx < f; dx++)
						sum += img.data[((y * f + dy) * img.w + x * f + dx) * ch + c];
				data[(y * size + x) * ch + c] = Math.round(sum / n);
			}
	return { data, w: size, h: size };
}

/** Renormalizes tangent-space normals after filtering. */
function renormalize(img) {
	const d = img.data;
	for (let i = 0; i < d.length; i += 3) {
		const x = d[i] / 127.5 - 1;
		const y = d[i + 1] / 127.5 - 1;
		const z = d[i + 2] / 127.5 - 1;
		// Not Math.hypot: its result is implementation-defined; sqrt is IEEE-exact.
		const l = Math.sqrt(x * x + y * y + z * z) || 1;
		d[i] = Math.round((x / l + 1) * 127.5);
		d[i + 1] = Math.round((y / l + 1) * 127.5);
		d[i + 2] = Math.round((z / l + 1) * 127.5);
	}
	return img;
}

/** Specular -> glTF metallic-roughness: G = roughness (1 - 0.55·spec, min 0.45), B = metal 0. */
function roughnessFromSpecular(img) {
	const d = Buffer.alloc(img.data.length);
	for (let i = 0; i < d.length; i += 3) {
		const s =
			(0.2126 * img.data[i] +
				0.7152 * img.data[i + 1] +
				0.0722 * img.data[i + 2]) /
			255;
		d[i] = 255; // occlusion channel (unused)
		d[i + 1] = Math.round(255 * Math.min(1, Math.max(0.45, 1 - 0.55 * s)));
		d[i + 2] = 0;
	}
	return { data: d, w: img.w, h: img.h };
}

/** RGB colour + an opacity map's luminance -> RGBA. */
function withAlpha(color, opacity) {
	if (color.w !== opacity.w || color.h !== opacity.h)
		throw new Error("opacity map size differs from the colour map");
	const n = color.w * color.h;
	const data = Buffer.alloc(n * 4);
	for (let i = 0; i < n; i++) {
		color.data.copy(data, i * 4, i * 3, i * 3 + 3);
		const o = opacity.data;
		data[i * 4 + 3] = Math.round(
			0.2126 * o[i * 3] + 0.7152 * o[i * 3 + 1] + 0.0722 * o[i * 3 + 2],
		);
	}
	return { data, w: color.w, h: color.h };
}

/** RGB8/RGBA8 -> PNG (no ancillary chunks, fixed zlib settings: deterministic). */
export function encodePng({ data, w, h }) {
	const ch = data.length / (w * h);
	if (ch !== 3 && ch !== 4) throw new Error(`encodePng: ${ch} channels`);
	const chunk = (type, body) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(body.length);
		const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(tb));
		return Buffer.concat([len, tb, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = ch === 4 ? 6 : 2; // RGBA : RGB
	const row = w * ch;
	const raw = Buffer.alloc(h * (row + 1));
	for (let y = 0; y < h; y++)
		data.copy(raw, y * (row + 1) + 1, y * row, (y + 1) * row);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw, { level: 6 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ---------------------------------------------------------------------------------------------
// glTF

/**
 * Assimp's GLB references the FBX's original (Windows, absolute-ish) texture paths and uses
 * extensions gltf-transform cannot read. Textures are rebuilt from the TGA sources anyway, so
 * drop the image references and extensions before parsing.
 */
function sanitizeGlb(buf) {
	if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67)
		throw new Error("converter output is not a GLB");
	const len = buf.readUInt32LE(12);
	const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8"));
	delete json.images;
	delete json.textures;
	delete json.samplers;
	for (const m of json.materials ?? []) {
		delete m.normalTexture;
		delete m.occlusionTexture;
		delete m.emissiveTexture;
		delete m.extensions;
		if (m.pbrMetallicRoughness) {
			delete m.pbrMetallicRoughness.baseColorTexture;
			delete m.pbrMetallicRoughness.metallicRoughnessTexture;
		}
	}
	delete json.extensionsUsed;
	delete json.extensionsRequired;
	for (const mesh of json.meshes ?? [])
		for (const p of mesh.primitives) delete p.extensions;
	let js = Buffer.from(JSON.stringify(json), "utf8");
	js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
	const rest = buf.subarray(20 + len);
	const head = Buffer.alloc(20);
	head.writeUInt32LE(0x46546c67, 0);
	head.writeUInt32LE(2, 4);
	head.writeUInt32LE(20 + js.length + rest.length, 8);
	head.writeUInt32LE(js.length, 12);
	head.writeUInt32LE(0x4e4f534a, 16);
	return Buffer.concat([head, js, rest]);
}

const isHelper = (n) => n.getName().includes("$AssimpFbx$");

/**
 * Folds each chain of Assimp pivot helpers into the first real node below it. Returns the names
 * of the nodes that had a chain.
 */
function collapseHelpers(doc) {
	const collapsed = new Set();
	const nodes = doc.getRoot().listNodes();
	for (const n of nodes) {
		if (isHelper(n)) continue;
		let top = n.getParentNode();
		if (!top || !isHelper(top)) continue;
		while (top.getParentNode() && isHelper(top.getParentNode()))
			top = top.getParentNode();
		const parent = top.getParentNode();
		collapsed.add(n.getName());
		// Local matrix of n relative to the chain's parent: helper chain * n.
		const m = mul(chainMatrix(top, n), n.getMatrix());
		n.setMatrix(m);
		if (parent) parent.addChild(n);
		else {
			for (const s of doc.getRoot().listScenes())
				if (s.listChildren().includes(top)) s.addChild(n);
		}
	}
	// Every real node has been lifted out of the helper chains; drop the helpers.
	for (const n of doc.getRoot().listNodes()) {
		if (!isHelper(n)) continue;
		if (n.getMesh() || n.getSkin())
			throw new Error(`unexpected mesh on pivot helper "${n.getName()}"`);
		n.dispose();
	}
	return collapsed;
}

/** Product of local matrices from `top` down to (excluding) `n`. */
function chainMatrix(top, n) {
	const path = [];
	for (let p = n.getParentNode(); p; p = p.getParentNode()) {
		path.unshift(p);
		if (p === top) break;
	}
	let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	for (const p of path) m = mul(m, p.getMatrix());
	return m;
}

/** Column-major 4x4 multiply a·b. */
function mul(a, b) {
	const o = new Array(16).fill(0);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++)
			for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
	return o;
}

/** Hips XZ ground speed (source units/s) from a clip's hips translation track. */
function rootMotionSpeed(times, xyz) {
	const n = times.length;
	if (n < 2) return 0;
	const dx = xyz[(n - 1) * 3] - xyz[0];
	const dz = xyz[(n - 1) * 3 + 2] - xyz[2];
	return Math.sqrt(dx * dx + dz * dz) / (times[n - 1] - times[0]);
}

/**
 * Copies the clip at `srcDoc` onto `doc`'s skeleton by bone name. `collapsed`: names of bones
 * whose Assimp helper chain was collapsed (in the avatar or this clip). Returns stats.
 */
function mergeClip(doc, srcDoc, clip, byName, collapsed) {
	const buffer = doc.getRoot().listBuffers()[0];
	const srcAnim = srcDoc.getRoot().listAnimations()[0];
	if (!srcAnim) throw new Error(`${clip}: source has no animation`);
	const anim = doc.createAnimation(clip);
	const rotated = new Set();
	let speed = null;
	let hipsXZ = null;
	const copy = (acc) =>
		doc
			.createAccessor()
			.setType(acc.getType())
			.setArray(acc.getArray().slice())
			.setBuffer(buffer);
	const add = (target, path, input, output, interpolation) => {
		const sampler = doc
			.createAnimationSampler()
			.setInput(input)
			.setOutput(output)
			.setInterpolation(interpolation);
		anim
			.addSampler(sampler)
			.addChannel(
				doc
					.createAnimationChannel()
					.setTargetNode(target)
					.setTargetPath(path)
					.setSampler(sampler),
			);
	};
	for (const c of srcAnim.listChannels()) {
		const name = c.getTargetNode()?.getName();
		const path = c.getTargetPath();
		const target = byName.get(name);
		if (!target || name === "Bip01 Footsteps") continue;
		// Rotations only, plus the hips' translation (its height), so the source skeleton's
		// bone lengths never override the avatar's.
		if (path !== "rotation" && !(path === "translation" && name === HIPS))
			continue;
		// Only the hips' chain (and the mesh node's) is known to be folded correctly: Assimp
		// writes the hips' track as the full transform relative to the chain's parent.
		if (name !== HIPS && collapsed.has(name))
			throw new Error(
				`${clip}: "${name}" is animated but had an Assimp helper chain collapsed`,
			);
		const s = c.getSampler();
		const input = copy(s.getInput());
		const output = copy(s.getOutput());
		if (path === "translation") {
			const o = output.getArray();
			speed = rootMotionSpeed(input.getArray(), o);
			let sx = 0;
			let sz = 0;
			for (let i = 0; i < o.length; i += 3) {
				sx += o[i];
				sz += o[i + 2];
			}
			hipsXZ = {
				first: [o[0], o[2]],
				mean: [sx / (o.length / 3), sz / (o.length / 3)],
			};
			if (ROOT_MOTION.has(clip)) {
				// Strip root motion: hold the clip's frame-0 XZ, keep the hips' height.
				const [x0, z0] = [o[0], o[2]];
				for (let i = 0; i < o.length; i += 3) {
					o[i] = x0;
					o[i + 2] = z0;
				}
			}
		}
		if (path === "rotation") rotated.add(name);
		add(target, path, input, output, s.getInterpolation());
	}
	if (!rotated.has(HIPS)) throw new Error(`${clip}: no ${HIPS} rotation track`);
	// Bones present in the clip but without a rotation track hold the clip's pose.
	const end = Math.max(
		...anim.listSamplers().map((x) => x.getInput().getMax([])[0]),
	);
	for (const n of srcDoc.getRoot().listNodes()) {
		const target = byName.get(n.getName());
		if (
			!target ||
			rotated.has(n.getName()) ||
			n.getName() === "Bip01 Footsteps"
		)
			continue;
		if (
			!doc
				.getRoot()
				.listSkins()
				.some((sk) => sk.listJoints().includes(target))
		)
			continue;
		const r = n.getRotation();
		add(
			target,
			"rotation",
			doc
				.createAccessor()
				.setType("SCALAR")
				.setArray(new Float32Array([0, end]))
				.setBuffer(buffer),
			doc
				.createAccessor()
				.setType("VEC4")
				.setArray(new Float32Array([...r, ...r]))
				.setBuffer(buffer),
			"LINEAR",
		);
	}
	return { channels: anim.listChannels().length, duration: end, speed, hipsXZ };
}

/** Adds an airborne-clips AnimationClipData to `doc` as a LINEAR animation. */
function addClip(doc, data, byName) {
	const buffer = doc.getRoot().listBuffers()[0];
	const anim = doc.createAnimation(data.name);
	for (const t of data.tracks) {
		const target = byName.get(t.node);
		if (!target) throw new Error(`${data.name}: no node "${t.node}"`);
		const sampler = doc
			.createAnimationSampler()
			.setInput(
				doc
					.createAccessor()
					.setType("SCALAR")
					.setArray(t.times)
					.setBuffer(buffer),
			)
			.setOutput(
				doc
					.createAccessor()
					.setType(t.path === "rotation" ? "VEC4" : "VEC3")
					.setArray(t.values)
					.setBuffer(buffer),
			)
			.setInterpolation("LINEAR");
		anim
			.addSampler(sampler)
			.addChannel(
				doc
					.createAnimationChannel()
					.setTargetNode(target)
					.setTargetPath(t.path)
					.setSampler(sampler),
			);
	}
	return { channels: anim.listChannels().length, duration: data.duration };
}

/**
 * The avatar skeleton (every node under the scene roots, parent-first) posed at the first frame
 * of animation `anim`: the base pose of the procedural clips.
 */
function skeletonAtFirstFrame(doc, anim) {
	const first = new Map();
	for (const c of anim.listChannels()) {
		const o = c.getSampler().getOutput().getArray();
		const n = c.getTargetPath() === "rotation" ? 4 : 3;
		first.set(
			`${c.getTargetNode().getName()}:${c.getTargetPath()}`,
			Array.from(o.subarray(0, n)),
		);
	}
	const nodes = [];
	const visit = (n, parent) => {
		const name = n.getName();
		nodes.push({
			name,
			parent,
			translation: first.get(`${name}:translation`) ?? n.getTranslation(),
			rotation: first.get(`${name}:rotation`) ?? n.getRotation(),
			scale: n.getScale(),
		});
		for (const c of n.listChildren()) visit(c, name);
	};
	for (const n of doc.getRoot().listScenes()[0].listChildren()) visit(n, null);
	return { nodes };
}

// ---------------------------------------------------------------------------------------------
// Build

/**
 * Builds the avatar GLB at `out`. `sources` maps every SOURCE_KEYS entry to a verified local
 * file; `tools.convert(fbx, outGlb)` and `tools.encodeKtx2(png, outKtx2, role)` do the
 * conversions (role: "color" | "normal" | "roughness"). Any failure rejects and leaves no file
 * at `out` (it is written to a temporary name and renamed only after a complete build).
 */
export async function buildRocketbox({
	sources,
	out,
	tools,
	maxTexture,
	simplifyRatio,
	atlas = false,
}) {
	for (const k of SOURCE_KEYS)
		if (typeof sources?.[k] !== "string" || !existsSync(sources[k]))
			throw new Error(`rocketbox: missing source "${k}"`);
	for (const k of OPTIONAL_SOURCE_KEYS)
		if (sources[k] !== undefined && !existsSync(sources[k]))
			throw new Error(`rocketbox: missing source "${k}"`);
	if (
		maxTexture !== undefined &&
		!(Number.isInteger(Math.log2(maxTexture)) && maxTexture >= 64)
	)
		throw new Error(`rocketbox: --max-texture must be a power of two >= 64`);
	if (simplifyRatio !== undefined && !(simplifyRatio > 0 && simplifyRatio < 1))
		throw new Error("rocketbox: --simplify must be in (0, 1)");
	const cap = {
		color: maxTexture ?? Infinity,
		colorAlpha: maxTexture ?? Infinity,
		normal: (maxTexture ?? Infinity) / 2,
		roughness: (maxTexture ?? Infinity) / 4,
	};
	const tmp = await mkdtemp(join(tmpdir(), "pebble3d-rocketbox-"));
	const part = `${out}.building`;
	try {
		const io = new NodeIO().registerExtensions([KHRTextureBasisu]);
		const convert = async (key) => {
			const glb = join(tmp, `${key}.glb`);
			await tools.convert(sources[key], glb);
			if (!existsSync(glb))
				throw new Error(`converter wrote no GLB for ${key}`);
			const doc = await io.readBinary(
				new Uint8Array(sanitizeGlb(await readFile(glb))),
			);
			return { doc, collapsed: collapseHelpers(doc) };
		};

		const { doc, collapsed: avatarCollapsed } = await convert("avatar");
		log(
			`avatar helper chains collapsed on: ${[...avatarCollapsed].join(", ")}`,
		);
		const r = doc.getRoot();
		if (r.listBuffers().length === 0) doc.createBuffer();
		for (const a of r.listAnimations()) a.dispose(); // the avatar's 1-frame "Take 001"
		const byName = new Map(r.listNodes().map((n) => [n.getName(), n]));
		if (!byName.has(HIPS)) throw new Error(`avatar has no ${HIPS} node`);

		const stats = {};
		for (const [clip, key] of Object.entries(CLIPS)) {
			const src = await convert(key);
			stats[clip] = mergeClip(
				doc,
				src.doc,
				clip,
				byName,
				new Set([...avatarCollapsed, ...src.collapsed]),
			);
			const s = stats[clip];
			const xz = s.hipsXZ;
			const f = (v) => v.map((x) => x.toFixed(3)).join(", ");
			log(
				`${clip} <- ${basename(sources[key])}: ${s.channels} channels, ${s.duration.toFixed(2)} s, authored hips XZ speed ${(s.speed ?? 0).toFixed(3)} src-units/s` +
					(xz ? `, hips XZ frame 0 (${f(xz.first)}) mean (${f(xz.mean)})` : ""),
			);
		}
		const idle = r.listAnimations().find((a) => a.getName() === "Idle");
		const air = airborneClips(skeletonAtFirstFrame(doc, idle));
		for (const data of [air.jump, air.fall]) {
			stats[data.name] = addClip(doc, data, byName);
			log(
				`${data.name} (procedural): ${stats[data.name].channels} channels, ${data.duration.toFixed(2)} s`,
			);
		}

		// Scale to TARGET_HEIGHT with feet at y = 0 (rest pose), via the scene root(s).
		const scene = r.listScenes()[0];
		const b0 = getBounds(scene);
		const height = b0.max[1] - b0.min[1];
		if (!(height > 0)) throw new Error("avatar has empty bounds");
		const k = TARGET_HEIGHT / height;
		for (const n of scene.listChildren()) {
			n.setScale(n.getScale().map((v) => v * k));
			const t = n.getTranslation();
			n.setTranslation([t[0] * k, t[1] * k - b0.min[1] * k, t[2] * k]);
		}
		log(`scaled ${height.toFixed(2)} -> ${TARGET_HEIGHT} m (x${k.toFixed(5)})`);
		for (const clip of ROOT_MOTION)
			log(
				`${clip} authored ground speed at avatar scale: ${((stats[clip].speed ?? 0) * k).toFixed(3)} m/s`,
			);

		// Textures.
		doc.createExtension(KHRTextureBasisu).setRequired(true);
		const encoded = new Map();
		const encode = async (key, role) => {
			const id = `${key}:${role}`;
			if (encoded.has(id)) return encoded.get(id);
			// `opacity_color` is itself RGBA; a `<part>_opacity` map adds alpha to `<part>_color`.
			const rgba = key === "opacity_color";
			let img = decodeTga(await readFile(sources[key]), rgba);
			if (rgba && img.data.length !== img.w * img.h * 4)
				throw new Error("opacity_color must be a 32-bit (RGBA) TGA");
			if (role === "roughness") img = roughnessFromSpecular(img);
			if (role === "colorAlpha" && !rgba)
				img = withAlpha(
					img,
					decodeTga(await readFile(sources[key.replace("_color", "_opacity")])),
				);
			img = downsample(img, Math.min(SIZE[role], cap[role], img.w));
			if (role === "normal") renormalize(img);
			const png = join(tmp, `${key}-${role}.png`);
			const ktx2 = join(tmp, `${key}-${role}.ktx2`);
			await writeFile(png, encodePng(img));
			await tools.encodeKtx2(png, ktx2, role);
			const tex = doc
				.createTexture(`${key.replace(/_\w+$/, "")}_${role}`)
				.setImage(new Uint8Array(await readFile(ktx2)))
				.setMimeType("image/ktx2");
			encoded.set(id, tex);
			return tex;
		};
		/** Body (top) and head (bottom) of one role, each squashed 2:1 vertically. */
		const encodeAtlas = async (kind, role) => {
			const halves = [];
			for (const part of ["body", "head"]) {
				let img = decodeTga(await readFile(sources[`${part}_${kind}`]));
				if (role === "roughness") img = roughnessFromSpecular(img);
				img = downsample(img, Math.min(SIZE[role], cap[role], img.w));
				if (role === "normal") renormalize(img);
				halves.push(img);
			}
			const [b, h] = halves;
			if (b.w !== h.w || b.h !== h.h)
				throw new Error(`atlas: body/head ${kind} sizes differ`);
			const w = b.w;
			const ch = b.data.length / (w * b.h);
			const data = Buffer.alloc(b.data.length);
			const half = b.h / 2;
			halves.forEach((img, k) => {
				for (let y = 0; y < half; y++)
					for (let x = 0; x < w * ch; x++) {
						const a0 = img.data[2 * y * w * ch + x];
						const a1 = img.data[(2 * y + 1) * w * ch + x];
						data[(k * half + y) * w * ch + x] = (a0 + a1 + 1) >> 1;
					}
			});
			if (role === "normal") renormalize({ data, w, h: b.h });
			const png = join(tmp, `atlas-${role}.png`);
			const ktx2 = join(tmp, `atlas-${role}.ktx2`);
			await writeFile(png, encodePng({ data, w, h: b.h }));
			await tools.encodeKtx2(png, ktx2, role);
			return doc
				.createTexture(`atlas_${role}`)
				.setImage(new Uint8Array(await readFile(ktx2)))
				.setMimeType("image/ktx2");
		};
		if (atlas) {
			const mats = r.listMaterials();
			const body = mats.find((m) => /_body$/i.test(m.getName()));
			const head = mats.find((m) => /_head$/i.test(m.getName()));
			if (!body || !head)
				throw new Error("atlas: needs _body and _head materials");
			if (sources.head_opacity || sources.body_opacity)
				throw new Error("atlas: per-part opacity maps are not supported");
			body
				.setName(body.getName().replace(/_body$/i, "_atlas"))
				.setBaseColorTexture(await encodeAtlas("color", "color"))
				.setBaseColorFactor([1, 1, 1, 1])
				.setNormalTexture(await encodeAtlas("normal", "normal"))
				.setMetallicRoughnessTexture(await encodeAtlas("specular", "roughness"))
				.setMetallicFactor(0)
				.setRoughnessFactor(1)
				.setEmissiveFactor([0, 0, 0])
				.setDoubleSided(false)
				.setAlphaMode("OPAQUE");
			for (const mesh of r.listMeshes())
				for (const prim of mesh.listPrimitives()) {
					const m = prim.getMaterial();
					if (m !== body && m !== head) continue;
					const uv = prim.getAttribute("TEXCOORD_0");
					if (!uv) throw new Error("atlas: primitive without TEXCOORD_0");
					const copy = uv.clone();
					const a = copy.getArray();
					const off = m === head ? 0.5 : 0;
					for (let i = 1; i < a.length; i += 2) a[i] = off + a[i] * 0.5;
					copy.setArray(a);
					prim.setAttribute("TEXCOORD_0", copy);
					prim.setMaterial(body);
				}
			head.dispose();
		}
		for (const m of r.listMaterials()) {
			const name = m.getName().toLowerCase();
			if (name.endsWith("_atlas")) continue;
			if (name.endsWith("_opacity")) {
				// Hair cards / lashes: their own RGBA colour map, alpha-tested, both faces.
				if (!sources.opacity_color)
					throw new Error(
						`material ${m.getName()} needs the "opacity_color" source`,
					);
				m.setBaseColorTexture(await encode("opacity_color", "colorAlpha"))
					.setBaseColorFactor([1, 1, 1, 1])
					.setNormalTexture(null)
					.setMetallicRoughnessTexture(null)
					.setMetallicFactor(0)
					.setRoughnessFactor(0.75)
					.setEmissiveFactor([0, 0, 0])
					.setDoubleSided(true)
					.setAlphaMode("MASK")
					.setAlphaCutoff(0.5)
					.setExtras({ alphaHash: true });
				continue;
			}
			const part = name.includes("head") ? "head" : "body";
			// An optional `<part>_opacity` source (hair cards etc.) becomes the colour's alpha.
			const opacity = Boolean(sources[`${part}_opacity`]);
			m.setBaseColorTexture(
				await encode(`${part}_color`, opacity ? "colorAlpha" : "color"),
			)
				.setBaseColorFactor([1, 1, 1, 1])
				.setNormalTexture(await encode(`${part}_normal`, "normal"))
				.setMetallicRoughnessTexture(
					await encode(`${part}_specular`, "roughness"),
				)
				.setMetallicFactor(0)
				.setRoughnessFactor(1)
				.setEmissiveFactor([0, 0, 0])
				.setDoubleSided(false);
			if (opacity) {
				// Alpha-tested; the renderer should draw it with three.js `alphaHash`
				// (GLTFLoader copies `extras` into material.userData).
				m.setAlphaMode("MASK")
					.setAlphaCutoff(0.5)
					.setExtras({ alphaHash: true });
			} else m.setAlphaMode("OPAQUE");
		}
		// Assimp writes a constant COLOR_0, which only costs memory and a shader variant.
		for (const mesh of r.listMeshes())
			for (const prim of mesh.listPrimitives())
				prim.setAttribute("COLOR_0", null);
		if (simplifyRatio !== undefined) {
			await MeshoptSimplifier.ready;
			const tris = () =>
				r
					.listMeshes()
					.flatMap((m) => m.listPrimitives())
					.reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
			const before = tris();
			await doc.transform(
				weld(),
				simplify({
					simplifier: MeshoptSimplifier,
					ratio: simplifyRatio,
					error: 0.004,
				}),
			);
			log(`simplified ${before} -> ${tris()} triangles`);
		}
		// Textures are already unique (one per source and role), so dedup skips them.
		await doc.transform(
			resample(),
			...(atlas ? [joinPrimitives()] : []),
			prune(),
			dedup({
				propertyTypes: [
					PropertyType.ACCESSOR,
					PropertyType.MESH,
					PropertyType.MATERIAL,
					PropertyType.SKIN,
				],
			}),
		);
		await writeFile(part, await io.writeBinary(doc));
		await rename(part, out);
		log(`wrote ${out}`);
		return stats;
	} finally {
		await rm(tmp, { recursive: true, force: true });
		await rm(part, { force: true });
	}
}

// ---------------------------------------------------------------------------------------------
// CLI

/**
 * Parses the CLI arguments after the script path: `<out.glb> key=path ... [--max-texture=<px>]
 * [--simplify=<ratio>] [--atlas]`. Unknown `--` options are an error (not a source key).
 */
export function parseCliArgs(argv) {
	const [out, ...pairs] = argv;
	if (!out || out.startsWith("--"))
		throw new Error("usage: build-rocketbox.mjs <out.glb> key=path ...");
	const sources = {};
	let maxTexture;
	let simplifyRatio;
	let atlas = false;
	for (const p of pairs) {
		if (p.startsWith("--max-texture=")) {
			maxTexture = Number(p.slice("--max-texture=".length));
			continue;
		}
		if (p === "--atlas") {
			atlas = true;
			continue;
		}
		if (p.startsWith("--simplify=")) {
			simplifyRatio = Number(p.slice("--simplify=".length));
			continue;
		}
		if (p.startsWith("-")) throw new Error(`unknown option "${p}"`);
		const i = p.indexOf("=");
		if (i <= 0) throw new Error(`bad source argument "${p}"`);
		sources[p.slice(0, i)] = p.slice(i + 1);
	}
	return { out, sources, maxTexture, simplifyRatio, atlas };
}

async function main() {
	const args = parseCliArgs(process.argv.slice(2));
	await buildRocketbox({ ...args, tools: await realTools() });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
