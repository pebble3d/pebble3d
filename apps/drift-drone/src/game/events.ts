/** Sim -> presentation events (preallocated; cleared at the start of every tick). */
export const EV = {
	COUNT: 1, // a = seconds left (3, 2, 1)
	GO: 2,
	GATE: 3, // a = gate index, b = time since the lap started (s)
	LAP: 4, // a = lap index (0-based), b = lap time (s)
	CRASH: 5, // b = impact speed (m/s)
	RESPAWN: 6,
	FINISH: 7, // b = race time (s)
	BUMP: 8, // b = impact speed (m/s), below the crash threshold
} as const;

const CAP = 32;

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
