/** Sim -> presentation events (preallocated ring; drained once per tick). */
export const EV = {
	COUNT: 1, // a = seconds left (3, 2, 1)
	GO: 2,
	CHECKPOINT: 3, // a = checkpoint index, b = split time (s)
	BOOST: 4, // a = pad index
	JUMP: 5,
	LAND: 6, // b = impact speed (m/s)
	RESPAWN: 7,
	FINISH: 8, // b = finish time (s)
	HIT: 9, // b = impact speed (sweeper / wall knock)
} as const;

const CAP = 64;

export class EventQueue {
	readonly type = new Uint8Array(CAP);
	readonly a = new Int32Array(CAP);
	readonly b = new Float64Array(CAP);
	length = 0;

	push(type: number, a = 0, b = 0): void {
		if (this.length >= CAP) return;
		this.type[this.length] = type;
		this.a[this.length] = a;
		this.b[this.length] = b;
		this.length++;
	}

	clear(): void {
		this.length = 0;
	}
}
