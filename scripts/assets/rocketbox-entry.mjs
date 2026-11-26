#!/usr/bin/env node
// Adds (or replaces) the assets.manifest.json entry for a Microsoft Rocketbox adult avatar, built
// by the `rocketbox-build` derive tool (scripts/assets/build-rocketbox.mjs):
//
//   node scripts/assets/rocketbox-entry.mjs <AvatarId> [--file <name.glb>]
//        [--idle <clip>] [--walk <clip>] [--run <clip>] [--max-texture <px>]
//        [--simplify <ratio>] [--atlas 1]
//
// e.g. `Female_Adult_04 --walk f_walk_injured --max-texture 1024`. Clips are Rocketbox
// animation names without `.max.fbx` (idle from the `motextr_static` export, walk/run from
// `motextr_xy`, which carries the root motion the build measures); they default to the
// neutral idle/walk/fast run of the avatar's sex (`m_`/`f_`). The avatar's texture prefix
// (`m011`, `f004`...) and whether it has an `opacity_color` map come from the GitHub API at
// the pinned commit. URLs are written without sha256s: run
// `pnpm fetch-assets --update-hashes` next, which downloads, hashes and pins every source and
// the derived GLB (then plain `pnpm fetch-assets` verifies them).
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(root, "apps/playground/assets.manifest.json");
export const ROCKETBOX_COMMIT = "0943055db6ec570bcef9f2c8b41c9e5467c808f9";
const RAW = `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${ROCKETBOX_COMMIT}/Assets`;
const API = `https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets`;
const LICENSE_URL = `https://github.com/microsoft/Microsoft-Rocketbox/blob/${ROCKETBOX_COMMIT}/LICENSE.md`;

/**
 * The manifest entry for `avatar` given its texture file names (pure; tested).
 * `opts`: { file?, idle?, walk?, run?, maxTexture? }.
 */
export function rocketboxEntry(avatar, textureNames, opts = {}) {
	const m = /^(Male|Female)_Adult_(\d\d)$/.exec(avatar);
	if (!m) throw new Error(`not a Rocketbox adult avatar id: "${avatar}"`);
	const sex = m[1] === "Male" ? "m" : "f";
	const prefix = textureNames
		.map((n) => /^([mf]\d{3})_body_color\.tga$/.exec(n)?.[1])
		.find(Boolean);
	if (!prefix) throw new Error(`${avatar}: no <prefix>_body_color.tga texture`);
	const clips = {
		idle: opts.idle ?? `${sex}_idle_neutral_01`,
		walk: opts.walk ?? `${sex}_walk_neutral_01`,
		run: opts.run ?? `${sex}_run_fast_01`,
	};
	const slug = avatar.toLowerCase().replaceAll("_", "-");
	const tex = (n) => ({
		url: `${RAW}/Avatars/Adults/${avatar}/Textures/${prefix}_${n}.tga`,
	});
	const sources = {};
	for (const part of ["body", "head"])
		for (const kind of ["color", "normal", "specular"])
			sources[`${part}_${kind}`] = tex(`${part}_${kind}`);
	const opacity = textureNames.includes(`${prefix}_opacity_color.tga`);
	if (opacity) sources.opacity_color = tex("opacity_color");
	sources.idle = {
		url: `${RAW}/Animations/all_animations_max_motextr_static/${clips.idle}.max.fbx`,
	};
	for (const k of ["walk", "run"])
		sources[k] = {
			url: `${RAW}/Animations/all_animations_max_motextr_xy/${clips[k]}.max.fbx`,
		};
	const step = ["{out}", "avatar={source}"];
	for (const k of Object.keys(sources)) step.push(`${k}={source:${k}}`);
	if (opts.maxTexture !== undefined)
		step.push(`--max-texture=${opts.maxTexture}`);
	if (opts.simplify !== undefined) step.push(`--simplify=${opts.simplify}`);
	if (opts.atlas) step.push("--atlas");
	const size =
		(opts.maxTexture !== undefined
			? `, textures capped at ${opts.maxTexture} px (normals ${opts.maxTexture / 2}, roughness ${opts.maxTexture / 4})`
			: "") +
		(opts.simplify !== undefined
			? `, meshes simplified to ~${Math.round(opts.simplify * 100)} % of the triangles (meshoptimizer)`
			: "") +
		(opts.atlas ? ", body and head maps atlased into one material" : "");
	return {
		id: `character-rocketbox-${slug}`,
		_comment: `Clips: Idle = ${clips.idle}, Walk = ${clips.walk}, Run = ${clips.run} (hips XZ root motion removed); Jump and Fall are procedural (airborne-clips.mjs). Built by scripts/assets/rocketbox-entry.mjs${size}.`,
		url: `${RAW}/Avatars/Adults/${avatar}/Export/${avatar}.fbx`,
		derive: { tool: "rocketbox-build", sources, steps: [step] },
		license: "MIT",
		attribution: `${avatar} avatar and animations ${clips.idle}, ${clips.walk}, ${clips.run} from the Microsoft Rocketbox Avatar Library, Copyright (c) 2020 Microsoft, MIT License (${LICENSE_URL}). Modified: converted FBX/TGA to GLB with assimpjs and KTX-Software 4.4.2 (KTX2)${size}, animations merged with root motion removed, scaled to 1.75 m, roughness derived from the specular map, procedural Jump and Fall clips added (scripts/assets/build-rocketbox.mjs, scripts/assets/airborne-clips.mjs).`,
		file: opts.file ?? `rocketbox-${slug}.glb`,
	};
}

async function main() {
	const [avatar, ...rest] = process.argv.slice(2);
	if (!avatar) throw new Error("usage: rocketbox-entry.mjs <AvatarId> [...]");
	const opts = {};
	for (let i = 0; i < rest.length; i += 2) {
		const k = rest[i];
		const v = rest[i + 1];
		if (v === undefined) throw new Error(`${k} needs a value`);
		if (k === "--file") opts.file = v;
		else if (k === "--idle") opts.idle = v;
		else if (k === "--walk") opts.walk = v;
		else if (k === "--run") opts.run = v;
		else if (k === "--max-texture") opts.maxTexture = Number(v);
		else if (k === "--simplify") opts.simplify = Number(v);
		else if (k === "--atlas") {
			opts.atlas = v === "1" || v === "true";
		} else throw new Error(`unknown argument "${k}"`);
	}
	const res = await fetch(
		`${API}/Avatars/Adults/${avatar}/Textures?ref=${ROCKETBOX_COMMIT}`,
		{ headers: { "user-agent": "pebble3d-fetch-assets" } },
	);
	if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
	const names = (await res.json()).map((x) => x.name);
	const entry = rocketboxEntry(avatar, names, opts);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	const i = manifest.assets.findIndex((a) => a.id === entry.id);
	if (i >= 0) manifest.assets[i] = entry;
	else manifest.assets.push(entry);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log(
		`${entry.id}: ${i >= 0 ? "replaced" : "added"}; now run pnpm fetch-assets --update-hashes`,
	);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
	main().catch((e) => {
		console.error(e instanceof Error ? e.message : e);
		process.exit(1);
	});
