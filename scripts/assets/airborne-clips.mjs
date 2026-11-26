// Procedural `Jump` and `Fall` clips for the Rocketbox `Bip01` (3ds Max biped) skeleton.
//
// No CC0 jump/fall source is available at a sha256-pinnable URL (Rocketbox ships none, and the
// Quaternius Universal Animation Library is distributed through itch.io / Google Drive only), so
// the clips are keyframed from the Idle clip's first-frame pose (plan Task 5, option B).
//
// Biped bones have arbitrary local axes, so every pose is authored as world-space rotations
// about the character's own axes (up, forward, left: measured from the skeleton) and converted to
// local rotations: for bone b with parent p,
//   world'(b) = D(b) · world(b)      (D(b): the bone's absolute world-space delta)
//   local'(b) = world'(p)⁻¹ · world'(b)
// Bones without an explicit delta inherit their parent's, so hands, fingers and the head ride
// along rigidly.
//
// Only + - * / and Math.sin/Math.cos/Math.sqrt are used. V8 ships its own fdlibm-derived
// sin/cos, so with Node pinned (.nvmrc) the float32 output is reproducible.

/** Clip sample rate (frames per second). */
const FPS = 30;
const JUMP_DURATION = 0.6;
const JUMP_PEAK = 0.25;
const FALL_HZ = 1.5;
const HIPS = "Bip01";
const SKIP = new Set(["Bip01 Footsteps"]);

/** Bones the clips pose; a missing one is an error (wrong skeleton). */
export const AIRBORNE_BONES = [
	"Bip01 Spine",
	"Bip01 Head",
	"Bip01 L Thigh",
	"Bip01 L Calf",
	"Bip01 L Foot",
	"Bip01 L Toe0",
	"Bip01 R Thigh",
	"Bip01 R Calf",
	"Bip01 R Foot",
	"Bip01 L UpperArm",
	"Bip01 L Forearm",
	"Bip01 R UpperArm",
	"Bip01 R Forearm",
];

// ---------------------------------------------------------------------------------------------
// Quaternion / vector maths ([x, y, z, w], Hamilton product, glTF convention)

