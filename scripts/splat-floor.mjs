#!/usr/bin/env node
// Floor-alignment helper for a splat capture (Task 8). Loads a splat with three's own loader,
// applies a candidate transform and reports, per XZ cell, a robust low-percentile Y of the
// opaque splats (the floor surface), plus a least-squares plane fit with outlier rejection.
// A level, metric floor at y = 0 has a ≈ b ≈ 0 and c ≈ 0.
//
// Usage: node scripts/splat-floor.mjs <file.spz|.ply> [--rot qx,qy,qz,qw] [--scale s]
//        [--pos x,y,z] [--cell 2] [--pct 0.05] [--min-alpha 0.5] [--min-count 400]
//        [--region x0,z0,x1,z1]   (report only cells inside; the plane fit uses them too)
import { readFileSync } from "node:fs";
import { Matrix4, Quaternion, Vector3 } from "three";
import { GaussianSplatPLYLoader } from "three/addons/loaders/GaussianSplatPLYLoader.js";
import { SPZLoader } from "three/addons/loaders/SPZLoader.js";

const argv = process.argv.slice(2);
const file = argv[0];
const opt = (name, def) => {
	const i = argv.indexOf(`--${name}`);
	return i < 0 ? def : argv[i + 1];
};
const nums = (s) => s.split(",").map(Number);
const rot = nums(opt("rot", "1,0,0,0"));
const scale = Number(opt("scale", "1"));
const pos = nums(opt("pos", "0,0,0"));
const CELL = Number(opt("cell", "2"));
const PCT = Number(opt("pct", "0.05"));
const MIN_ALPHA = Number(opt("min-alpha", "0.5"));
const MIN_COUNT = Number(opt("min-count", "400"));
const REGION = opt("region", undefined)?.split(",").map(Number);

const bytes = readFileSync(file);
const buffer = bytes.buffer.slice(
	bytes.byteOffset,
	bytes.byteOffset + bytes.length,
);
const geometry = file.endsWith(".ply")
	? new GaussianSplatPLYLoader().parse(buffer)
	: await new SPZLoader().parse(buffer);
const P = geometry.getAttribute("position");
const C = geometry.getAttribute("color");
const m = new Matrix4().compose(
	new Vector3(...pos),
	new Quaternion(...rot),
	new Vector3(scale, scale, scale),
);
const v = new Vector3();
const cells = new Map();
let kept = 0;
for (let i = 0; i < P.count; i++) {
	if (C.getW(i) < MIN_ALPHA) continue;
	v.fromBufferAttribute(P, i).applyMatrix4(m);
	const k = `${Math.floor(v.x / CELL)},${Math.floor(v.z / CELL)}`;
	const ys = cells.get(k);
	if (ys) ys.push(v.y);
	else cells.set(k, [v.y]);
	kept++;
}
console.log(`${P.count} splats, ${kept} with alpha >= ${MIN_ALPHA}`);
const rows = [];
for (const [k, ys] of cells) {
	if (ys.length < MIN_COUNT) continue;
	ys.sort((a, b) => a - b);
	const [cx, cz] = k.split(",").map(Number);
	const x = (cx + 0.5) * CELL;
	const z = (cz + 0.5) * CELL;
	if (
		REGION &&
		(x < REGION[0] || z < REGION[1] || x > REGION[2] || z > REGION[3])
	)
		continue;
	rows.push({
		x,
		z,
		y: ys[Math.floor(ys.length * PCT)],
	});
}
const xs = [...new Set(rows.map((r) => r.x))].sort((a, b) => a - b);
const zs = [...new Set(rows.map((r) => r.z))].sort((a, b) => a - b);
console.log(`floor y (p${PCT * 100}) per ${CELL} m cell; rows z, columns x`);
console.log(`z\\x   ${xs.map((x) => x.toFixed(0).padStart(6)).join("")}`);
for (const z of zs)
	console.log(
		`${z.toFixed(0).padStart(5)} ${xs
			.map((x) => {
				const r = rows.find((q) => q.x === x && q.z === z);
				return r ? r.y.toFixed(2).padStart(6) : "     .";
			})
			.join("")}`,
	);
// y = a x + b z + c, refit 4x dropping cells beyond 3 MAD (furniture, walls, trees).
const det3 = (M) =>
	M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
	M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
	M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
let use = rows;
for (let it = 0; it < 4 && use.length >= 3; it++) {
	const A = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	];
	const B = [0, 0, 0];
	for (const r of use) {
		const f = [r.x, r.z, 1];
		for (let i = 0; i < 3; i++) {
			B[i] += f[i] * r.y;
			for (let j = 0; j < 3; j++) A[i][j] += f[i] * f[j];
		}
	}
	const D = det3(A);
	const [a, b, c] = [0, 1, 2].map(
		(col) =>
			det3(A.map((row, i) => row.map((x, j) => (j === col ? B[i] : x)))) / D,
	);
	const res = use.map((r) => r.y - (a * r.x + b * r.z + c));
	const abs = res.map(Math.abs).sort((p, q) => p - q);
	const mad = abs[Math.floor(abs.length / 2)];
	const deg = (t) => ((Math.atan(t) * 180) / Math.PI).toFixed(2);
	console.log(
		`fit ${it}: y = ${a.toFixed(4)} x + ${b.toFixed(4)} z + ${c.toFixed(3)}  (cells ${use.length}, median |res| ${mad.toFixed(3)} m, tilt x ${deg(a)} deg, z ${deg(b)} deg)`,
	);
	use = use.filter((_, i) => Math.abs(res[i]) < 3 * mad + 0.02);
}
