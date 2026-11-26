/**
 * Undo/redo over whole-doc JSON snapshots (gardens are small; snapshots are simple and
 * exact). Bounded by count and by total characters, so a large garden keeps fewer steps.
 */
export class History {
	private undoStack: string[] = [];
	private redoStack: string[] = [];
	private chars = 0;

	constructor(
		private readonly limit = 200,
		private readonly maxChars = 16 * 1024 * 1024,
	) {}

	private add(stack: string[], s: string): void {
		stack.push(s);
		this.chars += s.length;
		while (
			(this.undoStack.length > this.limit || this.chars > this.maxChars) &&
			this.undoStack.length > 1
		) {
			this.chars -= (this.undoStack.shift() as string).length;
		}
	}

	private take(stack: string[]): string | undefined {
		const s = stack.pop();
		if (s !== undefined) this.chars -= s.length;
		return s;
	}

	/** Records the state before an edit. */
	push(snapshot: string): void {
		if (this.undoStack[this.undoStack.length - 1] === snapshot) return;
		for (const r of this.redoStack) this.chars -= r.length;
		this.redoStack.length = 0;
		this.add(this.undoStack, snapshot);
	}

	undo(current: string): string | null {
		const s = this.take(this.undoStack);
		if (s === undefined) return null;
		this.add(this.redoStack, current);
		return s;
	}

	redo(current: string): string | null {
		const s = this.take(this.redoStack);
		if (s === undefined) return null;
		this.add(this.undoStack, current);
		return s;
	}

	/** Characters held (for tests). */
	get size(): number {
		return this.chars;
	}

	clear(): void {
		this.undoStack.length = 0;
		this.redoStack.length = 0;
		this.chars = 0;
	}
}
