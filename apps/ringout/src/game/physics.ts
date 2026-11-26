import { SCRATCH_LEN, type SimHandle } from "@pebble3d/sdk/sim";

export type PhysWorld = SimHandle["world"];

/**
 * Makes independent Rapier worlds from the engine's already-loaded deterministic wasm module.
 * The player's run and every ghost each get their own world, so a ghost can never touch the
 * live run: it is the same deterministic sim, re-fed the logged inputs.
 */
export interface PhysicsHost {
	create(seed: number, gravity: number): PhysWorld;
	memory: WebAssembly.Memory;
}

export function hostFromHandle(h: SimHandle): PhysicsHost {
	if (h.build !== "deterministic")
		throw new Error("ringout needs the deterministic sim build");
	const Ctor = h.world.constructor as new (
		seed: number,
		g: number,
	) => PhysWorld;
	return { create: (seed, g) => new Ctor(seed, g), memory: h.memory };
}

/** Cached Float32Array views over one world's state buffers and scratch region. */
export class WorldViews {
	curr: Float32Array = new Float32Array(0);
	prev: Float32Array = new Float32Array(0);
	scratch: Float32Array = new Float32Array(0);
	private buffer: ArrayBufferLike | null = null;
	private pc = -1;
	private pp = -1;
	private cap = -1;
	private ps = -1;

	private readonly world: PhysWorld;
	private readonly memory: WebAssembly.Memory;

	constructor(world: PhysWorld, memory: WebAssembly.Memory) {
		this.world = world;
		this.memory = memory;
		this.refresh();
	}

	/** Re-points the views if wasm memory grew or the buffers moved (any world's spawn can). */
	refresh(): void {
		const w = this.world;
		const buf = this.memory.buffer;
		const pc = w.statePtrCurr();
		const pp = w.statePtrPrev();
		const cap = w.slotCapacity();
		const ps = w.scratchPtr();
		if (
			buf === this.buffer &&
			pc === this.pc &&
			pp === this.pp &&
			cap === this.cap &&
			ps === this.ps
		)
			return;
		this.buffer = buf;
		this.pc = pc;
		this.pp = pp;
		this.cap = cap;
		this.ps = ps;
		this.curr = new Float32Array(buf, pc, cap * 8);
		this.prev = new Float32Array(buf, pp, cap * 8);
		this.scratch = new Float32Array(buf, ps, SCRATCH_LEN);
	}
}