const len3 = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
const norm3 = (v) => {
	const l = len3(v);
	return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function qmul(a, b) {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => {
	const l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
/** Rotates vector v by unit quaternion q. */
export function qrot(q, v) {
	const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q));
	return [p[0], p[1], p[2]];
}
/** Unit quaternion: `deg` degrees about unit `axis` (right-hand rule). */
function axisAngle(axis, deg) {
	const h = (deg * Math.PI) / 360;
	const s = Math.sin(h);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}
const IDENTITY = [0, 0, 0, 1];

// ---------------------------------------------------------------------------------------------
// Skeleton

/**
 * @typedef {{ name: string, parent: string | null, translation: number[], rotation: number[],
 *   scale: number[] }} SkeletonNode
 * @typedef {{ nodes: SkeletonNode[] }} Skeleton  Parent-first; `rotation`/`translation` are the
 *   base pose (Idle frame 0). Must include every ancestor of Bip01 up to the scene root.
 * @typedef {{ node: string, path: "rotation" | "translation", times: Float32Array,
 *   values: Float32Array }} TrackData
 * @typedef {{ name: string, duration: number, tracks: TrackData[] }} AnimationClipData
 */

/** World rotations and positions of every node for the given local rotations. */
function worldPose(skeleton, local) {
	const rot = new Map();
	const pos = new Map();
	const scl = new Map();
	for (const n of skeleton.nodes) {
		const r = local.get(n.name) ?? n.rotation;
		if (n.parent === null) {
			rot.set(n.name, r);
			pos.set(n.name, n.translation.slice());
			scl.set(n.name, n.scale.slice());
			continue;
		}
		const pr = rot.get(n.parent);
		const ps = scl.get(n.parent);
		const pp = pos.get(n.parent);
		const t = qrot(pr, [
			n.translation[0] * ps[0],
			n.translation[1] * ps[1],
			n.translation[2] * ps[2],
		]);
		rot.set(n.name, qmul(pr, r));
		pos.set(n.name, [pp[0] + t[0], pp[1] + t[1], pp[2] + t[2]]);
		scl.set(n.name, [
			ps[0] * n.scale[0],
			ps[1] * n.scale[1],
			ps[2] * n.scale[2],
		]);
	}
	return { rot, pos };
}

/** The character's world axes, measured from the base pose (glTF: +Y up). */
function characterAxes(pos) {
	const up = [0, 1, 0];
	const flat = (v) => norm3([v[0], 0, v[2]]);
	const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const fwd = flat(sub(pos.get("Bip01 L Toe0"), pos.get("Bip01 L Foot")));
	const left = cross(up, fwd);
	const side = sub(pos.get("Bip01 L Thigh"), pos.get("Bip01 R Thigh"));
	if (!(dot3(side, left) > 0))
		throw new Error(
			"airborne clips: left thigh is not on the character's left",
		);
	return { up, fwd, left };
}

// ---------------------------------------------------------------------------------------------
// Poses

/**
 * Pose parameters (degrees). `thigh`: hip flexion (knee forward); `knee`: knee flexion;
 * `abduct`: upper arm raised sideways; `armFwd`: upper arm raised forward; `elbow`: elbow
 * flexion; `lean`: torso pitched forward; `flail`: extra arm abduction (signed).
 */
const REST = {
	thigh: 0,
	knee: 0,
	abduct: 0,
	armFwd: 0,
	elbow: 0,
	lean: 0,
	flail: 0,
	legSwing: 0,
};
/** Jump: crouch-tuck at the peak (knees ~60°, thighs ~45°, arms up ~30°, mostly forward), then extend. */
const JUMP_KEYS = [
	{ t: 0, p: REST },
	{
		t: JUMP_PEAK,
		p: {
			...REST,
			thigh: 45,
			knee: 60,
			abduct: 15,
			armFwd: 34,
			elbow: 30,
			lean: 8,
		},
	},
	{
		t: JUMP_DURATION,
		p: {
			...REST,
			thigh: 20,
			knee: 30,
			abduct: 15,
			armFwd: 20,
			elbow: 25,
			lean: 4,
		},
	},
];
/** Fall: a held tuck; the arms flail (±10°) at FALL_HZ and the legs counter-swing (±6°). */
const FALL_POSE = {
	...REST,
	thigh: 30,
	knee: 50,
	abduct: 25,
	armFwd: 22,
	elbow: 35,
	lean: 4,
};

/** World-space deltas for a pose, keyed by bone name. */
function poseDeltas(p, axes) {
	const right = [-axes.left[0], -axes.left[1], -axes.left[2]];
	// pitch(+θ) about the right axis swings a down-pointing bone forward.
	const pitch = (deg) => axisAngle(right, deg);
	const lean = pitch(-p.lean);
	const d = new Map();
	d.set("Bip01 Spine", lean);
	d.set("Bip01 Head", IDENTITY); // keep looking ahead
	for (const [side, sign] of [
		["L", 1],
		["R", -1],
	]) {
		const swing = p.legSwing * sign;
		const thigh = pitch(p.thigh + swing);
		d.set(`Bip01 ${side} Thigh`, thigh);
		// The shin swings back by the knee angle; the foot follows the shin (toes slightly down).
		d.set(`Bip01 ${side} Calf`, pitch(p.thigh + swing - p.knee));
		// Abduction: down rotates toward the bone's own side (about ±forward).
		const out = axisAngle(axes.fwd, (p.abduct + p.flail) * sign);
		const arm = qmul(pitch(p.armFwd), qmul(out, lean));
		d.set(`Bip01 ${side} UpperArm`, arm);
		d.set(`Bip01 ${side} Forearm`, qmul(pitch(p.elbow), arm));
	}
	return d;
}

/** Local rotations of every node for world-space deltas `d`. */
function localPose(skeleton, base, d) {
	const delta = new Map();
	const world = new Map();
	const local = new Map();
	for (const n of skeleton.nodes) {
		const pd = n.parent === null ? IDENTITY : delta.get(n.parent);
		const dn = d.get(n.name) ?? pd;
		delta.set(n.name, dn);
		const w = qnorm(qmul(dn, base.rot.get(n.name)));
		world.set(n.name, w);
		local.set(
			n.name,
			n.parent === null ? w : qnorm(qmul(qconj(world.get(n.parent)), w)),
		);
	}
	return local;
}

const smooth = (x) => x * x * (3 - 2 * x);
function lerpPose(a, b, x) {
	const o = {};
	for (const k of Object.keys(REST)) o[k] = a[k] + (b[k] - a[k]) * x;
	return o;
}

// ---------------------------------------------------------------------------------------------
// Clips

/** The skeleton's Bip01 subtree (minus Footsteps), parent-first. */
function hipsSubtree(skeleton) {
	const names = new Set([HIPS]);
	for (const n of skeleton.nodes)
		if (n.parent !== null && names.has(n.parent) && !SKIP.has(n.name))
			names.add(n.name);
	return skeleton.nodes.filter((n) => names.has(n.name));
}

/** Samples `poseAt(t)` into one rotation track per Bip01-subtree bone (+ hips translation). */
function sampleClip(name, skeleton, base, axes, duration, poseAt) {
	const frames = Math.round(duration * FPS);
	const times = new Float32Array(frames + 1);
	for (let i = 0; i <= frames; i++) times[i] = (i * duration) / frames;
	const bones = hipsSubtree(skeleton);
	const values = new Map(
		bones.map((n) => [n.name, new Float32Array((frames + 1) * 4)]),
	);
	for (let i = 0; i <= frames; i++) {
		const local = localPose(
			skeleton,
			base,
			poseDeltas(poseAt(i, frames), axes),
		);
		for (const n of bones) {
			let q = local.get(n.name);
			// Keep consecutive keys in the same hemisphere so LINEAR slerps the short way.
			if (i > 0) {
				const v = values.get(n.name);
				const prev = [v[i * 4 - 4], v[i * 4 - 3], v[i * 4 - 2], v[i * 4 - 1]];
				if (
					q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] <
					0
				)
					q = [-q[0], -q[1], -q[2], -q[3]];
			}
			values.get(n.name).set(q, i * 4);
		}
	}
	const end = new Float32Array([0, duration]);
	const tracks = [];
	for (const n of bones) {
		const v = values.get(n.name);
		let constant = true;
		for (let i = 4; i < v.length && constant; i++)
			if (v[i] !== v[i % 4]) constant = false;
		tracks.push({
			node: n.name,
			path: "rotation",
			times: constant ? end : times,
			values: constant
				? new Float32Array([...v.subarray(0, 4), ...v.subarray(0, 4)])
				: v,
		});
	}
	const hips = skeleton.nodes.find((n) => n.name === HIPS);
	tracks.push({
		node: HIPS,
		path: "translation",
		times: end,
		values: new Float32Array([...hips.translation, ...hips.translation]),
	});
	return { name, duration, tracks };
}

