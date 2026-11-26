import {
	BUFFER_FRAMES,
	FOCUS_HOLD_FRAMES,
	LINGER_FRAMES,
} from "../constants.ts";
import { BTN } from "../input.ts";
import type { MoveDef, MoveSet } from "./moves.ts";

export interface ComboContext {
	grounded: boolean;
	focusFull: boolean;
	dodgeReady: boolean;
}

const BUF_CAP = 4;
const BUFFERED = [BTN.LIGHT, BTN.HEAVY, BTN.DODGE] as const;

/**
 * The katana combo state machine. Each sim frame: presses go into a small buffer (kept
 * `BUFFER_FRAMES`), the current move advances (pausing on a held charge or an airborne hold),
 * then the oldest buffered press that can route somewhere starts its move. A press routes
 * through the current move's `next` table inside its cancel window, through a just-finished
 * move's table for `LINGER_FRAMES` after it ends, or to the default starter when idle.
 * Allocation-free.
 */
export class ComboMachine {
	/** Current move index, or -1 when idle. */
	move = -1;
	frame = 0;
	/** Frames the current charge has been held. */
	charge = 0;
	/** Increments whenever a move starts (once-per-swing hit bookkeeping). */
	swing = 0;
	/** Frames FOCUS has been held. */
	focusHeld = 0;
	private chargeDone = false;
	private linger = -1;
	private lingerT = 0;
	private readonly bufBtn = new Int32Array(BUF_CAP);
	private readonly bufAt = new Int32Array(BUF_CAP);
	private bufN = 0;
	private readonly set: MoveSet;

	constructor(set: MoveSet) {
		this.set = set;
	}

	get def(): MoveDef | null {
		return this.move >= 0 ? (this.set.moves[this.move] as MoveDef) : null;
	}

	/** Buffered presses not yet consumed. */
	get buffered(): number {
		return this.bufN;
	}

	inCancel(): boolean {
		const d = this.def;
		return (
			d !== null &&
			d.cancel !== null &&
			this.frame >= d.cancel[0] &&
			this.frame <= d.cancel[1]
		);
	}

	/** Jumping is allowed when idle or inside a cancel window. */
	canJump(): boolean {
		return this.move < 0 || this.inCancel();
	}

	/** Invulnerable on this frame of the current move. */
	invulnerable(): boolean {
		const d = this.def;
		return (
			d !== null &&
			d.iframes !== null &&
			this.frame >= d.iframes[0] &&
			this.frame < d.iframes[1]
		);
	}

	/** Drops the current move and the buffer (hit reactions, death, phase changes). */
	interrupt(): void {
		this.move = -1;
		this.frame = 0;
		this.linger = -1;
		this.lingerT = 0;
		this.bufN = 0;
	}

	/**
	 * Buffers this tick's presses without advancing the move or routing (hit-stop: the
	 * move is frozen, presses still count). `now` is the (paused) sim frame number.
	 */
	buffer(pressed: number, now: number): void {
		for (const b of BUFFERED) if (pressed & b) this.push(b, now);
	}

	/**
	 * One sim frame. `pressed`/`held` are BTN bitmasks; `now` is the sim frame number.
	 * Returns the index of a move started this frame, or -1.
	 */
	update(
		pressed: number,
		held: number,
		now: number,
		ctx: ComboContext,
	): number {
		this.buffer(pressed, now);
		this.focusHeld = held & BTN.FOCUS ? this.focusHeld + 1 : 0;
		this.expire(now);

		const set = this.set;
		const d = this.def;
		if (d) {
			const ch = d.charge;
			if (ch && this.frame === ch.at && !this.chargeDone) {
				if (held & BTN.HEAVY && this.charge < ch.max) {
					this.charge++;
				} else {
					this.chargeDone = true;
					if (this.charge >= ch.min) return this.start(ch.into);
					this.frame++;
				}
			} else if (
				d.hold &&
				this.frame === d.hold.at &&
				d.hold.untilGrounded &&
				!ctx.grounded
			) {
				// hold the frame while airborne
			} else {
				this.frame++;
			}
			if (this.frame >= d.total) {
				this.linger = this.move;
				this.lingerT = LINGER_FRAMES;
				this.move = -1;
				this.frame = 0;
			}
		} else if (this.lingerT > 0) {
			this.lingerT--;
		}

		if (
			ctx.focusFull &&
			this.focusHeld >= FOCUS_HOLD_FRAMES &&
			this.move !== set.spinStorm
		) {
			this.focusHeld = 0;
			this.bufN = 0;
			return this.start(set.spinStorm);
		}

		for (let i = 0; i < this.bufN; i++) {
			const target = this.route(this.bufBtn[i] as number, ctx);
			if (target >= 0) {
				this.removeAt(i);
				return this.start(target);
			}
		}
		return -1;
	}

	/** Where a press of `btn` goes right now, or -1 if it cannot act yet. */
	route(btn: number, ctx: ComboContext): number {
		const set = this.set;
		const d = this.def;
		const inCancel = this.inCancel();
		if (btn === BTN.DODGE) {
			if (!ctx.dodgeReady || !ctx.grounded) return -1;
			if (d === null || inCancel || this.frame >= d.dodgeCancel)
				return set.dodge;
			return -1;
		}
		const heavyStarter = ctx.grounded ? set.heavy : set.plunge;
		if (d !== null) {
			if (!inCancel) return -1;
			if (btn === BTN.LIGHT) return d.nextLight >= 0 ? d.nextLight : set.light1;
			return d.nextHeavy >= 0 && ctx.grounded ? d.nextHeavy : heavyStarter;
		}
		const l =
			this.lingerT > 0 && this.linger >= 0
				? (set.moves[this.linger] as MoveDef)
				: null;
		if (btn === BTN.LIGHT)
			return l && l.nextLight >= 0 ? l.nextLight : set.light1;
		return l && l.nextHeavy >= 0 && ctx.grounded ? l.nextHeavy : heavyStarter;
	}

	private start(i: number): number {
		this.move = i;
		this.frame = 0;
		this.charge = 0;
		this.chargeDone = false;
		this.linger = -1;
		this.lingerT = 0;
		this.swing++;
		return i;
	}

	private push(btn: number, now: number): void {
		if (this.bufN === BUF_CAP) this.removeAt(0);
		this.bufBtn[this.bufN] = btn;
		this.bufAt[this.bufN] = now;
		this.bufN++;
	}

	private expire(now: number): void {
		let w = 0;
		for (let r = 0; r < this.bufN; r++) {
			if (now - (this.bufAt[r] as number) > BUFFER_FRAMES) continue;
			this.bufBtn[w] = this.bufBtn[r] as number;
			this.bufAt[w] = this.bufAt[r] as number;
			w++;
		}
		this.bufN = w;
	}

	private removeAt(i: number): void {
		for (let k = i + 1; k < this.bufN; k++) {
			this.bufBtn[k - 1] = this.bufBtn[k] as number;
			this.bufAt[k - 1] = this.bufAt[k] as number;
		}
		this.bufN--;
	}
}
