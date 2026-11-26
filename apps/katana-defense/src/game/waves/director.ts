import type { Archetype } from "../ai/archetypes.ts";
import { archetypeIndex } from "../ai/archetypes.ts";
import type { Rng } from "../rng.ts";

export interface WaveGroup {
	type: string;
	count: number;
	after?: number;
}
export interface WaveDef {
	maxAlive: number;
	interval: number;
	groups: WaveGroup[];
}
export interface WaveFile {
	preWaveFrames: number;
	clearFrames: number;
	upgradeEvery: number;
	hpScalePerWave: number;
	waves: WaveDef[];
}

const MAX_QUEUE = 256;

/**
 * Builds a wave's spawn order: each group's spawns are spread over the wave from its
 * `after` fraction on, interleaved by deterministic jittered keys, each with a spawn point
 * drawn by weight. Writes into the given typed arrays; returns the spawn count.
 */
export function composeWave(
	def: WaveDef,
	archetypes: Archetype[],
	spawnWeights: number[],
	rng: Rng,
	outType: Int8Array,
	outSpawn: Int8Array,
	keys: Float32Array,
): number {
	let n = 0;
	for (const g of def.groups) {
		const t = archetypeIndex(archetypes, g.type);
		const from = g.after ?? 0;
		for (let i = 0; i < g.count; i++) {
			if (n >= outType.length) throw new Error("wave too large");
			outType[n] = t;
			keys[n] = from + ((1 - from) * (i + rng.next())) / g.count;
			n++;
		}
	}
	// insertion sort by key (n <= 256, once per wave)
	for (let i = 1; i < n; i++) {
		const k = keys[i] as number;
		const ty = outType[i] as number;
		let j = i - 1;
		while (j >= 0 && (keys[j] as number) > k) {
			keys[j + 1] = keys[j] as number;
			outType[j + 1] = outType[j] as number;
			j--;
		}
		keys[j + 1] = k;
		outType[j + 1] = ty;
	}
	let total = 0;
	for (const w of spawnWeights) total += w;
	for (let i = 0; i < n; i++) {
		let r = rng.next() * total;
		let s = 0;
		while (s < spawnWeights.length - 1 && r >= (spawnWeights[s] as number)) {
			r -= spawnWeights[s] as number;
			s++;
		}
		outSpawn[i] = s;
	}
	return n;
}

/**
 * Feeds a wave's spawns out over time: one per `interval` frames (jittered), never more
 * than `maxAlive` alive. `next()` returns the queue index to spawn this frame, or -1.
 */
export class WaveDirector {
	readonly type = new Int8Array(MAX_QUEUE);
	readonly spawn = new Int8Array(MAX_QUEUE);
	private readonly keys = new Float32Array(MAX_QUEUE);
	count = 0;
	cursor = 0;
	timer = 0;
	def: WaveDef | null = null;

	begin(
		def: WaveDef,
		archetypes: Archetype[],
		spawnWeights: number[],
		rng: Rng,
	): void {
		this.def = def;
		this.count = composeWave(
			def,
			archetypes,
			spawnWeights,
			rng,
			this.type,
			this.spawn,
			this.keys,
		);
		this.cursor = 0;
		this.timer = 30;
	}

	/** Clears any wave in progress (run restart). */
	reset(): void {
		this.def = null;
		this.count = 0;
		this.cursor = 0;
		this.timer = 0;
	}

	/** All spawns issued. */
	get exhausted(): boolean {
		return this.cursor >= this.count;
	}

	get remaining(): number {
		return this.count - this.cursor;
	}

	next(alive: number, rng: Rng): number {
		const def = this.def;
		if (!def || this.exhausted) return -1;
		if (this.timer > 0) this.timer--;
		if (this.timer > 0 || alive >= def.maxAlive) return -1;
		this.timer = Math.round(def.interval * (0.75 + 0.5 * rng.next()));
		return this.cursor++;
	}
}

/** Per-archetype counts of a wave (HUD preview, tests). */
export function waveComposition(def: WaveDef): Record<string, number> {
	const out: Record<string, number> = {};
	for (const g of def.groups) out[g.type] = (out[g.type] ?? 0) + g.count;
	return out;
}