/**
 * Jump (plays once, JUMP_DURATION s) and Fall (loops, 1 / FALL_HZ s) for a Bip01 skeleton.
 * @param {Skeleton} skeleton
 * @returns {{ jump: AnimationClipData, fall: AnimationClipData }}
 */
export function airborneClips(skeleton) {
	const have = new Set(skeleton.nodes.map((n) => n.name));
	if (!have.has(HIPS))
		throw new Error(`airborne clips: skeleton has no ${HIPS}`);
	for (const b of AIRBORNE_BONES)
		if (!have.has(b)) throw new Error(`airborne clips: skeleton has no "${b}"`);
	const base = worldPose(skeleton, new Map());
	const axes = characterAxes(base.pos);

	const jump = sampleClip(
		"Jump",
		skeleton,
		base,
		axes,
		JUMP_DURATION,
		(i, n) => {
			const t = (i * JUMP_DURATION) / n;
			const k = t <= JUMP_PEAK ? 1 : 2;
			const a = JUMP_KEYS[k - 1];
			const b = JUMP_KEYS[k];
			return lerpPose(a.p, b.p, smooth((t - a.t) / (b.t - a.t)));
		},
	);

	const fall = sampleClip("Fall", skeleton, base, axes, 1 / FALL_HZ, (i, n) => {
		// One full period: the last frame equals the first exactly, so the loop is seamless.
		const s = i === n ? 0 : Math.sin((2 * Math.PI * i) / n);
		return { ...FALL_POSE, flail: 10 * s, legSwing: 6 * s };
	});
	return { jump, fall };
}
