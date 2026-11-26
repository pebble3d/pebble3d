import type { World } from "../wasm/det/engine_core_det.js";
import type { SimEntry } from "./types.ts";

export type SimBuild = "deterministic" | "fast";

/**
 * Floats in the wasm query scratch region; mirrors engine-core `SCRATCH_LEN`. Slots:
 * `raycast` [0..5), `characterState` [8..12), `linearVelocity` [12..15),
 * `angularVelocity` [16..19).
 */
export const SCRATCH_LEN = 24;

export interface SimHandle {
	world: World;
	memory: WebAssembly.Memory;
	build: SimBuild;
	seed: number;
	/** Spawns entries in order; returns sceneId -> sim entity id. */
	spawnScene(sim: SimEntry[]): Map<string, number>;
}

export interface LoadSimOptions {
	seed?: number;
	gravity?: number;
}

interface Glue {
	World: typeof World;
	initSync(module: { module: BufferSource | WebAssembly.Module }): {
		memory: WebAssembly.Memory;
	};
	default(arg: {
		module_or_path: string;
	}): Promise<{ memory: WebAssembly.Memory }>;
}

/**
 * Loads one wasm build. Node passes bytes (sync init); the browser passes a URL.
 * The two builds are independent modules and may coexist in one process.
 */
export async function loadSim(
	build: SimBuild,
	wasm: BufferSource | string,
	opts: LoadSimOptions = {},
): Promise<SimHandle> {
	const glue = (await (build === "deterministic"
		? import("../wasm/det/engine_core_det.js")
		: import("../wasm/fast/engine_core_fast.js"))) as unknown as Glue;
	const out =
		typeof wasm === "string"
			? await glue.default({ module_or_path: wasm })
			: glue.initSync({ module: wasm });
	const seed = opts.seed ?? 1;
	const world = new glue.World(seed, opts.gravity ?? -9.81);
	return {
		world,
		memory: out.memory,
		build,
		seed,
		spawnScene(sim) {
			const ids = new Map<string, number>();
			for (const e of sim)
				ids.set(e.sceneId, world.spawn(JSON.stringify(e.desc)));
			return ids;
		},
	};
}

/** Typed-array views over the wasm state buffers; rebuilt when memory moves or grows. */
export class StateViews {
	prev: Float32Array;
	curr: Float32Array;
	scratch: Float32Array;
	capacity: number;
	private ptrPrev: number;
	private ptrCurr: number;
	private buffer: ArrayBufferLike;
	private readonly h: SimHandle;

	constructor(h: SimHandle) {
		this.h = h;
		this.ptrPrev = h.world.statePtrPrev();
		this.ptrCurr = h.world.statePtrCurr();
		this.capacity = h.world.slotCapacity();
		this.buffer = h.memory.buffer;
		this.prev = new Float32Array(this.buffer, this.ptrPrev, this.capacity * 8);
		this.curr = new Float32Array(this.buffer, this.ptrCurr, this.capacity * 8);
		this.scratch = new Float32Array(
			this.buffer,
			h.world.scratchPtr(),
			SCRATCH_LEN,
		);
	}

	/** Rebuilds the views if anything moved. Returns whether it did. */
	refresh(): boolean {
		const w = this.h.world;
		const pp = w.statePtrPrev();
		const pc = w.statePtrCurr();
		const cap = w.slotCapacity();
		const buf = this.h.memory.buffer;
		if (
			pp === this.ptrPrev &&
			pc === this.ptrCurr &&
			cap === this.capacity &&
			buf === this.buffer
		)
			return false;
		this.ptrPrev = pp;
		this.ptrCurr = pc;
		this.capacity = cap;
		this.buffer = buf;
		this.prev = new Float32Array(buf, pp, cap * 8);
		this.curr = new Float32Array(buf, pc, cap * 8);
		this.scratch = new Float32Array(buf, w.scratchPtr(), SCRATCH_LEN);
		return true;
	}
}
