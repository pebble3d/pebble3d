/** Sim events for presentation (audio, VFX, HUD). Cleared at the start of every tick. */
export const EV = {
	COUNT: 1,
	GO: 2,
	DASH: 3,
	/** a, b: the two orbs; v: closing speed (m/s); x, z: contact point. */
	IMPACT: 4,
	/** a: the orb out; b: credited orb or -1; x, z: where it fell. */
	RINGOUT: 5,
	/** a: ring index that started to shake. */
	WARN: 6,
	/** a: ring index whose first tile dropped. */
	DROP: 7,
	/** a: winner slot, or -1 for a draw. */
	DECIDED: 8,
	OVER: 9,
} as const;

/** Fixed-capacity event ring: no allocation per tick. */
export class Events {
	readonly cap = 64;
	length = 0;
	readonly type = new Uint8Array(this.cap);
	readonly a = new Int8Array(this.cap);
	readonly b = new Int8Array(this.cap);
	readonly v = new Float32Array(this.cap);
	readonly x = new Float32Array(this.cap);
	readonly z = new Float32Array(this.cap);

	clear(): void {
		this.length = 0;
	}

	push(type: number, a = 0, b = 0, v = 0, x = 0, z = 0): void {
		if (this.length >= this.cap) return;
		const k = this.length++;
		this.type[k] = type;
		this.a[k] = a;
		this.b[k] = b;
		this.v[k] = v;
		this.x[k] = x;
		this.z[k] = z;
	}
}
