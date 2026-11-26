import { cameraRelativeInput, type MoveKeys } from "@pebble3d/sdk/input";
import { BTN, quantize, type TickInput } from "./input.ts";

const MOVE: Record<string, keyof MoveKeys> = {
	KeyW: "f",
	ArrowUp: "f",
	KeyS: "b",
	ArrowDown: "b",
	KeyA: "l",
	ArrowLeft: "l",
	KeyD: "r",
	ArrowRight: "r",
};

/**
 * Keyboard state turned into a world-space `TickInput` with the camera yaw: WASD or the
 * arrows move relative to the camera, Space jumps, Shift sprints, Q/E turn the camera.
 */
export class LiveInput {
	readonly keys: MoveKeys = { f: false, b: false, l: false, r: false };
	jump = false;
	/** A Space press not yet seen by a tick (a tap shorter than one tick still jumps). */
	private tapped = false;
	sprint = false;
	turn = 0;
	/** Seconds since a camera key or mouse look (the chase camera eases in after it). */
	idleLook = 99;
	private readonly dir = new Float32Array(2);
	/** Fired on key-down for UI keys (Enter, Escape, R, N, digits, ...). */
	onKey: ((code: string) => void) | null = null;

	constructor() {
		window.addEventListener("keydown", (e) => {
			const k = MOVE[e.code];
			if (k) this.keys[k] = true;
			if (e.code === "Space") {
				this.jump = true;
				if (!e.repeat) this.tapped = true;
				e.preventDefault();
			}
			if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.sprint = true;
			if (e.code === "KeyQ") this.turn = 1;
			if (e.code === "KeyE") this.turn = -1;
			if (e.code.startsWith("Arrow")) e.preventDefault();
			if (!e.repeat) this.onKey?.(e.code);
		});
		window.addEventListener("keyup", (e) => {
			const k = MOVE[e.code];
			if (k) this.keys[k] = false;
			if (e.code === "Space") this.jump = false;
			if (e.code === "ShiftLeft" || e.code === "ShiftRight")
				this.sprint = false;
			if (e.code === "KeyQ" || e.code === "KeyE") this.turn = 0;
		});
		window.addEventListener("blur", () => {
			this.keys.f = this.keys.b = this.keys.l = this.keys.r = false;
			this.jump = this.sprint = false;
			this.turn = 0;
		});
		window.addEventListener("mousemove", (e) => {
			if (
				document.pointerLockElement &&
				(e.movementX !== 0 || e.movementY !== 0)
			)
				this.idleLook = 0;
		});
	}

	/** Fills `out` for one tick given the camera yaw (radians, 0 looks down -Z). */
	sample(out: TickInput, yaw: number): void {
		cameraRelativeInput(this.keys, yaw, this.dir);
		out.x = quantize(this.dir[0] as number);
		out.z = quantize(this.dir[1] as number);
		// A tap shorter than a tick is still sent as one tick of JUMP, so the sim sees its edge.
		out.buttons =
			(this.jump || this.tapped ? BTN.JUMP : 0) |
			(this.sprint ? BTN.SPRINT : 0);
		this.tapped = false;
	}

	get moving(): boolean {
		return this.keys.f || this.keys.b || this.keys.l || this.keys.r;
	}
}
